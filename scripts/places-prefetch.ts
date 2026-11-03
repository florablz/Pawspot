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
 * Garde-fou : refuse une base distante (`DATABASE_URL` non `file:`) sauf
 * `PREFETCH_ALLOW_REMOTE=1` (prod : à lancer explicitement, en surveillant le
 * volume de l'offre gratuite de Turso).
 *
 * Code de sortie : 0 si tout est fait, 1 si des tuiles sont en échec ou en cas
 * d'erreur, 2 si le script s'est arrêté (instances en pause ou Ctrl-C).
 */
import './db-env'
import { cityBbox, cityTileCount, cityTileRange, findPrefetchCity, PREFETCH_CITIES } from '../shared/cities'
import type { PrefetchCity } from '../shared/cities'
import { bboxCenter, tileRangeSize } from '../shared/geo'
import type { TileRange } from '../shared/geo'

const HELP = `Usage : npx tsx scripts/places-prefetch.ts [options]
  --city=Paris[,Lyon]    villes à traiter (répétable ; défaut : toutes)
  --list                 affiche les villes et leur nombre de tuiles
  --dry-run              compte les tuiles à charger, sans appeler Overpass
  --force                recharge aussi les tuiles fraîches (< 7 jours)
  --pause=5              pause entre deux requêtes Overpass, en secondes
  --timeout=90           délai maximal d'un essai (une instance), en secondes
  --tiles-per-request=4  tuiles au plus par requête Overpass (1 à 8)
Base distante refusée sauf PREFETCH_ALLOW_REMOTE=1.`

interface Options {
  cities: string[]
  list: boolean
  dryRun: boolean
  force: boolean
  pauseMs: number
  timeoutMs: number
  tilesPerRequest: number
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function numberOption(name: string, value: string, min: number, max: number): number {
  const n = Number(value)
  if (!value.trim() || !Number.isFinite(n) || n < min || n > max) fail(`Option --${name} invalide : « ${value} » (attendu entre ${min} et ${max}).`)
  return n
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { cities: [], list: false, dryRun: false, force: false, pauseMs: 5_000, timeoutMs: 90_000, tilesPerRequest: 4 }
  for (const arg of argv) {
    const [name, ...rest] = arg.split('=')
    const value = rest.join('=')
    switch (name) {
      case '--city':
        options.cities.push(...value.split(',').map(v => v.trim()).filter(Boolean))
        if (!value.trim()) fail('Option --city vide : ex. --city=Paris ou --city=Paris,Lyon.')
        break
      case '--list': options.list = true; break
      case '--dry-run': options.dryRun = true; break
      case '--force': options.force = true; break
      case '--pause': options.pauseMs = numberOption('pause', value, 0, 600) * 1000; break
      case '--timeout': options.timeoutMs = numberOption('timeout', value, 10, 600) * 1000; break
      case '--tiles-per-request': options.tilesPerRequest = Math.trunc(numberOption('tiles-per-request', value, 1, 8)); break
      case '--help': case '-h':
        console.log(HELP)
        process.exit(0)
        break
      default:
        fail(`Option inconnue : ${arg}\n\n${HELP}`)
    }
  }
  return options
}

function selectCities(names: readonly string[]): PrefetchCity[] {
  if (!names.length) return [...PREFETCH_CITIES]
  const selected: PrefetchCity[] = []
  const unknown: string[] = []
  for (const name of names) {
    const city = findPrefetchCity(name)
    if (!city) unknown.push(name)
    else if (!selected.includes(city)) selected.push(city)
  }
  if (unknown.length) fail(`Ville inconnue : ${unknown.join(', ')}. Liste des villes : --list.`)
  return selected
}

const fmt = new Intl.NumberFormat('fr-FR')

function duration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`
  const m = Math.floor(s / 60)
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s`
}

function plural(n: number, one: string, many: string): string {
  return `${fmt.format(n)} ${n > 1 ? many : one}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const options = parseArgs(process.argv.slice(2))
const cities = selectCities(options.cities)

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
  const now = Date.now()
  return endpoints.every(e => circuit.isOpen(e, options.timeoutMs, now))
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
        console.log(`${label} : échec en ${duration(Date.now() - t0)} (${error.attempts.join(' ; ')})`)
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
    console.log(`${city.name} : ${plural(stats.done, 'tuile faite', 'tuiles faites')}, ${fmt.format(stats.skipped)} sautée(s), `
      + `${fmt.format(stats.failed)} en échec, ${plural(stats.places, 'lieu', 'lieux')}, ${duration(Date.now() - cityStart)}.`)
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
    console.log(`Total : ${plural(totals.done, 'tuile faite', 'tuiles faites')}, ${fmt.format(totals.skipped)} sautée(s), `
      + `${fmt.format(totals.failed)} en échec, ${plural(totals.places, 'lieu', 'lieux')}, `
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
