/**
 * Client Nominatim pour le proxy `GET /api/geocode?q=` (§3.2, §4.3) : file
 * d'attente « 1 requête par seconde », délai maximal, User-Agent identifiable,
 * conversion des réponses en `GeocodeResult` (France, DROM et COM uniquement).
 *
 * Politique d'usage de Nominatim (https://operations.osmfoundation.org/policies/nominatim/) :
 * - au plus 1 requête par seconde pour toute l'application : espacement global
 *   ci-dessous, plus le cache en base (`server/services/geocode`, 30 jours) ;
 * - User-Agent identifiant l'application (`PAWSPOT_USER_AGENT`). Côté serveur il n'y
 *   a pas de page d'origine : on n'envoie pas de `Referer`, ni de paramètre `email`
 *   (pas d'adresse personnelle ; le UA pointe vers le dépôt) ;
 * - pas de recherche « au fil de la frappe » sans cache : le front doit attendre
 *   la fin de saisie (debounce) et le serveur dédoublonne les requêtes identiques
 *   en cours.
 *
 * L'espacement est en mémoire du processus : en hébergement serverless, chaque
 * instance a sa propre file, c'est donc un meilleur effort. La limitation de débit
 * par client stockée en base (Phase 3, §4.5) complétera ce garde-fou.
 *
 * `fetch` et l'horloge sont injectables (les tests n'appellent jamais Nominatim).
 */
import { z } from 'zod'
import { geocodeResultSchema } from '../../shared/schemas'
import { isInCoverage, isValidBbox } from '../../shared/geo'
import type { Bbox } from '../../shared/geo'
import { normalizeName } from '../../shared/text'
import type { GeocodeResult, GeocodeResultType } from '../../shared/types'
import { PAWSPOT_USER_AGENT } from './http'

/** Adresse de base par défaut (instance publique de l'OSMF). */
export const NOMINATIM_DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org'
export const NOMINATIM_SEARCH_URL = `${NOMINATIM_DEFAULT_BASE_URL}/search`

/**
 * Lit l'adresse de base de Nominatim (variable `NOMINATIM_URL`, sans `/search`),
 * par ex. un serveur local pour les tests de bout en bout. Seuls `https:` et `http:`
 * sont acceptés, sans identifiants, requête ni fragment ; le `/` final est retiré.
 * Valeur absente, vide ou invalide : `NOMINATIM_DEFAULT_BASE_URL`.
 */
export function parseNominatimBaseUrl(raw: string | undefined | null): string {
  const value = raw?.trim()
  if (!value) return NOMINATIM_DEFAULT_BASE_URL
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return NOMINATIM_DEFAULT_BASE_URL
    if (url.username || url.password || url.search || url.hash) return NOMINATIM_DEFAULT_BASE_URL
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  }
  catch {
    return NOMINATIM_DEFAULT_BASE_URL
  }
}

/**
 * Adresse de recherche configurée, lue à chaque appel (les tests peuvent changer
 * `NOMINATIM_URL` sans recharger le module).
 */
export function configuredNominatimSearchUrl(env: Record<string, string | undefined> = process.env): string {
  return `${parseNominatimBaseUrl(env.NOMINATIM_URL)}/search`
}

/**
 * Codes pays ISO 3166-1 acceptés par Nominatim (`countrycodes`) : France
 * métropolitaine et Corse (`fr`), DROM (Guadeloupe `gp`, Martinique `mq`,
 * Guyane `gf`, La Réunion `re`, Mayotte `yt`) et COM (Saint-Pierre-et-Miquelon `pm`,
 * Saint-Barthélemy `bl`, Saint-Martin `mf`, Polynésie française `pf`,
 * Nouvelle-Calédonie `nc`, Wallis-et-Futuna `wf`). Mêmes territoires que
 * `COVERAGE_AREAS` (shared/geo.ts) : ni TAAF (`tf`) ni Clipperton.
 */
export const NOMINATIM_COUNTRY_CODES = ['fr', 'gp', 'mq', 'gf', 're', 'yt', 'pm', 'bl', 'mf', 'pf', 'nc', 'wf'] as const

/** Résultats demandés à Nominatim (le cache en garde au plus 10). */
export const NOMINATIM_LIMIT = 8
/** Délai maximal d'un appel (réponse et lecture du JSON comprises). */
export const NOMINATIM_TIMEOUT_MS = 8_000
/** Espacement minimal entre deux appels (politique : 1 requête/s). */
export const NOMINATIM_MIN_INTERVAL_MS = 1_000
/**
 * Attente maximale dans la file : au-delà (≈ 3 requêtes déjà en attente), on
 * répond 503 tout de suite plutôt que de faire patienter le client.
 */
