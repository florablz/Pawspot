import { GEOCODE_QUERY_MAX_LENGTH, GEOCODE_QUERY_MIN_LENGTH } from '#shared/schemas'
import { normalizeName } from '#shared/text'
import type { GeocodeResult, GeocodeResultType, Place } from '#shared/types'
import { filterPlaces } from './placeFilters'

/** Lieux PawSpot proposés au plus dans les suggestions. */
export const MAX_PLACE_SUGGESTIONS = 5
/** En dessous, ni suggestion ni appel à `/api/geocode` (même seuil que le serveur). */
export const SEARCH_MIN_LENGTH = GEOCODE_QUERY_MIN_LENGTH
export const SEARCH_MAX_LENGTH = GEOCODE_QUERY_MAX_LENGTH

/** La recherche est-elle assez longue (et contient-elle une lettre ou un chiffre) ? */
export function isSearchable(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_LENGTH && normalizeName(query) !== ''
}

/**
 * Lieux chargés dont le nom contient la recherche (sans accents ni casse), du
 * plus pertinent au moins pertinent : nom identique, puis qui commence par la
 * recherche, puis dont un mot commence par la recherche, puis le reste ; à
 * égalité, le nom le plus court. Les lieux sans nom (« Parc » de repli) sont ignorés.
 */
export function matchPlaces(places: readonly Place[], query: string, limit = MAX_PLACE_SUGGESTIONS): Place[] {
  if (!isSearchable(query)) return []
  const q = normalizeName(query)
  const rank = (p: Place) => {
    const n = normalizeName(p.name)
    if (n === q) return 0
    if (n.startsWith(q)) return 1
    if (n.includes(` ${q}`)) return 2
    return 3
  }
  return filterPlaces(places.filter(p => p.hasName), { query, categories: [], confirmedOnly: false })
    .map(p => ({ p, r: rank(p), len: p.name.length }))
    .sort((a, b) => a.r - b.r || a.len - b.len || a.p.name.localeCompare(b.p.name, 'fr'))
    .slice(0, limit)
    .map(x => x.p)
}

/** Le nom du lieu correspond exactement à la recherche (Entrée sans sélection). */
export function isExactPlaceMatch(place: Place, query: string): boolean {
  return normalizeName(place.name) === normalizeName(query)
}

/**
 * La recherche est exactement le nom de cette ville (« Lyon » pour « Lyon,
 * Métropole de Lyon… » ou « Lyon (69) ») : la ville passe alors avant les lieux PawSpot.
 */
export function isExactCityMatch(result: GeocodeResult, query: string): boolean {
  if (result.type !== 'city') return false
  const q = normalizeName(query)
  return normalizeName(splitGeocodeLabel(result).title) === q || (!!result.city && normalizeName(result.city) === q)
}

/** Zoom maximal (et zoom sans emprise) selon la nature du résultat. */
export const GEOCODE_ZOOM: Record<GeocodeResultType, number> = {
  // 16 : l'adresse et les lieux de la rue autour (18 ne montrait que l'immeuble).
  address: 16,
  place: 17,
  street: 16,
  postcode: 14,
  city: 13,
  region: 9,
}

/** Zoom minimal après une recherche : 11, celui où les lieux se chargent (sauf région). */
export function geocodeMinZoom(type: GeocodeResultType): number {
  return type === 'region' ? 0 : 11
}

/** Libellé et icône d'un type de résultat (suggestions). */
export const GEOCODE_TYPE_DISPLAY: Record<GeocodeResultType, { label: string, icon: string }> = {
  address: { label: 'Adresse', icon: '\u{1F4CD}' },
  street: { label: 'Rue', icon: '\u{1F6E3}\u{FE0F}' },
  postcode: { label: 'Code postal', icon: '\u{1F4EE}' },
  city: { label: 'Ville', icon: '\u{1F3D9}\u{FE0F}' },
  place: { label: 'Lieu nommé', icon: '\u{1F4CC}' },
  region: { label: 'Département ou région', icon: '\u{1F5FA}\u{FE0F}' },
}

/** « 12 Rue de Rivoli, 75004 Paris » → titre « 12 Rue de Rivoli », détail « 75004 Paris ». */
export function splitGeocodeLabel(result: GeocodeResult): { title: string, detail: string } {
  const i = result.label.indexOf(',')
  if (i < 0) return { title: result.label, detail: '' }
  return { title: result.label.slice(0, i).trim(), detail: result.label.slice(i + 1).trim() }
}

/** Texte annoncé aux lecteurs d'écran quand les suggestions changent. */
export function suggestionsAnnouncement(places: number, addresses: number): string {
  if (places + addresses === 0) return 'Aucun résultat.'
  const parts: string[] = []
  if (places) parts.push(`${places} lieu${places > 1 ? 'x' : ''} PawSpot`)
  if (addresses) parts.push(`${addresses} adresse${addresses > 1 ? 's' : ''} ou ville${addresses > 1 ? 's' : ''}`)
  return `${parts.join(' et ')}. Flèches haut et bas pour parcourir, Entrée pour choisir.`
}
