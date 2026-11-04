/**
 * Client Nominatim pour le proxy `GET /api/geocode?q=` (§3.2, §4.3), choisi par
 * `GEOCODER=nominatim` (voir server/utils/geocoder.ts ; Photon par défaut) :
 * conversion des réponses jsonv2 en `GeocodeResult` (France, DROM et COM uniquement).
 * File d'attente, délai, User-Agent et dédoublonnage : server/utils/geocoding/core.ts.
 *
 * Politique d'usage de Nominatim (https://operations.osmfoundation.org/policies/nominatim/) :
 * - au plus 1 requête par seconde : espacement global, plus le cache en base ;
 * - User-Agent identifiant l'application (`PAWSPOT_USER_AGENT`), sans `Referer`
 *   ni paramètre `email` ;
 * - PAS d'autocomplétion sur l'instance publique de l'OSMF : c'est pourquoi Photon
 *   est le fournisseur par défaut. N'utiliser `GEOCODER=nominatim` qu'avec une
 *   instance qui l'autorise (`NOMINATIM_URL`).
 *
 * `fetch` et l'horloge sont injectables (les tests n'appellent jamais Nominatim).
 */
import { z } from 'zod'
import { geocodeResultSchema } from '../../shared/schemas'
import { isInCoverage, isValidBbox } from '../../shared/geo'
import type { Bbox } from '../../shared/geo'
import { normalizeName } from '../../shared/text'
import type { GeocodeResult, GeocodeResultType } from '../../shared/types'
import {
  GEOCODER_BACKOFF_MAX_MS,
  GEOCODER_BACKOFF_MS,
  GEOCODER_MAX_QUEUE_WAIT_MS,
  GEOCODER_MAX_RESULTS,
  GEOCODER_MIN_INTERVAL_MS,
  GEOCODER_TIMEOUT_MS,
  GEOCODE_COUNTRY_CODES,
  GeocodeServiceError,
  LABEL_MAX_LENGTH,
  dedupeInFlight,
  departmentCodeFromPostcode,
  fetchGeocoderJson,
  joinParts,
  parseGeocoderBaseUrl,
  postcodeCity,
  resetGeocoderQueue,
  uniqueResults,
  waitForGeocoderSlot,
} from './geocoding/core'
import type { GeocoderDeps } from './geocoding/core'

/**
 * Ré-export de compatibilité pour les imports existants depuis ce fichier. À
 * retirer quand plus rien n'importe `GeocodeServiceError` d'ici (source :
 * server/utils/geocoding/core.ts).
 */
export { GeocodeServiceError }

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
  return parseGeocoderBaseUrl(raw, NOMINATIM_DEFAULT_BASE_URL)
}

/**
 * Adresse de recherche configurée, lue à chaque appel (les tests peuvent changer
 * `NOMINATIM_URL` sans recharger le module).
 */
export function configuredNominatimSearchUrl(env: Record<string, string | undefined> = process.env): string {
  return `${parseNominatimBaseUrl(env.NOMINATIM_URL)}/search`
}

/** Codes pays passés à Nominatim (`countrycodes`) : voir `GEOCODE_COUNTRY_CODES`. */
export const NOMINATIM_COUNTRY_CODES = GEOCODE_COUNTRY_CODES

/** Résultats demandés à Nominatim (le cache en garde au plus 10). */
export const NOMINATIM_LIMIT = GEOCODER_MAX_RESULTS
/** Délai maximal d'un appel (réponse et lecture du JSON comprises). */
export const NOMINATIM_TIMEOUT_MS = GEOCODER_TIMEOUT_MS
/** Espacement minimal entre deux appels (politique : 1 requête/s). */
export const NOMINATIM_MIN_INTERVAL_MS = GEOCODER_MIN_INTERVAL_MS
/** Attente maximale dans la file avant un 503 immédiat. */
export const NOMINATIM_MAX_QUEUE_WAIT_MS = GEOCODER_MAX_QUEUE_WAIT_MS
/** Pause après un 429 / 503 de Nominatim, si `Retry-After` est absent. */
export const NOMINATIM_BACKOFF_MS = GEOCODER_BACKOFF_MS
/** Pause maximale acceptée depuis un `Retry-After`. */
export const NOMINATIM_BACKOFF_MAX_MS = GEOCODER_BACKOFF_MAX_MS

export type NominatimDeps = GeocoderDeps

/** Remet la file commune des géocodeurs à zéro (tests). */
export function resetNominatimQueue(): void {
  resetGeocoderQueue()
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
  return departmentCodeFromPostcode(postcode)
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
  return uniqueResults(items.map(toGeocodeResult), NOMINATIM_LIMIT)
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

async function searchNow(query: string, deps: NominatimDeps): Promise<GeocodeResult[]> {
  await waitForGeocoderSlot(deps)
  const data = await fetchGeocoderJson('Nominatim', nominatimSearchUrl(query, deps.endpoint), deps)
  const parsed = nominatimResponseSchema.safeParse(data)
  if (!parsed.success) throw new GeocodeServiceError('Réponse Nominatim inattendue', 'invalid')
  return toGeocodeResults(parsed.data)
}

/**
 * Recherche Nominatim (sans cache : voir la route). La requête envoyée est
 * `normalizeGeocodeQuery(query)` ; les requêtes identiques en cours (même forme
 * normalisée) partagent le même appel.
 * @throws GeocodeServiceError si la file est pleine ou si Nominatim échoue.
 */
export function searchNominatim(query: string, deps: NominatimDeps = {}): Promise<GeocodeResult[]> {
  return dedupeInFlight('nominatim', query, normalized => searchNow(normalized, deps))
}