export const NOMINATIM_MAX_QUEUE_WAIT_MS = 3_000
/** Pause après un 429 / 503 de Nominatim, si `Retry-After` est absent. */
export const NOMINATIM_BACKOFF_MS = 30_000
/** Pause maximale acceptée depuis un `Retry-After`. */
export const NOMINATIM_BACKOFF_MAX_MS = 10 * 60 * 1000

const LABEL_MAX_LENGTH = 200

/** Message de l'erreur 503 renvoyée par `GET /api/geocode` (vouvoiement, sans détail interne). */
export const GEOCODE_UNAVAILABLE_MESSAGE = 'Le service de recherche d\'adresses est momentanément indisponible, réessayez dans quelques instants.'

/** Nominatim injoignable, en erreur, trop lent, réponse illisible, ou file pleine. */
export class GeocodeServiceError extends Error {
  constructor(message: string, readonly reason: 'queue' | 'timeout' | 'http' | 'network' | 'invalid') {
    super(message)
    this.name = 'GeocodeServiceError'
  }
}

// ---------------------------------------------------------------------------
// File d'attente globale (meilleur effort, par processus)
// ---------------------------------------------------------------------------

export interface NominatimDeps {
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Remplace l'adresse de recherche (défaut : `configuredNominatimSearchUrl()`). */
  endpoint?: string
  timeoutMs?: number
}

/** Prochain instant (ms) où un appel peut partir. */
let nextSlotAt = 0
/** Requêtes identiques en cours (clé = requête normalisée) : un seul appel pour toutes. */
const inFlight = new Map<string, Promise<GeocodeResult[]>>()

/** Remet la file à zéro (tests). */
export function resetNominatimQueue(): void {
  nextSlotAt = 0
  inFlight.clear()
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Réserve le prochain créneau et attend son heure. La réservation est synchrone
 * (pas de `await` entre la lecture et l'écriture de `nextSlotAt`) : deux requêtes
 * simultanées obtiennent deux créneaux espacés d'une seconde.
 * @throws GeocodeServiceError (`queue`) si l'attente dépasserait `NOMINATIM_MAX_QUEUE_WAIT_MS`.
 */
async function waitForSlot(deps: NominatimDeps): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const slot = Math.max(now, nextSlotAt)
  const wait = slot - now
  if (wait > NOMINATIM_MAX_QUEUE_WAIT_MS) throw new GeocodeServiceError('File Nominatim pleine', 'queue')
  nextSlotAt = slot + NOMINATIM_MIN_INTERVAL_MS
  if (wait > 0) await (deps.sleep ?? defaultSleep)(wait)
}

/** Repousse le prochain créneau (Nominatim a demandé de ralentir). */
function backOff(ms: number, deps: NominatimDeps): void {
  const now = deps.now?.() ?? Date.now()
  nextSlotAt = Math.max(nextSlotAt, now + Math.min(ms, NOMINATIM_BACKOFF_MAX_MS))
}

/** En-tête `Retry-After` (secondes ou date HTTP) en millisecondes ; `undefined` si absent ou illisible. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

// ---------------------------------------------------------------------------
// Format Nominatim (jsonv2) — lecture tolérante
// ---------------------------------------------------------------------------

const optionalString = z.string().optional().catch(undefined)

const nominatimItemSchema = z.object({
  lat: z.union([z.string(), z.number()]),
  lon: z.union([z.string(), z.number()]),
  boundingbox: z.array(z.union([z.string(), z.number()])).optional().catch(undefined),
  category: optionalString,
  type: optionalString,
  addresstype: optionalString,
  name: z.string().nullish().catch(undefined),
  display_name: optionalString,
  address: z.record(z.string(), z.unknown()).optional().catch(undefined),
})

export type NominatimItem = z.infer<typeof nominatimItemSchema>

const nominatimResponseSchema = z.array(z.unknown())

// ---------------------------------------------------------------------------
// Conversion en GeocodeResult
// ---------------------------------------------------------------------------

const CITY_TYPES = new Set(['city', 'town', 'village', 'municipality'])
const REGION_TYPES = new Set(['state', 'region', 'province', 'county', 'state_district', 'country', 'territory', 'department'])
const STREET_TYPES = new Set(['road', 'street', 'pedestrian', 'footway', 'residential', 'path', 'cycleway', 'square'])
const ADDRESS_TYPES = new Set(['house', 'building', 'house_number', 'address'])

function addressField(address: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!address) return undefined
  for (const key of keys) {
    const value = address[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

/** `boundingbox` Nominatim `[minLat, maxLat, minLon, maxLon]` (chaînes) → `Bbox`, ou `undefined`. */
export function nominatimBbox(raw: readonly (string | number)[] | undefined): Bbox | undefined {
  if (!raw || raw.length !== 4) return undefined
  const [minLat, maxLat, minLon, maxLon] = raw.map(toNumber) as [number, number, number, number]
  const bbox = { minLon, minLat, maxLon, maxLat }
  return isValidBbox(bbox) ? bbox : undefined
}

/** Nature du résultat d'après `addresstype`, puis `category` / `type` de Nominatim. */
export function nominatimResultType(item: Pick<NominatimItem, 'addresstype' | 'category' | 'type' | 'address'>): GeocodeResultType {
  const kind = item.addresstype ?? item.type ?? ''
  const hasNumber = !!addressField(item.address, 'house_number')
  if (kind === 'postcode' || item.type === 'postcode') return 'postcode'
  if (CITY_TYPES.has(kind)) return 'city'
  if (REGION_TYPES.has(kind)) return 'region'
  // Adresse précise : `addresstype` vaut souvent `place` avec `type: house`.
  if (hasNumber && (ADDRESS_TYPES.has(kind) || ADDRESS_TYPES.has(item.type ?? '') || item.category === 'building')) return 'address'
  if (STREET_TYPES.has(kind) || item.category === 'highway') return hasNumber ? 'address' : 'street'
  if (item.category === 'boundary' && item.type === 'administrative') return 'region'
  return 'place'
}

/**
 * Code de département lisible : `FR-69` → `69`, `FR-2A` → `2A`, `FR-974` → `974`
 * (champs `ISO3166-2-lvl6` puis `lvl4` de Nominatim), sinon d'après le code postal
 * (`97400` → `974`, `69001` → `69` ; pas pour la Corse, `20…` étant ambigu).
 */
export function departmentCode(address: Record<string, unknown> | undefined, postcode: string | undefined): string | undefined {
  const lvl6 = addressField(address, 'ISO3166-2-lvl6')
  const fromLvl6 = lvl6?.match(/^FR-(\d{2,3}|2[AB])$/i)?.[1]
  if (fromLvl6) return fromLvl6.toUpperCase()
  const lvl4 = addressField(address, 'ISO3166-2-lvl4')
  const fromLvl4 = lvl4?.match(/^FR-(97\d)$/i)?.[1]
  if (fromLvl4) return fromLvl4
  if (postcode && /^\d{5}$/.test(postcode)) {
    if (postcode.startsWith('97') || postcode.startsWith('98')) return postcode.slice(0, 3)
    if (!postcode.startsWith('20')) return postcode.slice(0, 2)
  }
  return undefined
}

function joinParts(...parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p && !!p.trim()).join(', ')
}

