/**
 * Client Photon (https://photon.komoot.io, données OpenStreetMap) pour le proxy
 * `GET /api/geocode?q=` : fournisseur par défaut (`GEOCODER=photon`, voir
 * server/utils/geocoder.ts), conçu pour la recherche pendant la frappe.
 * File d'attente, délai, User-Agent et dédoublonnage : server/utils/geocoding/core.ts.
 *
 * Usage équitable de l'instance publique : au plus 1 requête/s par processus,
 * cache en base de 30 jours, User-Agent identifiable (`PAWSPOT_USER_AGENT`),
 * recul sur 429 / `Retry-After`. Aucune donnée de l'utilisateur n'est transmise :
 * ni position, ni centre de la carte (pas de `lat` / `lon` de biais), ni `Referer`.
 *
 * Photon ne filtre pas par pays : les résultats sont filtrés ici (`countrycode`
 * parmi les territoires couverts ET point dans `COVERAGE_AREAS`).
 *
 * `fetch` et l'horloge sont injectables (les tests n'appellent jamais Photon).
 */
import { z } from 'zod'
import { geocodeResultSchema } from '../../shared/schemas'
import { isInCoverage, isValidBbox } from '../../shared/geo'
import type { Bbox } from '../../shared/geo'
import { normalizeName } from '../../shared/text'
import type { GeocodeResult, GeocodeResultType } from '../../shared/types'
import {
  GEOCODE_COUNTRY_CODES,
  GeocodeServiceError,
  LABEL_MAX_LENGTH,
  dedupeInFlight,
  departmentCodeFromPostcode,
  fetchGeocoderJson,
  joinParts,
  parseGeocoderBaseUrl,
  postcodeCity,
  uniqueResults,
  waitForGeocoderSlot,
} from './geocoding/core'
import type { GeocoderDeps } from './geocoding/core'

/** Adresse de base par défaut (instance publique de komoot). */
export const PHOTON_DEFAULT_BASE_URL = 'https://photon.komoot.io'
/**
 * Résultats demandés à Photon : un peu plus que les 8 renvoyés, car Photon ne
 * filtre pas par pays et une partie peut être écartée.
 */
export const PHOTON_LIMIT = 10

/**
 * Lit l'adresse de base de Photon (variable `PHOTON_URL`, sans `/api`), par ex. un
 * serveur local pour les tests de bout en bout. Mêmes règles que `NOMINATIM_URL` :
 * `https:` ou `http:`, sans identifiants, requête ni fragment ; `/` final retiré.
 * Valeur absente, vide ou invalide : `PHOTON_DEFAULT_BASE_URL`.
 */
export function parsePhotonBaseUrl(raw: string | undefined | null): string {
  return parseGeocoderBaseUrl(raw, PHOTON_DEFAULT_BASE_URL)
}

/** Adresse de recherche configurée (`${PHOTON_URL}/api/`), lue à chaque appel. */
export function configuredPhotonSearchUrl(env: Record<string, string | undefined> = process.env): string {
  return `${parsePhotonBaseUrl(env.PHOTON_URL)}/api/`
}

/** URL d'une recherche : `?q=…&lang=fr&limit=10`, rien d'autre (pas de biais de position). */
export function photonSearchUrl(query: string, endpoint = configuredPhotonSearchUrl()): string {
  const url = new URL(endpoint)
  url.search = new URLSearchParams({ q: query, lang: 'fr', limit: String(PHOTON_LIMIT) }).toString()
  return url.href
}

// ---------------------------------------------------------------------------
// Format Photon (GeoJSON) — lecture tolérante
// ---------------------------------------------------------------------------

const optionalString = z.preprocess(
  value => (typeof value === 'number' ? String(value) : value),
  z.string().optional(),
).catch(undefined)

const photonPropertiesSchema = z.object({
  name: optionalString,
  housenumber: optionalString,
  street: optionalString,
  postcode: optionalString,
  city: optionalString,
  district: optionalString,
  county: optionalString,
  state: optionalString,
  country: optionalString,
  countrycode: optionalString,
  type: optionalString,
  osm_key: optionalString,
  osm_value: optionalString,
  extent: z.array(z.number()).optional().catch(undefined),
})

