/**
 * Pré-remplissage du cache des lieux pour les grandes villes (§4.1, P2) :
 * `npm run places:prefetch` (ou `npx tsx scripts/places-prefetch.ts`).
 *
 * Pour chaque ville de `PREFETCH_CITIES` (shared/cities.ts), les tuiles z12 de son
 * centre absentes ou chargées il y a plus de 7 jours sont lues sur Overpass et
 * enregistrées dans `places` / `fetched_tiles`, exactement comme le ferait la carte.
 * À lancer quand Overpass va bien : l'app sert ensuite ces villes depuis la base.
 *
 * Poli avec Overpass (instances publiques, usage raisonnable demandé) :
 * - une requête à la fois, pause entre deux requêtes (`--pause`, 5 s par défaut) ;
 * - User-Agent identifiable (celui du serveur), instances de `OVERPASS_ENDPOINTS` ;
 * - délais longs (90 s par essai) plutôt que des relances rapprochées ;
 * - disjoncteur : une instance en échec est mise en pause ; si toutes le sont,
 *   le script s'arrête proprement. Relancer plus tard : les tuiles déjà fraîches
 *   sont sautées (reprise sans refaire le travail).
 *
 * Options :
 *   --city=Paris[,Lyon]   villes à traiter (répétable ; défaut : toutes)
 *   --list                affiche les villes et leur nombre de tuiles
 *   --dry-run             compte les tuiles à charger, sans appeler Overpass
 *   --force               recharge aussi les tuiles fraîches
 *   --pause=5             pause entre deux requêtes, en secondes
 *   --timeout=90          délai maximal d'un essai (une instance), en secondes
 *   --tiles-per-request=4 tuiles au plus par requête Overpass (1 à 8)
 *
 * Fonctions pures (options, villes, disjoncteur, mise en forme) : `prefetch-lib.ts`.
 * Mise en veille : les délais sont tenus sur l'horloge murale (voir
 * `armAttemptTimer`), mais rien ne s'exécute pendant la veille ; sous macOS,
 * lancer avec `caffeinate -i` pour un long pré-remplissage.
 *
 * Garde-fou : refuse une base distante (`DATABASE_URL` non `file:`) sauf
 * `PREFETCH_ALLOW_REMOTE=1` (prod : à lancer explicitement, en surveillant le
 * volume de l'offre gratuite de Turso).
 *
 * Code de sortie : 0 si tout est fait, 1 si des tuiles sont en échec ou en cas
 * d'erreur, 2 si le script s'est arrêté (instances en pause ou Ctrl-C).
 */
import './db-env'
import { cityBbox, cityTileCount, cityTileRange, PREFETCH_CITIES } from '../shared/cities'
import type { PrefetchCity } from '../shared/cities'
import { bboxCenter, tileRangeSize } from '../shared/geo'
import type { TileRange } from '../shared/geo'
import type { PrefetchOptions } from './prefetch-lib'
import {
  allInstancesPaused as allPaused, formatDuration as duration, formatNumber, parseArgs, plural, PREFETCH_HELP, PrefetchUsageError,
  selectCities, suspectedSleep,
} from './prefetch-lib'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readOptions(): { options: PrefetchOptions; cities: PrefetchCity[] } {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      console.log(PREFETCH_HELP)
      process.exit(0)
    }
    return { options, cities: selectCities(options.cities) }
  }
  catch (error) {
    if (error instanceof PrefetchUsageError) fail(error.message)
    throw error
  }
}

const { options, cities } = readOptions()

if (options.list) {
  console.log(`${plural(PREFETCH_CITIES.length, 'ville', 'villes')} pré-remplissables (tuiles z12) :`)
  for (const city of PREFETCH_CITIES) {
    console.log(`  ${city.name.padEnd(26)} ${city.key.padEnd(22)} ± ${city.radiusKm} km  ${plural(cityTileCount(city), 'tuile', 'tuiles')}`)
  }
  const total = PREFETCH_CITIES.reduce((n, c) => n + cityTileCount(c), 0)
  console.log(`Total : ${plural(total, 'tuile', 'tuiles')}.`)
  process.exit(0)
}