/** « 75004 Paris », « Paris » ou `undefined`. */
function postcodeCity(postcode: string | undefined, city: string | undefined): string | undefined {
  const value = [postcode, city].filter(Boolean).join(' ')
  return value || undefined
}

/** Repli : les trois premiers morceaux de `display_name`, sans le pays ni doublon. */
function fallbackLabel(item: NominatimItem): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const part of (item.display_name ?? '').split(',')) {
    const value = part.trim()
    const key = normalizeName(value)
    if (!value || seen.has(key) || key === 'france') continue
    seen.add(key)
    parts.push(value)
    if (parts.length === 3) break
  }
  return parts.join(', ')
}

/**
 * Libellé lisible en français :
 * - ville : « Lyon (69) », sinon « Lyon, Polynésie française » ;
 * - code postal : « 69001 Lyon » ;
 * - rue : « Rue de Rivoli, 75004 Paris » ; adresse : « 8 Rue de Rivoli, 75004 Paris » ;
 * - lieu nommé : « Tour Eiffel, 75007 Paris » ;
 * - région / département : « Bretagne », « Rhône (69) ».
 */
function buildLabel(item: NominatimItem, type: GeocodeResultType, city: string | undefined, postcode: string | undefined): string {
  const address = item.address
  const name = item.name?.trim() || undefined
  const road = addressField(address, 'road', 'pedestrian', 'footway', 'square', 'place')
  const houseNumber = addressField(address, 'house_number')
  const region = addressField(address, 'county', 'state', 'territory', 'archipelago')
  switch (type) {
    case 'city': {
      const label = name ?? city
      if (!label) return fallbackLabel(item)
      const code = departmentCode(address, postcode)
      if (code) return `${label} (${code})`
      return region && normalizeName(region) !== normalizeName(label) ? `${label}, ${region}` : label
    }
    case 'postcode':
      return postcodeCity(postcode ?? name, city) ?? fallbackLabel(item)
    case 'street':
    case 'address': {
      const street = road ?? name
      if (!street) return fallbackLabel(item)
      const first = type === 'address' && houseNumber ? `${houseNumber} ${street}` : street
      return joinParts(first, postcodeCity(postcode, city))
    }
    case 'region': {
      if (!name) return fallbackLabel(item)
      const isDepartment = (item.addresstype ?? item.type) === 'county' || (item.addresstype ?? item.type) === 'department'
      const code = isDepartment ? departmentCode(address, undefined) : undefined
      return code ? `${name} (${code})` : name
    }
    case 'place': {
      if (!name) return fallbackLabel(item)
      const where = postcodeCity(postcode, city)
      return where && normalizeName(where) !== normalizeName(name) ? joinParts(name, where) : name
    }
  }
}