export type PhotonProperties = z.infer<typeof photonPropertiesSchema>

const photonFeatureSchema = z.object({
  geometry: z.object({
    coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
  }),
  properties: photonPropertiesSchema,
})

const photonResponseSchema = z.object({ features: z.array(z.unknown()) })

// ---------------------------------------------------------------------------
// Conversion en GeocodeResult
// ---------------------------------------------------------------------------

/** Chaîne non vide après trim, sinon `undefined`. */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

/**
 * Premier code postal à 5 chiffres (Photon renvoie parfois une liste
 * « 69001;69002 » pour une commune), sinon la valeur telle quelle.
 */
export function photonPostcode(raw: string | undefined): string | undefined {
  const value = clean(raw)
  if (!value) return undefined
  const first = value.split(/[;,]/)[0]!.trim()
  return first || undefined
}

/** `extent` Photon `[minLon, maxLat, maxLon, minLat]` → `Bbox`, ou `undefined`. */
export function photonBbox(extent: readonly number[] | undefined): Bbox | undefined {
  if (!extent || extent.length !== 4) return undefined
  const [minLon, maxLat, maxLon, minLat] = extent as [number, number, number, number]
  const bbox = { minLon, minLat, maxLon, maxLat }
  return isValidBbox(bbox) ? bbox : undefined
}

const CITY_VALUES = new Set(['city', 'town', 'village', 'municipality'])
const POSTCODE_VALUES = new Set(['postcode', 'postal_code'])
const REGION_TYPES = new Set(['county', 'state', 'country'])
const ADDRESS_KEYS = new Set(['place', 'building', 'entrance'])

/**
 * Nature du résultat d'après `type` (house, street, city, district, locality,
 * county, state, country, other), `osm_key` / `osm_value` de Photon :
 * - code postal : `osm_value` `postcode` / `postal_code` ;
 * - ville : `type: city`, ou `osm_key: place` + city / town / village ;
 * - région : county, state, country (départements, régions, COM) ;
 * - rue : `type: street` ;
 * - adresse : `type: house` avec numéro et sans nom propre (point d'adresse, bâtiment) ;
 * - sinon lieu nommé (point d'intérêt, quartier, lieu-dit).
 */
export function photonResultType(props: Pick<PhotonProperties, 'type' | 'osm_key' | 'osm_value' | 'housenumber' | 'name'>): GeocodeResultType {
  const value = props.osm_value ?? ''
  if (POSTCODE_VALUES.has(value) || props.type === 'postcode') return 'postcode'
  if (props.type === 'city' || (props.osm_key === 'place' && CITY_VALUES.has(value))) return 'city'
  if (props.type && REGION_TYPES.has(props.type)) return 'region'
  if (props.type === 'street') return 'street'
  if (props.type === 'house' && clean(props.housenumber)) {
    if (!clean(props.name) || ADDRESS_KEYS.has(props.osm_key ?? '')) return 'address'
  }
  return 'place'
}

/**
 * Codes des départements et collectivités, par nom normalisé (`normalizeName`) :
 * Photon ne donne pas le code ISO 3166-2 du département, seulement son nom
 * (`county`, ou `state` pour un DROM / une COM).
 */
