/**
 * Socle commun des clients de géocodage (Photon, Nominatim) du proxy
 * `GET /api/geocode?q=` : erreurs, file d'attente globale « 1 requête par
 * seconde », recul sur 429 / 503 (`Retry-After`), dédoublonnage des requêtes en
 * cours, appel HTTP borné dans le temps avec User-Agent identifiable, et aides de
 * mise en forme des libellés partagées par les deux convertisseurs.
 *
 * La requête envoyée au fournisseur est TOUJOURS `normalizeGeocodeQuery(q)` :
 * c'est aussi la clé du cache en base et celle du dédoublonnage ci-dessous.
 *
 * L'espacement est en mémoire du processus : en hébergement serverless, chaque
 * instance a sa propre file, c'est donc un meilleur effort, complété par le cache
 * en base et la limitation de débit par client.
 *
 * Ce fichier est dans un sous-dossier de `server/utils` : il n'est pas auto-importé.
 */
import { normalizeGeocodeQuery, normalizeName } from '../../../shared/text'
import type { GeocodeResult } from '../../../shared/types'
import { PAWSPOT_USER_AGENT } from '../http'

/** Délai maximal d'un appel (réponse et lecture du JSON comprises). */
export const GEOCODER_TIMEOUT_MS = 8_000
/** Espacement minimal entre deux appels au fournisseur (1 requête/s par processus). */
export const GEOCODER_MIN_INTERVAL_MS = 1_000
/**
 * Attente maximale dans la file : au-delà (≈ 3 requêtes déjà en attente), on
 * répond 503 tout de suite plutôt que de faire patienter le client.
 */
export const GEOCODER_MAX_QUEUE_WAIT_MS = 3_000
/** Pause après un 429 / 503 du fournisseur, si `Retry-After` est absent. */
export const GEOCODER_BACKOFF_MS = 30_000
/** Pause maximale acceptée depuis un `Retry-After`. */
export const GEOCODER_BACKOFF_MAX_MS = 10 * 60 * 1000
/** Résultats renvoyés au plus par recherche (le cache en garde au plus 10). */
export const GEOCODER_MAX_RESULTS = 8
/** Valeur de l'en-tête `Retry-After` (secondes) de la réponse 503 de la route. */
export const GEOCODER_RETRY_AFTER_S = Math.ceil((GEOCODER_MIN_INTERVAL_MS * 2) / 1000)

export const LABEL_MAX_LENGTH = 200

/**
 * Codes pays ISO 3166-1 (minuscules) des territoires couverts : France
 * métropolitaine et Corse (`fr`), DROM (Guadeloupe `gp`, Martinique `mq`,
 * Guyane `gf`, La Réunion `re`, Mayotte `yt`) et COM (Saint-Pierre-et-Miquelon `pm`,
 * Saint-Barthélemy `bl`, Saint-Martin `mf`, Polynésie française `pf`,
 * Nouvelle-Calédonie `nc`, Wallis-et-Futuna `wf`). Mêmes territoires que
 * `COVERAGE_AREAS` (shared/geo.ts) : ni TAAF (`tf`) ni Clipperton.
 */
export const GEOCODE_COUNTRY_CODES = ['fr', 'gp', 'mq', 'gf', 're', 'yt', 'pm', 'bl', 'mf', 'pf', 'nc', 'wf'] as const

/** Message de l'erreur 503 renvoyée par `GET /api/geocode` (vouvoiement, sans détail interne). */
export const GEOCODE_UNAVAILABLE_MESSAGE = 'Le service de recherche d\'adresses est momentanément indisponible, réessayez dans quelques instants.'

/** Fournisseur injoignable, en erreur, trop lent, réponse illisible, ou file pleine. */
export class GeocodeServiceError extends Error {
  constructor(message: string, readonly reason: 'queue' | 'timeout' | 'http' | 'network' | 'invalid') {
    super(message)
    this.name = 'GeocodeServiceError'
  }
}

