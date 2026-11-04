import { isCategoryKey, type CategoryKey } from '#shared/categories'
import type { LocationQuery, LocationQueryRaw, LocationQueryValue } from 'vue-router'

/**
 * État de la carte dans l'URL (§4.4), lisible et partageable :
 * `?lat=48.8566&lon=2.3522&z=15&cat=park,cafe&confirmes=1`.
 * - `lat` / `lon` / `z` : centre et zoom de la carte (les trois ou aucun) ;
 * - `cat` : catégories filtrées, séparées par des virgules (clés de shared/categories) ;
 * - `confirmes=1` : « Chiens acceptés confirmés uniquement ».
 */
export const MAP_QUERY_KEYS = ['lat', 'lon', 'z', 'cat', 'confirmes'] as const
export type MapQueryKey = (typeof MAP_QUERY_KEYS)[number]

export const URL_MIN_ZOOM = 3
export const URL_MAX_ZOOM = 19

export interface UrlMapView {
  lat: number
  lng: number
  zoom: number
}

export interface UrlFilters {
  categories: CategoryKey[]
  confirmedOnly: boolean
}

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined

function first(value: QueryValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : undefined
}

function toNumber(value: QueryValue): number | null {
  const raw = first(value)?.trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Vue lue dans l'URL, ou `null` si absente ou invalide (hors bornes, zoom non entier…). */
export function parseViewQuery(query: LocationQuery): UrlMapView | null {
  const lat = toNumber(query.lat)
  const lng = toNumber(query.lon)
  const zoom = toNumber(query.z)
  if (lat == null || lng == null || zoom == null) return null
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null
  if (!Number.isInteger(zoom) || zoom < URL_MIN_ZOOM || zoom > URL_MAX_ZOOM) return null
  return { lat, lng, zoom }
}

/** Filtres lus dans l'URL ; les catégories inconnues sont ignorées. */
export function parseFiltersQuery(query: LocationQuery): UrlFilters {
  const raw = first(query.cat) ?? ''
  const categories = [...new Set(raw.split(',').map(s => s.trim()).filter(isCategoryKey))]
  return { categories, confirmedOnly: first(query.confirmes) === '1' }
}

/**
 * 3 décimales (≈ 100 m), sans zéros inutiles : assez pour retrouver la vue
 * (le zoom fait le reste), pas assez pour situer un domicile dans un lien partagé.
 */
export const URL_COORD_DECIMALS = 3

function formatCoord(value: number): string {
  return String(Number(value.toFixed(URL_COORD_DECIMALS)))
}

export function viewToQuery(view: UrlMapView): Record<'lat' | 'lon' | 'z', string> {
  return { lat: formatCoord(view.lat), lon: formatCoord(view.lng), z: String(Math.round(view.zoom)) }
}

export function filtersToQuery(filters: UrlFilters): Record<'cat' | 'confirmes', string | undefined> {
  return {
    cat: filters.categories.length ? filters.categories.join(',') : undefined,
    confirmes: filters.confirmedOnly ? '1' : undefined,
  }
}

/** Ne garde de `query` que les clés de la carte (pour passer de `/` à `/lieu/…` et inversement). */
export function pickMapQuery(query: LocationQuery): LocationQueryRaw {
  const out: LocationQueryRaw = {}
  for (const key of MAP_QUERY_KEYS) {
    const value = first(query[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

/** `query` avec les clés de `patch` remplacées (`undefined` = retirée). Les autres clés sont gardées. */
export function mergeMapQuery(query: LocationQuery, patch: Partial<Record<MapQueryKey, string | undefined>>): LocationQueryRaw {
  const removed = new Set(Object.keys(patch).filter(k => patch[k as MapQueryKey] === undefined))
  const out: LocationQueryRaw = Object.fromEntries(Object.entries(query).filter(([k]) => !removed.has(k)))
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Égalité de deux queries (ordre des clés ignoré). */
export function sameQuery(a: LocationQueryRaw, b: LocationQueryRaw): boolean {
  const norm = (q: LocationQueryRaw) => JSON.stringify(Object.keys(q).filter(k => q[k] !== undefined).sort().map(k => [k, q[k]]))
  return norm(a) === norm(b)
}