// Garde-fou avant toute connexion à la base.
const dbUrl = process.env.DATABASE_URL || 'file:pawspot.db'
const localDb = dbUrl.startsWith('file:') || dbUrl === ':memory:'
if (!localDb && process.env.PREFETCH_ALLOW_REMOTE !== '1') {
  fail('Pré-remplissage refusé : DATABASE_URL ne désigne pas une base locale (file:…). '
    + 'Pour remplir une base distante (prod comprise), relancer avec PREFETCH_ALLOW_REMOTE=1.')
}

// Imports dynamiques : la connexion à la base n'est ouverte qu'après le garde-fou.
const { client, db } = await import('../server/database')
const { applyMigrations, findMigrationsFolder } = await import('../server/database/migrate')
const {
  MAX_REFRESH_TILES, OverpassCircuit, OverpassError, configuredOverpassEndpoints, planTileRefresh, refreshTileRange,
  splitIntoRefreshRanges,
} = await import('../server/services/places')

const endpoints = configuredOverpassEndpoints()
const circuit = new OverpassCircuit()
const overpassDeps = {
  overpassEndpoints: endpoints,
  overpassCircuit: circuit,
  overpassTimeoutMs: options.timeoutMs,
  // Chaque instance a droit à un essai complet.
  overpassDeadlineMs: options.timeoutMs * endpoints.length,
}
const tilesPerRequest = Math.min(options.tilesPerRequest, MAX_REFRESH_TILES)

let interrupted = false
process.on('SIGINT', () => {
  if (interrupted) process.exit(2)
  interrupted = true
  console.log('\nInterruption demandée : arrêt après la requête en cours (Ctrl-C à nouveau pour quitter tout de suite).')
})

function allInstancesPaused(): boolean {
  return allPaused(endpoints, circuit, options.timeoutMs, Date.now())
}

interface Totals { done: number; skipped: number; failed: number; places: number }
const totals = { done: 0, skipped: 0, failed: 0, places: 0, toFetch: 0, requests: 0 }
let stopped = null as string | null
let requests = 0
const started = Date.now()

async function prefetchCity(city: PrefetchCity): Promise<void> {
  const cityStart = Date.now()
  const range = cityTileRange(city)
  let plan
  try {
    plan = await planTileRefresh(range, {}, { force: options.force })
  }
  catch (error) {
    if (!options.dryRun) throw error
    // Base pas encore migrée : en --dry-run, on ne la modifie pas.
    console.warn(`  (lecture du cache impossible, toutes les tuiles comptées à charger : ${error instanceof Error ? error.message : String(error)})`)
    plan = await planTileRefresh(range, {}, { force: true })
  }
  const ranges = splitIntoRefreshRanges(plan.stale, bboxCenter(cityBbox(city)), tilesPerRequest)
  const stats: Totals = { done: 0, skipped: plan.fresh.length, failed: 0, places: 0 }
  console.log(`${city.name} : ${plural(tileRangeSize(range), 'tuile', 'tuiles')}, `
    + `${plural(plan.fresh.length, 'fraîche sautée', 'fraîches sautées')}, `
    + `${plural(plan.stale.length, 'à charger', 'à charger')} en ${plural(ranges.length, 'requête', 'requêtes')}.`)

  if (!options.dryRun) {
    const queue: TileRange[] = [...ranges]
    let index = 0
    while (queue.length) {
      if (interrupted) {
        stopped = 'interruption (Ctrl-C)'
        break
      }
      if (allInstancesPaused()) {
        stopped = 'toutes les instances Overpass sont en pause après des échecs'
        break
      }
      const r = queue.shift()!
      const size = tileRangeSize(r)
      index++
      if (requests > 0 && options.pauseMs > 0) await sleep(options.pauseMs)
      requests++
      const t0 = Date.now()
      const label = `  [${index}/${index + queue.length}] ${plural(size, 'tuile', 'tuiles')}`
      try {
        const { places } = await refreshTileRange(r, overpassDeps, { serverTimeoutS: Math.ceil(options.timeoutMs / 1000) })
        stats.done += size
        stats.places += places
        console.log(`${label} : ${plural(places, 'lieu', 'lieux')} en ${duration(Date.now() - t0)}`)
      }
      catch (error) {
        if (!(error instanceof OverpassError)) throw error
        const elapsed = Date.now() - t0
        console.log(`${label} : échec en ${duration(elapsed)} (${error.attempts.join(' ; ')})`)
        if (suspectedSleep(elapsed, overpassDeps.overpassDeadlineMs)) {
          console.log(`    (durée supérieure au délai total de ${duration(overpassDeps.overpassDeadlineMs)} : `
            + 'l\'ordinateur s\'est probablement mis en veille ; sous macOS, relancer avec « caffeinate -i ».)')
        }
        if (size > 1 && !allInstancesPaused()) {
          // Résultat partiel (requête trop lourde) : on réessaie tuile par tuile.
          console.log('    → nouvel essai tuile par tuile')
          for (let x = r.maxX; x >= r.minX; x--) {
            for (let y = r.maxY; y >= r.minY; y--) queue.unshift({ z: r.z, minX: x, maxX: x, minY: y, maxY: y })
          }
        }
        else {
          stats.failed += size
        }
      }
    }
    // Tuiles non traitées après un arrêt : comptées en échec (à reprendre).
    for (const r of queue) stats.failed += tileRangeSize(r)
  }

  totals.toFetch += plan.stale.length
  totals.requests += ranges.length
  totals.done += stats.done
  totals.skipped += stats.skipped
  totals.failed += stats.failed
  totals.places += stats.places
  if (!options.dryRun) {
    console.log(`${city.name} : ${plural(stats.done, 'tuile faite', 'tuiles faites')}, ${formatNumber(stats.skipped)} sautée(s), `
      + `${formatNumber(stats.failed)} en échec, ${plural(stats.places, 'lieu', 'lieux')}, ${duration(Date.now() - cityStart)}.`)
  }
}