const DEPARTMENT_CODES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries({
  'Ain': '01', 'Aisne': '02', 'Allier': '03', 'Alpes-de-Haute-Provence': '04', 'Hautes-Alpes': '05',
  'Alpes-Maritimes': '06', 'Ardèche': '07', 'Ardennes': '08', 'Ariège': '09', 'Aube': '10',
  'Aude': '11', 'Aveyron': '12', 'Bouches-du-Rhône': '13', 'Calvados': '14', 'Cantal': '15',
  'Charente': '16', 'Charente-Maritime': '17', 'Cher': '18', 'Corrèze': '19', 'Corse-du-Sud': '2A',
  'Haute-Corse': '2B', 'Côte-d\'Or': '21', 'Côtes-d\'Armor': '22', 'Creuse': '23', 'Dordogne': '24',
  'Doubs': '25', 'Drôme': '26', 'Eure': '27', 'Eure-et-Loir': '28', 'Finistère': '29',
  'Gard': '30', 'Haute-Garonne': '31', 'Gers': '32', 'Gironde': '33', 'Hérault': '34',
  'Ille-et-Vilaine': '35', 'Indre': '36', 'Indre-et-Loire': '37', 'Isère': '38', 'Jura': '39',
  'Landes': '40', 'Loir-et-Cher': '41', 'Loire': '42', 'Haute-Loire': '43', 'Loire-Atlantique': '44',
  'Loiret': '45', 'Lot': '46', 'Lot-et-Garonne': '47', 'Lozère': '48', 'Maine-et-Loire': '49',
  'Manche': '50', 'Marne': '51', 'Haute-Marne': '52', 'Mayenne': '53', 'Meurthe-et-Moselle': '54',
  'Meuse': '55', 'Morbihan': '56', 'Moselle': '57', 'Nièvre': '58', 'Nord': '59',
  'Oise': '60', 'Orne': '61', 'Pas-de-Calais': '62', 'Puy-de-Dôme': '63', 'Pyrénées-Atlantiques': '64',
  'Hautes-Pyrénées': '65', 'Pyrénées-Orientales': '66', 'Bas-Rhin': '67', 'Haut-Rhin': '68', 'Rhône': '69',
  'Métropole de Lyon': '69', 'Haute-Saône': '70', 'Saône-et-Loire': '71', 'Sarthe': '72', 'Savoie': '73',
  'Haute-Savoie': '74', 'Paris': '75', 'Seine-Maritime': '76', 'Seine-et-Marne': '77', 'Yvelines': '78',
  'Deux-Sèvres': '79', 'Somme': '80', 'Tarn': '81', 'Tarn-et-Garonne': '82', 'Var': '83',
  'Vaucluse': '84', 'Vendée': '85', 'Vienne': '86', 'Haute-Vienne': '87', 'Vosges': '88',
  'Yonne': '89', 'Territoire de Belfort': '90', 'Essonne': '91', 'Hauts-de-Seine': '92', 'Seine-Saint-Denis': '93',
  'Val-de-Marne': '94', 'Val-d\'Oise': '95', 'Guadeloupe': '971', 'Martinique': '972', 'Guyane': '973',
  'Guyane française': '973', 'La Réunion': '974', 'Réunion': '974', 'Mayotte': '976',
  'Saint-Pierre-et-Miquelon': '975', 'Saint-Barthélemy': '977', 'Saint-Martin': '978',
}).map(([name, code]) => [normalizeName(name), code]))

/**
 * Code de département lisible pour une commune ou un département : d'après le nom
 * du département (`county`, puis `state` pour un DROM / une COM), sinon d'après le
 * code postal (`69001` → `69`, `97400` → `974` ; pas pour la Corse).
 * Pour Paris (commune et département à la fois), le nom suffit.
 */
export function photonDepartmentCode(props: Pick<PhotonProperties, 'county' | 'state' | 'name'>, postcode: string | undefined, type: GeocodeResultType): string | undefined {
  for (const value of [props.county, props.state]) {
    const code = value ? DEPARTMENT_CODES[normalizeName(value)] : undefined
    if (code) return code
  }
  if ((type === 'city' || type === 'region') && normalizeName(props.name) === 'paris') return '75'
  if (type === 'region') return props.name ? DEPARTMENT_CODES[normalizeName(props.name)] : undefined
  return departmentCodeFromPostcode(postcode)
}

/** Repli : nom, rue, commune, département ou région, sans doublon ni pays. */
function fallbackLabel(props: PhotonProperties): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const part of [props.name, props.street, props.city, props.county, props.state]) {
    const value = clean(part)
    const key = normalizeName(value)
    if (!value || seen.has(key) || key === 'france') continue
    seen.add(key)
    parts.push(value)
    if (parts.length === 3) break
  }
  return parts.join(', ')
}

/**
 * Libellé lisible en français, mêmes formes que pour Nominatim :
 * - ville : « Lyon (69) », sinon « Papeete, Polynésie française » ;
 * - code postal : « 69001 Lyon » ;
 * - rue : « Rue de Rivoli, 75004 Paris » ; adresse : « 8 Rue de Rivoli, 75004 Paris » ;
 * - lieu nommé : « Tour Eiffel, 75007 Paris » ;
 * - région / département : « Bretagne », « Rhône (69) ».
 */
