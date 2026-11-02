/**
 * Client Overpass : requête construite depuis `shared/categories.ts`, instance
 * de secours, délai par instance et délai total, disjoncteur par instance,
 * User-Agent identifiable. `fetch` et l'état du disjoncteur sont injectables
 * (les tests n'appellent jamais Overpass en vrai).
 */
import { overpassStatements } from '../../../shared/categories'
import type { CategoryKey } from '../../../shared/categories'
import type { Bbox } from '../../../shared/geo'
import { PAWSPOT_USER_AGENT } from '../../utils/http'

/** Instance principale puis instance de secours. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const

/** Délai maximal côté client, par instance. */
export const OVERPASS_TIMEOUT_MS = 25_000
/**
 * Délai total par défaut de `runOverpassQuery`, toutes instances comprises
 * (réparti entre les instances disponibles : 12,5 s chacune avec deux instances).
 */
export const OVERPASS_DEADLINE_MS = 25_000
/** En dessous de ce temps restant, on n'essaie plus d'instance (l'essai n'aurait aucune chance d'aboutir). */
export const OVERPASS_MIN_ATTEMPT_MS = 500
/**
 * Durée de pause d'une instance après un échec (disjoncteur) : pendant 2 minutes,
 * les requêtes passent directement à l'instance suivante, ou renvoient le cache
 * en `stale`, au lieu d'attendre un nouveau délai dépassé.
 */
export const OVERPASS_CIRCUIT_PAUSE_MS = 2 * 60 * 1000
/** Délai demandé au serveur Overpass (`[timeout:…]`), un peu sous le délai client. */
export const OVERPASS_SERVER_TIMEOUT_S = 23

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export interface OverpassDeps {
  fetch?: typeof fetch
  overpassEndpoints?: readonly string[]
  /** Délai maximal par instance (défaut `OVERPASS_TIMEOUT_MS`). */
  overpassTimeoutMs?: number
  /** Délai total de la requête, toutes instances comprises (défaut `OVERPASS_DEADLINE_MS`). */
  overpassDeadlineMs?: number
  /** État du disjoncteur (défaut : celui du processus, `defaultOverpassCircuit`). */
  overpassCircuit?: OverpassCircuit
  /** Durée de pause d'une instance après un échec (défaut `OVERPASS_CIRCUIT_PAUSE_MS` ; `0` désactive le disjoncteur). */
  overpassCircuitPauseMs?: number
}

// ---------------------------------------------------------------------------
// Disjoncteur
// ---------------------------------------------------------------------------

interface CircuitEntry {
  /** Fin de la pause (ms depuis l'époque). */
  until: number
  /**
   * Délai accordé lors de l'essai qui a expiré ; `Infinity` pour une erreur franche
   * (réseau, HTTP 5xx / 429…). Un essai ultérieur avec un délai plus long que
   * celui-ci reste permis : une instance lente mais vivante, coupée à 5 s pour une
   * emprise déjà en cache, peut encore servir une emprise vide avec 12,5 s.
   */
  failedWithin: number
}

/**
 * Mémoire des échecs récents, par URL d'instance.
 *
 * Meilleur effort : l'état vit dans la mémoire du processus. En serverless, chaque
 * instance de fonction a le sien (et le perd à chaque démarrage à froid) ; une
 * instance qui n'a pas encore vu l'échec paiera un délai une fois. C'est acceptable :
 * le but est d'éviter d'attendre à chaque requête, pas de coordonner les instances.
 */
export class OverpassCircuit {
  private readonly entries = new Map<string, CircuitEntry>()

  /** Vrai si l'instance est en pause pour un essai de `attemptMs` à l'instant `now`. */
  isOpen(endpoint: string, attemptMs: number, now: number): boolean {
    const entry = this.entries.get(endpoint)
    if (!entry) return false
    if (now >= entry.until) {
      this.entries.delete(endpoint)
      return false
    }
    return attemptMs <= entry.failedWithin
  }

  recordFailure(endpoint: string, now: number, pauseMs: number, failedWithin = Number.POSITIVE_INFINITY): void {
    if (pauseMs <= 0) return
    const previous = this.entries.get(endpoint)
    const keep = previous && now < previous.until ? previous.failedWithin : 0
    this.entries.set(endpoint, { until: now + pauseMs, failedWithin: Math.max(keep, failedWithin) })
  }

  recordSuccess(endpoint: string): void {
    this.entries.delete(endpoint)
  }

  reset(): void {
    this.entries.clear()
  }
}

/** Disjoncteur partagé par le processus. */
export const defaultOverpassCircuit = new OverpassCircuit()

/** Oublie tous les échecs mémorisés (tests, ou après un incident résolu). */
export function resetOverpassCircuit(): void {
  defaultOverpassCircuit.reset()
}

/** Échec sur toutes les instances. `attempts` : une ligne par instance (sans données sensibles). */
export class OverpassError extends Error {
  constructor(readonly attempts: string[]) {
    super(`Overpass indisponible (${attempts.join(' ; ')})`)
    this.name = 'OverpassError'
  }
}

function coord(n: number): string {
  return n.toFixed(6)
}

/** Requête de tous les lieux des catégories dans l'emprise (format `[bbox:sud,ouest,nord,est]`). */
export function buildOverpassBboxQuery(bbox: Bbox, categories?: readonly CategoryKey[]): string {
  const b = `${coord(bbox.minLat)},${coord(bbox.minLon)},${coord(bbox.maxLat)},${coord(bbox.maxLon)}`
  const statements = overpassStatements(categories).map(s => `  ${s}`).join('\n')
  return `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}][bbox:${b}];\n(\n${statements}\n);\nout center tags qt;`
}