/** Un élément Nominatim → `GeocodeResult`, ou `null` (illisible, hors couverture, libellé vide). */
export function toGeocodeResult(raw: unknown): GeocodeResult | null {
  const parsed = nominatimItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  const lat = toNumber(item.lat)
  const lon = toNumber(item.lon)
  if (!isInCoverage(lat, lon)) return null

  const type = nominatimResultType(item)
  const postcode = addressField(item.address, 'postcode')
  const addressCity = addressField(item.address, 'city', 'town', 'village', 'municipality', 'hamlet')
  let city: string | undefined
  if (type === 'city') city = item.name?.trim() || addressCity
  else if (type !== 'region') city = addressCity
  const label = buildLabel(item, type, city, postcode).slice(0, LABEL_MAX_LENGTH).trim()
  if (!label) return null

  const result: GeocodeResult = { label, lat, lon, type }
  const bbox = nominatimBbox(item.boundingbox)
  if (bbox) result.bbox = bbox
  if (postcode) result.postcode = postcode
  if (city) result.city = city
  return geocodeResultSchema.safeParse(result).success ? result : null
}

/**
 * Réponse Nominatim → résultats convertis, dans l'ordre, sans doublon (même
 * libellé normalisé : par ex. la commune en relation et en nœud), au plus `NOMINATIM_LIMIT`.
 */
export function toGeocodeResults(items: readonly unknown[]): GeocodeResult[] {
  const seen = new Set<string>()
  const results: GeocodeResult[] = []
  for (const raw of items) {
    const result = toGeocodeResult(raw)
    if (!result) continue
    const key = normalizeName(result.label)
    if (seen.has(key)) continue
    seen.add(key)
    results.push(result)
    if (results.length === NOMINATIM_LIMIT) break
  }
  return results
}

// ---------------------------------------------------------------------------
// Appel
// ---------------------------------------------------------------------------

export function nominatimSearchUrl(query: string, endpoint = configuredNominatimSearchUrl()): string {
  const url = new URL(endpoint)
  url.search = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(NOMINATIM_LIMIT),
    'accept-language': 'fr',
    countrycodes: NOMINATIM_COUNTRY_CODES.join(','),
    q: query,
  }).toString()
  return url.href
}

/** `fetch` + lecture du JSON, bornés à `ms` (signal + course avec un minuteur). */
async function fetchJson(doFetch: typeof fetch, url: string, ms: number, deps: NominatimDeps): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GeocodeServiceError('Délai Nominatim dépassé', 'timeout'))
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
      throw new GeocodeServiceError('Nominatim injoignable', 'network')
    }
    if (response.status === 429 || response.status === 503) {
      const now = deps.now?.() ?? Date.now()
      backOff(parseRetryAfter(response.headers.get('retry-after'), now) ?? NOMINATIM_BACKOFF_MS, deps)
    }
    if (!response.ok) throw new GeocodeServiceError(`Nominatim HTTP ${response.status}`, 'http')
    try {
      return await response.json() as unknown
    }
    catch {
      throw new GeocodeServiceError('Réponse Nominatim illisible', 'invalid')
    }
  }
  try {
    return await Promise.race([run(), timeout])
  }
  finally {
    clearTimeout(timer)
  }
}

async function searchNow(query: string, deps: NominatimDeps): Promise<GeocodeResult[]> {
  await waitForSlot(deps)
  const data = await fetchJson(deps.fetch ?? globalThis.fetch, nominatimSearchUrl(query, deps.endpoint), deps.timeoutMs ?? NOMINATIM_TIMEOUT_MS, deps)
  const parsed = nominatimResponseSchema.safeParse(data)
  if (!parsed.success) throw new GeocodeServiceError('Réponse Nominatim inattendue', 'invalid')
  return toGeocodeResults(parsed.data)
}

/**
 * Recherche Nominatim (sans cache : voir la route). Les requêtes identiques
 * (même requête normalisée) en cours partagent le même appel.
 * @throws GeocodeServiceError si la file est pleine ou si Nominatim échoue.
 */
export function searchNominatim(query: string, deps: NominatimDeps = {}): Promise<GeocodeResult[]> {
  const key = normalizeName(query)
  const pending = inFlight.get(key)
  if (pending) return pending
  const promise = searchNow(query, deps).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}