function buildLabel(props: PhotonProperties, type: GeocodeResultType, city: string | undefined, postcode: string | undefined): string {
  const name = clean(props.name)
  const region = clean(props.county) ?? clean(props.state)
  switch (type) {
    case 'city': {
      const label = name ?? city
      if (!label) return fallbackLabel(props)
      const code = photonDepartmentCode(props, postcode, type)
      if (code) return `${label} (${code})`
      return region && normalizeName(region) !== normalizeName(label) ? `${label}, ${region}` : label
    }
    case 'postcode':
      return postcodeCity(postcode ?? name, city) ?? fallbackLabel(props)
    case 'street':
    case 'address': {
      const street = type === 'street' ? name ?? clean(props.street) : clean(props.street) ?? name
      if (!street) return fallbackLabel(props)
      const houseNumber = clean(props.housenumber)
      const first = type === 'address' && houseNumber ? `${houseNumber} ${street}` : street
      return joinParts(first, postcodeCity(postcode, city))
    }
    case 'region': {
      if (!name) return fallbackLabel(props)
      const code = props.type === 'county' ? photonDepartmentCode({ name }, undefined, type) : undefined
      return code ? `${name} (${code})` : name
    }
    case 'place': {
      if (!name) return fallbackLabel(props)
      const where = postcodeCity(postcode, city)
      return where && normalizeName(where) !== normalizeName(name) ? joinParts(name, where) : name
    }
  }
}

const COUNTRY_CODES = new Set<string>(GEOCODE_COUNTRY_CODES)

/**
 * Une `feature` Photon → `GeocodeResult`, ou `null` (illisible, pays non couvert,
 * point hors couverture, libellé vide).
 */
export function photonToGeocodeResult(raw: unknown): GeocodeResult | null {
  const parsed = photonFeatureSchema.safeParse(raw)
  if (!parsed.success) return null
  const { geometry, properties: props } = parsed.data
  const [lon, lat] = geometry.coordinates
  const country = props.countrycode?.trim().toLowerCase()
  if (!country || !COUNTRY_CODES.has(country)) return null
  if (!isInCoverage(lat, lon)) return null

  const type = photonResultType(props)
  const postcode = photonPostcode(props.postcode)
  let city: string | undefined
  if (type === 'city') city = clean(props.name) ?? clean(props.city)
  else if (type !== 'region') city = clean(props.city)
  const label = buildLabel(props, type, city, postcode).slice(0, LABEL_MAX_LENGTH).trim()
  if (!label) return null

  const result: GeocodeResult = { label, lat, lon, type }
  const bbox = photonBbox(props.extent)
  if (bbox) result.bbox = bbox
  if (postcode) result.postcode = postcode
  if (city) result.city = city
  return geocodeResultSchema.safeParse(result).success ? result : null
}

/** `features` Photon → résultats convertis, dans l'ordre, sans doublon, au plus 8. */
export function photonToGeocodeResults(features: readonly unknown[]): GeocodeResult[] {
  return uniqueResults(features.map(photonToGeocodeResult))
}

// ---------------------------------------------------------------------------
// Appel
// ---------------------------------------------------------------------------

async function searchNow(query: string, deps: GeocoderDeps): Promise<GeocodeResult[]> {
  await waitForGeocoderSlot(deps)
  const data = await fetchGeocoderJson('Photon', photonSearchUrl(query, deps.endpoint), deps)
  const parsed = photonResponseSchema.safeParse(data)
  if (!parsed.success) throw new GeocodeServiceError('Réponse Photon inattendue', 'invalid')
  return photonToGeocodeResults(parsed.data.features)
}

/**
 * Recherche Photon (sans cache : voir la route). La requête envoyée est
 * `normalizeGeocodeQuery(query)` ; les requêtes identiques en cours (même forme
 * normalisée) partagent le même appel.
 * @throws GeocodeServiceError si la file est pleine ou si Photon échoue.
 */
export function searchPhoton(query: string, deps: GeocoderDeps = {}): Promise<GeocodeResult[]> {
  return dedupeInFlight('photon', query, normalized => searchNow(normalized, deps))
}
