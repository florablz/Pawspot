/**
 * Client Overpass : requête construite depuis `shared/categories.ts`, instances
 * de secours essayées dans l'ordre, délai total partagé (le temps non consommé
 * passe aux instances suivantes), disjoncteur par instance,
 * User-Agent identifiable. `fetch` et l'état du disjoncteur sont injectables
 * (les tests n'appellent jamais Overpass en vrai).
 */
import { overpassStatements } from '../../../shared/categories'
import type { CategoryKey } from '../../../shared/categories'
import type { Bbox } from '../../../shared/geo'
import { PAWSPOT_USER_AGENT } from '../../utils/http'

/**
 * Instances publiques, dans l'ordre d'essai (liste par défaut, remplaçable par
 * `OVERPASS_ENDPOINTS`). Toutes figurent dans la liste des instances publiques du
 * wiki OSM, couvrent le monde entier et demandent un usage raisonnable avec un
 * User-Agent identifiable (envoyé à chaque appel) :
 * 1. overpass-api.de (FOSSGIS), instance de référence : < 10 000 requêtes et < 1 Go
 *    par jour ; répond 429 / 504 quand elle est saturée (échec en ~0,1 s) ;
 * 2. maps.mail.ru (VK) : lente mais disponible (~17 s pour une petite requête mesurés
 *    le 2026-11-03) ;
 * 3. overpass.private.coffee ;
 * 4. overpass.kumi.systems.
 * Le volume reste faible : cache par tuiles de 7 jours, au plus une requête par
 * appel, disjoncteur de 2 minutes après un échec.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const

/**
 * Délai maximal d'un essai (une instance). Le temps total, lui, est fixé par
 * l'appelant (`overpassDeadlineMs`) : chaque instance reçoit le temps restant,
 * au plus 20 s. Avec 40 s au total, une instance qui ne répond jamais laisse donc
 * encore ~20 s à la suivante (l'instance lente mais vivante, ~17 s, a sa chance).
 */
export const OVERPASS_TIMEOUT_MS = 20_000
/** Délai total par défaut de `runOverpassQuery`, toutes instances comprises. */
export const OVERPASS_DEADLINE_MS = 40_000
/**
 * Plancher d'un essai : en dessous de ce temps restant, on n'essaie plus d'instance
 * (même une instance en forme met 1 à 3 s pour une requête de quelques tuiles).
 */
export const OVERPASS_MIN_ATTEMPT_MS = 3_000
/**
 * Durée de pause d'une instance après un échec (disjoncteur) : pendant 2 minutes,
 * les requêtes passent directement à l'instance suivante, ou renvoient le cache
 * en `stale`, au lieu d'attendre un nouveau délai dépassé.
 */
export const OVERPASS_CIRCUIT_PAUSE_MS = 2 * 60 * 1000
/** Pause maximale demandée par un en-tête `Retry-After` (HTTP 429 / 503) qu'on accepte de suivre. */
export const OVERPASS_RETRY_AFTER_MAX_MS = 10 * 60 * 1000
/**
 * `[timeout:…]` par défaut de la requête (secondes), cohérent avec `OVERPASS_TIMEOUT_MS`.
 * À chaque essai, il est abaissé au délai réellement accordé moins 2 s
 * (`withServerTimeout`) : le serveur abandonne avant que nous coupions, et une
 * instance chargée accepte plus volontiers une requête au délai annoncé court.
 */
export const OVERPASS_SERVER_TIMEOUT_S = 18

/**
 * Lit une liste d'instances séparées par des virgules (variable `OVERPASS_ENDPOINTS`).
 * Les entrées vides, invalides ou en double sont ignorées (seuls `https:` et `http:`
 * sont acceptés) ; sans aucune entrée valide, la liste par défaut est renvoyée.
 */
export function parseOverpassEndpoints(raw: string | undefined | null): string[] {
  const out: string[] = []
  for (const part of (raw ?? '').split(',')) {
    const value = part.trim()
    if (!value) continue
    try {
      const url = new URL(value)
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !out.includes(url.href)) out.push(url.href)
    }
    catch {
      // Entrée invalide : ignorée.
    }
  }
  return out.length ? out : [...OVERPASS_ENDPOINTS]
}

let configuredCache: { raw: string | undefined; endpoints: string[] } | undefined

