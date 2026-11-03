/**
 * Conversions pures : élément Overpass → ligne `places`, ligne `places` → `Place` (JSON d'API).
 */
import { CATEGORIES, categoryFromTags, isCategoryKey, isPlaceEligible } from '../../../shared/categories'
import { computeDogStatus, describeDogStatusSource, parseOsmDogPolicy } from '../../../shared/dogStatus'
import type { AlertSignal, DogReportInput, DogStatusInfo } from '../../../shared/dogStatus'
import { osmPlaceId } from '../../../shared/schemas'
import { normalizeName } from '../../../shared/text'
import type { Place } from '../../../shared/types'
import { resolveImage, sanitizeImageUrl, sanitizeWebsite } from '../../../shared/url'
import type { NewPlaceRow, PlaceRow } from '../../database/schema'
import type { OverpassElement } from './overpass'

/** Tags OSM gardés en JSON dans `places.tags` (le reste a sa colonne ou n'est pas utile). */
export const STORED_TAG_KEYS = [
  'leisure', 'amenity', 'natural', 'shop', 'vending', 'waste',
  'dog', 'dog:conditional', 'access', 'access:conditional', 'outdoor_seating',
  'barrier', 'fence_type', 'drinking_water', 'lit', 'surface', 'wheelchair',
  'brand', 'operator', 'check_date',
] as const

const MAX_TEXT = 500

function clean(value: string | undefined, max = MAX_TEXT): string | undefined {
  const v = value?.trim()
  return v ? v.slice(0, max) : undefined
}

export function buildAddress(tags: Record<string, string | undefined>): string | undefined {
  const street = [tags['addr:housenumber'], tags['addr:street']].map(v => v?.trim()).filter(Boolean).join(' ')
  const city = [tags['addr:postcode'], tags['addr:city']].map(v => v?.trim()).filter(Boolean).join(' ')
  return clean([street, city].filter(Boolean).join(', ')) || undefined
}

export interface CommunitySignals {
  reports: DogReportInput[]
  alerts: AlertSignal[]
}

/**
 * Élément Overpass → ligne `places` prête pour l'upsert, ou `null` si l'élément
 * n'a pas de position, n'entre dans aucune catégorie ou n'est pas éligible
 * (`isPlaceEligible`, ex. resto `dog=no`).
 */
export function elementToPlaceRow(el: OverpassElement, now: Date, signals?: CommunitySignals): NewPlaceRow | null {
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const tags = el.tags ?? {}
  const category = categoryFromTags(tags)
  if (!category || !isPlaceEligible(category, tags)) return null

  const storedTags: Record<string, string> = {}
  for (const key of STORED_TAG_KEYS) {
    const v = clean(tags[key])
    if (v) storedTags[key] = v
  }
  const hasTerrace = tags.outdoor_seating?.trim().toLowerCase() === 'yes'
  const dog = computeDogStatus({ tags, hasTerrace, reports: signals?.reports, alerts: signals?.alerts, now })
  const name = clean(tags.name, 200) ?? null

  return {
    id: osmPlaceId(el.type, el.id),
    source: 'osm',
    name,
    nameNormalized: name ? normalizeName(name) : null,
    lat,
    lon,
    category,
    osmDogPolicy: parseOsmDogPolicy(tags).policy,
    hasTerrace,
    dogStatus: dog.status,
    dogStatusInfo: dog.info,
    tags: storedTags,
    address: buildAddress(tags) ?? null,
    phone: clean(tags.phone ?? tags['contact:phone'], 100) ?? null,
    website: sanitizeWebsite(tags.website ?? tags['contact:website']) ?? null,
    openingHours: clean(tags.opening_hours) ?? null,
    image: resolveImage(tags) ?? null,
    cuisine: clean(tags.cuisine, 200) ?? null,
    description: clean(tags.description, 1000) ?? null,
    status: 'active',
    verified: true,
    fetchedAt: now,
    updatedAt: now,
  }
}

const EMPTY_INFO: DogStatusInfo = {
  source: 'none',
  reports: { total: 0, accepted: 0, refused: 0, inside: 0, recent: 0 },
}

/** Ligne `places` → `Place` (forme JSON de l'API). `now` sert au texte « il y a N jours ». */
export function rowToPlace(row: PlaceRow, now: Date = new Date()): Place {
  const tags = row.tags ?? {}
  const category = isCategoryKey(row.category) ? row.category : 'park'
  const osm = parseOsmDogPolicy(tags)
  const stored = row.dogStatusInfo ?? EMPTY_INFO
  // `osmDetail` est figé en base au dernier calcul : on le régénère depuis les tags
  // pour que les lignes anciennes profitent aussi du texte lisible actuel.
  let info: DogStatusInfo = stored
  if (stored.osmDetail !== undefined) {
    const { osmDetail: _old, ...rest } = stored
    info = osm.detail ? { ...rest, osmDetail: osm.detail } : rest
  }
  const place: Place = {
    id: row.id,
    source: row.source,
    name: row.name || CATEGORIES[category].singular,
    hasName: Boolean(row.name),
    lat: row.lat,
    lon: row.lon,
    category,
    dogStatus: row.dogStatus,
    dogStatusInfo: info,
    osmDogPolicy: row.osmDogPolicy,
    hasTerrace: row.hasTerrace,
    status: row.status,
    verified: row.verified,
    updatedAt: row.updatedAt.toISOString(),
  }
  const optional: Partial<Place> = {
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    // Défense en profondeur : déjà nettoyé à l'écriture, mais un lieu `user` ou une
    // ligne ancienne pourrait ne pas l'être.
    website: sanitizeWebsite(row.website),
    openingHours: row.openingHours ?? undefined,
    // Même défense pour l'image : `https:` uniquement (une ligne ancienne peut contenir du `http:`).
    image: sanitizeImageUrl(row.image),
    cuisine: row.cuisine ?? undefined,
    description: row.description ?? undefined,
    dogStatusSource: describeDogStatusSource(info, now),
    osmDogDetail: osm.detail,
    accessConditional: tags['access:conditional'],
    mergedInto: row.mergedInto ?? undefined,
  }
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined && value !== '') (place as unknown as Record<string, unknown>)[key] = value
  }
  return place
}
