/**
 * Fonctions pures du pré-remplissage (`scripts/places-prefetch.ts`) : lecture des
 * options, choix des villes, état des instances, mise en forme des durées.
 * Importable sans effet de bord (aucune connexion à la base, aucun `process.exit`,
 * aucun appel réseau) : les tests l'utilisent directement.
 */
import { findPrefetchCity, PREFETCH_CITIES } from '../shared/cities'
import type { PrefetchCity } from '../shared/cities'
import type { OverpassCircuit } from '../server/services/places/overpass'

export const PREFETCH_HELP = `Usage : npx tsx scripts/places-prefetch.ts [options]
  --city=Paris[,Lyon]    villes à traiter (répétable ; défaut : toutes)
  --list                 affiche les villes et leur nombre de tuiles
  --dry-run              compte les tuiles à charger, sans appeler Overpass
  --force                recharge aussi les tuiles fraîches (< 7 jours)
  --pause=5              pause entre deux requêtes Overpass, en secondes
  --timeout=90           délai maximal d'un essai (une instance), en secondes
  --tiles-per-request=4  tuiles au plus par requête Overpass (1 à 8)
Base distante refusée sauf PREFETCH_ALLOW_REMOTE=1.
macOS : lancer avec « caffeinate -i npx tsx scripts/places-prefetch.ts … »
pour que l'ordinateur ne se mette pas en veille pendant le chargement.`

export interface PrefetchOptions {
  cities: string[]
  list: boolean
  dryRun: boolean
  force: boolean
  help: boolean
  pauseMs: number
  timeoutMs: number
  tilesPerRequest: number
}

export const DEFAULT_PREFETCH_OPTIONS: Readonly<Omit<PrefetchOptions, 'cities'>> = {
  list: false,
  dryRun: false,
  force: false,
  help: false,
  pauseMs: 5_000,
  timeoutMs: 90_000,
  tilesPerRequest: 4,
}

/** Option ou ville invalide : le message est destiné à l'utilisateur (code de sortie 1). */
export class PrefetchUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrefetchUsageError'
  }
}

function numberOption(name: string, value: string, min: number, max: number): number {
  const n = Number(value)
  if (!value.trim() || !Number.isFinite(n) || n < min || n > max) {
    throw new PrefetchUsageError(`Option --${name} invalide : « ${value} » (attendu entre ${min} et ${max}).`)
  }
  return n
}

/**
 * Lit les options de la ligne de commande (sans `node` ni le nom du script).
 * `--help` / `-h` donne `help: true` (à l'appelant d'afficher `PREFETCH_HELP`).
 * @throws PrefetchUsageError option inconnue, `--city` vide, nombre hors bornes
 *   (`--pause` 0 à 600 s, `--timeout` 10 à 600 s, `--tiles-per-request` 1 à 8).
 */
export function parseArgs(argv: readonly string[]): PrefetchOptions {
  const options: PrefetchOptions = { ...DEFAULT_PREFETCH_OPTIONS, cities: [] }
  for (const arg of argv) {
    const [name, ...rest] = arg.split('=')
    const value = rest.join('=')
    switch (name) {
      case '--city':
        if (!value.trim()) throw new PrefetchUsageError('Option --city vide : ex. --city=Paris ou --city=Paris,Lyon.')
        options.cities.push(...value.split(',').map(v => v.trim()).filter(Boolean))
        break
      case '--list': options.list = true; break
      case '--dry-run': options.dryRun = true; break
      case '--force': options.force = true; break
      case '--pause': options.pauseMs = numberOption('pause', value, 0, 600) * 1000; break
      case '--timeout': options.timeoutMs = numberOption('timeout', value, 10, 600) * 1000; break
      case '--tiles-per-request': options.tilesPerRequest = Math.trunc(numberOption('tiles-per-request', value, 1, 8)); break
      case '--help': case '-h': options.help = true; break
      default:
        throw new PrefetchUsageError(`Option inconnue : ${arg}\n\n${PREFETCH_HELP}`)
    }
  }
  return options
}

/**
 * Villes à traiter : toutes (`PREFETCH_CITIES`) si `names` est vide, sinon celles
 * nommées (`findPrefetchCity` : nom ou clé, sans casse ni accents), sans doublon,
 * dans l'ordre donné.
 * @throws PrefetchUsageError si une ville est inconnue (toutes les inconnues sont citées).
 */
export function selectCities(names: readonly string[], all: readonly PrefetchCity[] = PREFETCH_CITIES): PrefetchCity[] {
  if (!names.length) return [...all]
  const selected: PrefetchCity[] = []
  const unknown: string[] = []
  for (const name of names) {
    const city = findPrefetchCity(name, all)
    if (!city) unknown.push(name)
    else if (!selected.includes(city)) selected.push(city)
  }
  if (unknown.length) throw new PrefetchUsageError(`Ville inconnue : ${unknown.join(', ')}. Liste des villes : --list.`)
  return selected
}

/** Vrai si chaque instance est en pause (disjoncteur) pour un essai de `attemptMs` à l'instant `now`. */
export function allInstancesPaused(endpoints: readonly string[], circuit: Pick<OverpassCircuit, 'isOpen'>, attemptMs: number, now: number): boolean {
  return endpoints.every(e => circuit.isOpen(e, attemptMs, now))
}

/** Marge au-delà du délai total d'une requête avant de soupçonner une mise en veille. */
export const SLEEP_SUSPICION_MARGIN_MS = 30_000

/**
 * Une requête a-t-elle duré nettement plus que son délai total (`budgetMs`) ?
 * Les délais sont garantis sur l'horloge murale ; un tel écart signifie que le
 * processus a été suspendu (veille de l'ordinateur), pas qu'une instance a traîné.
 */
export function suspectedSleep(elapsedMs: number, budgetMs: number, marginMs = SLEEP_SUSPICION_MARGIN_MS): boolean {
  return elapsedMs > budgetMs + marginMs
}

const fmt = new Intl.NumberFormat('fr-FR')

/** Nombre au format français (`5 887`). */
export function formatNumber(n: number): string {
  return fmt.format(n)
}

/** Durée lisible : `4,2 s` sous la minute, sinon `19 min 13 s`. */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`
  let m = Math.floor(s / 60)
  let rest = Math.round(s - m * 60)
  if (rest === 60) {
    m++
    rest = 0
  }
  return `${m} min ${String(rest).padStart(2, '0')} s`
}

/** `1 tuile`, `2 tuiles`, `5 887 lieux`. */
export function plural(n: number, one: string, many: string): string {
  return `${fmt.format(n)} ${n > 1 ? many : one}`
}