/** Instances configurées : `OVERPASS_ENDPOINTS` si défini et valide, sinon la liste par défaut. */
export function configuredOverpassEndpoints(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.OVERPASS_ENDPOINTS
  if (!configuredCache || configuredCache.raw !== raw) configuredCache = { raw, endpoints: parseOverpassEndpoints(raw) }
  return configuredCache.endpoints
}

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
  /** Instances, dans l'ordre (défaut : `configuredOverpassEndpoints()`). */
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
   * (réseau, HTTP 5xx / 429…). Un essai ultérieur avec un délai nettement plus long
   * (plus de `CIRCUIT_LONGER_ATTEMPT_RATIO` fois) reste permis : une instance lente
   * mais vivante, coupée à 10 s pour une emprise déjà en cache, peut encore servir
   * une emprise vide avec 20 s.
   */
  failedWithin: number
}

/** Un essai au moins 1,5 fois plus long que celui qui a expiré passe malgré la pause. */
export const CIRCUIT_LONGER_ATTEMPT_RATIO = 1.5

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
    return attemptMs < entry.failedWithin * CIRCUIT_LONGER_ATTEMPT_RATIO
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

/**
 * Requête de tous les lieux des catégories dans l'emprise (format `[bbox:sud,ouest,nord,est]`).
 * `serverTimeoutS` : `[timeout:N]` annoncé (défaut `OVERPASS_SERVER_TIMEOUT_S` ; plus long
 * pour le pré-remplissage, qui n'a pas d'utilisateur qui attend). Il est ensuite abaissé
 * au délai de chaque essai par `withServerTimeout`.
 */
export function buildOverpassBboxQuery(bbox: Bbox, categories?: readonly CategoryKey[], serverTimeoutS: number = OVERPASS_SERVER_TIMEOUT_S): string {
  const b = `${coord(bbox.minLat)},${coord(bbox.minLon)},${coord(bbox.maxLat)},${coord(bbox.maxLon)}`
  const statements = overpassStatements(categories).map(s => `  ${s}`).join('\n')
  const timeout = Math.max(1, Math.trunc(serverTimeoutS))
  return `[out:json][timeout:${timeout}][bbox:${b}];\n(\n${statements}\n);\nout center tags qt;`
}

/**
 * Abaisse le `[timeout:N]` de la requête au délai accordé à l'essai, moins 2 s
 * (au moins 1 s) : jamais au-dessus de la valeur d'origine.
 */
export function withServerTimeout(query: string, attemptMs: number): string {
  const target = Math.max(1, Math.floor(attemptMs / 1000) - 2)
  return query.replace(/\[timeout:(\d+)\]/, (_, n: string) => `[timeout:${Math.min(Number(n), target)}]`)
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
 * Intervalle de contrôle de l'horloge murale pendant un essai. Les minuteurs de Node
 * (`setTimeout`) suivent une horloge monotone qui, sous macOS, s'arrête pendant la
 * mise en veille de l'ordinateur : un essai de 90 s commencé avant une veille de
 * 18 minutes ne se terminait qu'à la reprise + le reste des 90 s, soit ~19 min
 * « réelles » (constaté le 2026-11-03 avec `places:prefetch`). On vérifie donc aussi
 * `Date.now()` chaque seconde : à la reprise, l'essai expiré est coupé tout de suite.
 */
export const ATTEMPT_CLOCK_CHECK_MS = 1_000

/**
 * Arme l'expiration d'un essai de `ms` : `onExpire` est appelé dès que `ms` se sont
 * écoulées sur l'horloge murale (`Date.now()`) ou sur l'horloge monotone
 * (`performance.now()`, insensible aux changements d'heure), la première des deux.
 * Renvoie la fonction qui désarme le minuteur.
 */
export function armAttemptTimer(ms: number, onExpire: () => void): () => void {
  const wallDeadline = Date.now() + ms
  const monoStart = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const tick = () => {
    if (done) return
    const left = Math.min(wallDeadline - Date.now(), ms - (performance.now() - monoStart))
    if (left <= 0) {
      done = true
      onExpire()
      return
    }
    timer = setTimeout(tick, Math.min(left, ATTEMPT_CLOCK_CHECK_MS))
  }
  timer = setTimeout(tick, Math.min(Math.max(0, ms), ATTEMPT_CLOCK_CHECK_MS))
  return () => {
    done = true
    clearTimeout(timer)
  }
}

/**
 * `fetch` + lecture complète du corps (JSON), bornés ensemble à `ms` : le minuteur
 * est armé avant `fetch`, le signal annule la requête et la lecture du corps, et la
 * course avec le minuteur garantit le délai même si `fetch` (ou le corps) ignorait
 * le signal ; le corps est alors abandonné (`cancel`) pour libérer la connexion.
 */
async function fetchJson(doFetch: typeof fetch, endpoint: string, init: RequestInit, ms: number): Promise<{ status: number; data?: OverpassResponse; retryAfterMs?: number }> {
  const controller = new AbortController()
  let response: Response | undefined
  let disarm: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    disarm = armAttemptTimer(ms, () => {
      const err = new AttemptTimeout()
      controller.abort(err)
      cancelBody(response, err)
      reject(err)
    })
  })
  const work = (async () => {
    response = await doFetch(endpoint, { ...init, signal: controller.signal })
    if (!response.ok) {
      cancelBody(response)
      return { status: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), Date.now()) }
    }
    return { status: response.status, data: await response.json() as OverpassResponse }
  })()
  work.catch(() => {}) // rejet tardif après expiration du minuteur : déjà traité
  try {
    return await Promise.race([work, timeout])
  }
  finally {
    disarm?.()
  }
}