/** Requête d'un seul élément OSM. */
export function buildOverpassElementQuery(type: 'node' | 'way' | 'relation', id: number): string {
  return `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];\n${type}(${Math.trunc(id)});\nout center tags;`
}

interface OverpassResponse {
  elements?: unknown
  remark?: unknown
}

function isElement(e: unknown): e is OverpassElement {
  if (!e || typeof e !== 'object') return false
  const el = e as Record<string, unknown>
  return (el.type === 'node' || el.type === 'way' || el.type === 'relation') && typeof el.id === 'number'
}

class AttemptTimeout extends Error {
  constructor() {
    super('délai dépassé')
    this.name = 'TimeoutError'
  }
}

/**
 * `fetch` + lecture du JSON, bornés à `ms` : le signal annule la requête, et la
 * course avec le minuteur garantit le délai même si `fetch` ignorait le signal.
 */
async function fetchJson(doFetch: typeof fetch, endpoint: string, init: RequestInit, ms: number): Promise<{ status: number; data?: OverpassResponse }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new AttemptTimeout()
      controller.abort(err)
      reject(err)
    }, ms)
  })
  const work = (async () => {
    const response = await doFetch(endpoint, { ...init, signal: controller.signal })
    if (!response.ok) return { status: response.status }
    return { status: response.status, data: await response.json() as OverpassResponse }
  })()
  work.catch(() => {}) // rejet tardif après expiration du minuteur : déjà traité
  try {
    return await Promise.race([work, timeout])
  }
  finally {
    clearTimeout(timer)
  }
}

/** HTTP 400 : requête refusée (erreur de notre côté), l'instance n'est pas en cause. */
function statusTripsCircuit(status: number): boolean {
  return status !== 400
}

/**
 * Exécute la requête sur chaque instance jusqu'au premier succès.
 * - Délai total `overpassDeadlineMs`, réparti entre les instances disponibles
 *   (chacune au plus `overpassTimeoutMs`) ; une instance qui échoue vite laisse
 *   son temps aux suivantes.
 * - Disjoncteur : une instance en échec récent est sautée sans appel réseau ; si
 *   toutes le sont, l'erreur est immédiate.
 * - Un `remark` contenant « runtime error » (délai ou mémoire dépassés côté Overpass,
 *   résultat partiel) compte comme un échec, sans couper le disjoncteur (cela dépend
 *   de la requête, pas de l'instance) : on ne veut pas marquer une tuile comme
 *   chargée avec des données incomplètes.
 * @throws OverpassError si toutes les instances échouent ou sont en pause.
 */
export async function runOverpassQuery(query: string, deps: OverpassDeps = {}): Promise<OverpassElement[]> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const endpoints = deps.overpassEndpoints ?? OVERPASS_ENDPOINTS
  const timeoutMs = deps.overpassTimeoutMs ?? OVERPASS_TIMEOUT_MS
  const deadlineMs = deps.overpassDeadlineMs ?? OVERPASS_DEADLINE_MS
  const circuit = deps.overpassCircuit ?? defaultOverpassCircuit
  const pauseMs = deps.overpassCircuitPauseMs ?? OVERPASS_CIRCUIT_PAUSE_MS
  const attempts: string[] = []
  const start = Date.now()

  // Délai nominal d'un essai pour cet appel : sert à décider quelles instances sont en pause.
  const share = Math.min(timeoutMs, deadlineMs / Math.max(endpoints.length, 1))
  const available = endpoints.filter((endpoint) => {
    if (!circuit.isOpen(endpoint, share, start)) return true
    attempts.push(`${new URL(endpoint).host}: en pause après un échec récent`)
    return false
  })

  for (const [i, endpoint] of available.entries()) {
    const host = new URL(endpoint).host
    const remaining = deadlineMs - (Date.now() - start)
    if (remaining < OVERPASS_MIN_ATTEMPT_MS) {
      attempts.push(`${host}: délai total dépassé`)
      break
    }
    const attemptMs = Math.min(timeoutMs, remaining / (available.length - i))
    try {
      const { status, data } = await fetchJson(doFetch, endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': PAWSPOT_USER_AGENT,
        },
      }, attemptMs)
      if (!data) {
        attempts.push(`${host}: HTTP ${status}`)
        if (statusTripsCircuit(status)) circuit.recordFailure(endpoint, Date.now(), pauseMs)
        continue
      }
      if (typeof data.remark === 'string' && /runtime error/i.test(data.remark)) {
        attempts.push(`${host}: résultat partiel`)
        continue
      }
      if (!Array.isArray(data.elements)) {
        attempts.push(`${host}: réponse invalide`)
        circuit.recordFailure(endpoint, Date.now(), pauseMs)
        continue
      }
      circuit.recordSuccess(endpoint)
      return data.elements.filter(isElement)
    }
    catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      const timedOut = name === 'TimeoutError' || name === 'AbortError'
      attempts.push(`${host}: ${timedOut ? 'délai dépassé' : 'erreur réseau ou JSON'}`)
      // Au moins `share` : la dernière instance reçoit le temps restant, à peine moins que `share`.
      circuit.recordFailure(endpoint, Date.now(), pauseMs, timedOut ? Math.max(attemptMs, share) : undefined)
    }
  }
  throw new OverpassError(attempts)
}