/** Dépendances injectables (les tests n'appellent jamais de service réel). */
export interface GeocoderDeps {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Remplace l'adresse appelée (sans requête : les paramètres sont ajoutés). */
  endpoint?: string
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// Adresse de base configurable
// ---------------------------------------------------------------------------

/**
 * Lit une adresse de base (`NOMINATIM_URL`, `PHOTON_URL`) : seuls `https:` et
 * `http:` sont acceptés, sans identifiants, requête ni fragment ; les `/` finaux
 * sont retirés. Valeur absente, vide ou invalide : `fallback`.
 */
export function parseGeocoderBaseUrl(raw: string | undefined | null, fallback: string): string {
  const value = raw?.trim()
  if (!value) return fallback
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback
    if (url.username || url.password || url.search || url.hash) return fallback
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  }
  catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// File d'attente globale (meilleur effort, par processus)
// ---------------------------------------------------------------------------

/** Prochain instant (ms) où un appel peut partir. */
let nextSlotAt = 0
/** Requêtes identiques en cours (clé = fournisseur + requête normalisée) : un seul appel pour toutes. */
const inFlight = new Map<string, Promise<GeocodeResult[]>>()

/** Remet la file et les requêtes en cours à zéro (tests). */
export function resetGeocoderQueue(): void {
  nextSlotAt = 0
  inFlight.clear()
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Réserve le prochain créneau et attend son heure. La réservation est synchrone
 * (pas de `await` entre la lecture et l'écriture de `nextSlotAt`) : deux requêtes
 * simultanées obtiennent deux créneaux espacés d'une seconde.
 * @throws GeocodeServiceError (`queue`) si l'attente dépasserait `GEOCODER_MAX_QUEUE_WAIT_MS`.
 */
export async function waitForGeocoderSlot(deps: GeocoderDeps): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const slot = Math.max(now, nextSlotAt)
  const wait = slot - now
  if (wait > GEOCODER_MAX_QUEUE_WAIT_MS) throw new GeocodeServiceError('File du géocodeur pleine', 'queue')
  nextSlotAt = slot + GEOCODER_MIN_INTERVAL_MS
  if (wait > 0) await (deps.sleep ?? defaultSleep)(wait)
}

/** Repousse le prochain créneau (le fournisseur a demandé de ralentir). */
function backOff(ms: number, deps: GeocoderDeps): void {
  const now = deps.now?.() ?? Date.now()
  nextSlotAt = Math.max(nextSlotAt, now + Math.min(ms, GEOCODER_BACKOFF_MAX_MS))
}

/** En-tête `Retry-After` (secondes ou date HTTP) en millisecondes ; `undefined` si absent ou illisible. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

/**
 * `GET url` + lecture du JSON, bornés à `deps.timeoutMs` (signal + course avec un
 * minuteur), User-Agent PawSpot, ni `Referer` ni cookie. Un 429 / 503 repousse la
 * file (`Retry-After`, sinon `GEOCODER_BACKOFF_MS`).
 * @throws GeocodeServiceError (`timeout`, `network`, `http`, `invalid`).
 */
export async function fetchGeocoderJson(provider: string, url: string, deps: GeocoderDeps): Promise<unknown> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const ms = deps.timeoutMs ?? GEOCODER_TIMEOUT_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GeocodeServiceError(`Délai ${provider} dépassé`, 'timeout'))
    }, ms)
  })
  const run = async () => {
    let response: Response
    try {
      response = await doFetch(url, {
        headers: { 'User-Agent': PAWSPOT_USER_AGENT, 'Accept': 'application/json' },
        signal: controller.signal,
      })
    }
    catch {
      throw new GeocodeServiceError(`${provider} injoignable`, 'network')
    }
    if (response.status === 429 || response.status === 503) {
      const now = deps.now?.() ?? Date.now()
      backOff(parseRetryAfter(response.headers.get('retry-after'), now) ?? GEOCODER_BACKOFF_MS, deps)
    }
    if (!response.ok) throw new GeocodeServiceError(`${provider} HTTP ${response.status}`, 'http')
    try {
      return await response.json() as unknown
    }
    catch {
      throw new GeocodeServiceError(`Réponse ${provider} illisible`, 'invalid')
    }
  }
  try {
    return await Promise.race([run(), timeout])
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Exécute `run(normalizedQuery)` une seule fois pour toutes les requêtes
 * identiques en cours : la clé est `provider` + `normalizeGeocodeQuery(query)`,
 * c'est-à-dire la chaîne même qui est envoyée au fournisseur et sert de clé de cache.
 */
export function dedupeInFlight(
  provider: string,
  query: string,
  run: (normalizedQuery: string) => Promise<GeocodeResult[]>,
): Promise<GeocodeResult[]> {
  const normalized = normalizeGeocodeQuery(query)
  const key = `${provider}:${normalized}`
  const pending = inFlight.get(key)
  if (pending) return pending
  const promise = run(normalized).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

// ---------------------------------------------------------------------------
// Mise en forme commune
// ---------------------------------------------------------------------------

/** Résultats convertis, dans l'ordre, sans doublon (même libellé normalisé), au plus `limit`. */
export function uniqueResults(results: Iterable<GeocodeResult | null>, limit = GEOCODER_MAX_RESULTS): GeocodeResult[] {
  const seen = new Set<string>()
  const out: GeocodeResult[] = []
  for (const result of results) {
    if (!result) continue
    const key = normalizeName(result.label)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(result)
    if (out.length === limit) break
  }
  return out
}

/**
 * Code de département d'après le code postal : `97400` → `974`, `69001` → `69`
 * (pas pour la Corse, `20…` étant ambigu entre 2A et 2B).
 */
export function departmentCodeFromPostcode(postcode: string | undefined): string | undefined {
  if (!postcode || !/^\d{5}$/.test(postcode)) return undefined
  if (postcode.startsWith('97') || postcode.startsWith('98')) return postcode.slice(0, 3)
  if (!postcode.startsWith('20')) return postcode.slice(0, 2)
  return undefined
}

export function joinParts(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p && !!p.trim()).join(', ')
}

/** « 75004 Paris », « Paris » ou `undefined`. */
export function postcodeCity(postcode: string | undefined, city: string | undefined): string | undefined {
  const value = [postcode, city].filter(Boolean).join(' ')
  return value || undefined
}