function cancelBody(response: Response | undefined, reason?: unknown): void {
  try {
    // Corps déjà en cours de lecture (verrouillé) : `cancel` rejette, le signal suffit alors.
    response?.body?.cancel(reason).catch(() => {})
  }
  catch {
    // Corps déjà consommé : rien à libérer.
  }
}

/** En-tête `Retry-After` (secondes ou date HTTP) en millisecondes ; `undefined` si absent ou illisible. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/** HTTP 400 : requête refusée (erreur de notre côté), l'instance n'est pas en cause. */
function statusTripsCircuit(status: number): boolean {
  return status !== 400
}

/**
 * Exécute la requête sur chaque instance, dans l'ordre, jusqu'au premier succès.
 * - Budget : délai total `overpassDeadlineMs` ; chaque essai reçoit le temps restant,
 *   au plus `overpassTimeoutMs`. Une instance qui échoue vite (HTTP 429 / 502 / 504
 *   « at capacity » en 0,1 s) laisse donc tout son temps aux suivantes. Plus aucun
 *   essai quand il reste moins de `OVERPASS_MIN_ATTEMPT_MS`.
 * - `[timeout:N]` de la requête abaissé au délai de chaque essai (`withServerTimeout`).
 * - Disjoncteur par instance : une instance en échec récent est sautée sans appel
 *   réseau (après un délai dépassé, seulement pour des essais pas nettement plus
 *   longs) ; si toutes le sont, l'erreur est immédiate. HTTP 429 (saturation) : on
 *   passe à la suivante, et la pause suit `Retry-After` s'il est plus long (≤ 10 min).
 * - Un `remark` contenant « runtime error » (délai ou mémoire dépassés côté Overpass,
 *   résultat partiel) compte comme un échec, sans couper le disjoncteur (cela dépend
 *   de la requête, pas de l'instance) : on ne veut pas marquer une tuile comme
 *   chargée avec des données incomplètes.
 * @throws OverpassError si toutes les instances échouent ou sont en pause.
 */
export async function runOverpassQuery(query: string, deps: OverpassDeps = {}): Promise<OverpassElement[]> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const endpoints = deps.overpassEndpoints ?? configuredOverpassEndpoints()
  const timeoutMs = deps.overpassTimeoutMs ?? OVERPASS_TIMEOUT_MS
  const deadlineMs = deps.overpassDeadlineMs ?? OVERPASS_DEADLINE_MS
  const circuit = deps.overpassCircuit ?? defaultOverpassCircuit
  const pauseMs = deps.overpassCircuitPauseMs ?? OVERPASS_CIRCUIT_PAUSE_MS
  const minAttemptMs = Math.min(OVERPASS_MIN_ATTEMPT_MS, timeoutMs)
  const attempts: string[] = []
  const start = Date.now()

  for (const endpoint of endpoints) {
    const host = new URL(endpoint).host
    const now = Date.now()
    const remaining = deadlineMs - (now - start)
    const attemptMs = Math.min(timeoutMs, remaining)
    if (circuit.isOpen(endpoint, attemptMs, now)) {
      attempts.push(`${host}: en pause après un échec récent`)
      continue
    }
    if (remaining < minAttemptMs) {
      attempts.push(`${host}: délai total dépassé`)
      break
    }
    try {
      const { status, data, retryAfterMs } = await fetchJson(doFetch, endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: withServerTimeout(query, attemptMs) }).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': PAWSPOT_USER_AGENT,
        },
      }, attemptMs)
      if (!data) {
        attempts.push(`${host}: HTTP ${status}${status === 429 ? ' (saturée)' : ''}`)
        if (statusTripsCircuit(status)) {
          const pause = pauseMs > 0 && retryAfterMs !== undefined
            ? Math.max(pauseMs, Math.min(retryAfterMs, OVERPASS_RETRY_AFTER_MAX_MS))
            : pauseMs
          circuit.recordFailure(endpoint, Date.now(), pause)
        }
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
      circuit.recordFailure(endpoint, Date.now(), pauseMs, timedOut ? attemptMs : undefined)
    }
  }
  throw new OverpassError(attempts)
}