let exitCode = 0
try {
  console.log(`${options.dryRun ? 'Simulation (--dry-run, aucun appel Overpass)' : 'Pré-remplissage'} sur ${dbUrl} : `
    + `${plural(cities.length, 'ville', 'villes')}${options.force ? ', --force (tuiles fraîches rechargées)' : ''}.`)
  if (!options.dryRun) {
    console.log(`Instances Overpass : ${endpoints.map(e => new URL(e).host).join(', ')} ; `
      + `${duration(options.timeoutMs)} par essai, pause de ${duration(options.pauseMs)}, ${tilesPerRequest} tuiles au plus par requête.`)
    if (localDb) {
      const folder = findMigrationsFolder()
      if (folder) await applyMigrations(db, folder)
    }
  }
  let processed = 0
  for (const city of cities) {
    await prefetchCity(city)
    processed++
    if (stopped) break
  }
  const notStarted = cities.slice(processed)
  if (options.dryRun) {
    console.log(`Total : ${plural(totals.toFetch, 'tuile', 'tuiles')} à charger en ${plural(totals.requests, 'requête', 'requêtes')}, `
      + `${plural(totals.skipped, 'fraîche sautée', 'fraîches sautées')}.`)
  }
  else {
    console.log(`Total : ${plural(totals.done, 'tuile faite', 'tuiles faites')}, ${formatNumber(totals.skipped)} sautée(s), `
      + `${formatNumber(totals.failed)} en échec, ${plural(totals.places, 'lieu', 'lieux')}, `
      + `${plural(requests, 'requête', 'requêtes')} Overpass, ${duration(Date.now() - started)}.`)
  }
  if (stopped) {
    console.log(`Arrêt : ${stopped}.${notStarted.length ? ` Non traitées : ${notStarted.map(c => c.name).join(', ')}.` : ''}`)
    console.log('Relancer plus tard la même commande : les tuiles déjà chargées seront sautées.')
    exitCode = 2
  }
  else if (totals.failed) {
    console.log('Des tuiles sont en échec : relancer plus tard la même commande pour les reprendre.')
    exitCode = 1
  }
}
catch (error) {
  console.error('Échec du pré-remplissage :', error)
  exitCode = 1
}
finally {
  client.close()
}
process.exit(exitCode)
