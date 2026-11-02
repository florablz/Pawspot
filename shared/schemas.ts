/**
 * Schémas Zod partagés (validation des entrées d'API, §4.3). Messages en français.
 */
import { z } from 'zod'
import { CATEGORY_KEYS } from './categories'
import { parseBbox } from './geo'
import type { Bbox } from './geo'

/** `osm:<node|way|relation>:<id>` ou `user:<nanoid>` (1 à 64 caractères `A-Za-z0-9_-`). */
export const PLACE_ID_PATTERN = /^(?:osm:(?:node|way|relation):[1-9]\d{0,15}|user:[\w-]{1,64})$/

export const placeIdSchema = z.string({ error: 'Identifiant de lieu requis' })
  .trim()
  .regex(PLACE_ID_PATTERN, { error: 'Identifiant de lieu invalide' })

export const categoryKeySchema = z.enum(CATEGORY_KEYS, { error: 'Catégorie inconnue' })

/** `minLon,minLat,maxLon,maxLat` → `Bbox` (lon ∈ [-180, 180], lat ∈ [-90, 90], min ≤ max). */
export const bboxSchema = z.string({ error: 'Emprise (bbox) requise' })
  .transform((value, ctx): Bbox => {
    const bbox = parseBbox(value)
    if (!bbox) {
      ctx.addIssue({ code: 'custom', message: 'Emprise invalide : attendu minLon,minLat,maxLon,maxLat' })
      return z.NEVER
    }
    return bbox
  })

/** Requête de `GET /api/places` (valeurs de `getQuery`, donc des chaînes). */
export const placesQuerySchema = z.object({
  bbox: bboxSchema,
  zoom: z.coerce.number({ error: 'Zoom invalide' })
    .int({ error: 'Le zoom doit être un entier' })
    .min(0, { error: 'Zoom invalide' })
    .max(22, { error: 'Zoom invalide' }),
})

export type PlacesQuery = z.infer<typeof placesQuerySchema>

/** Paramètre de route `:id` / `:placeId`. */
export const placeIdParamsSchema = z.object({ id: placeIdSchema })

/** Corps de `POST /api/favorites` (et `DELETE`) : seul l'id est envoyé, le lieu doit exister en base. */
export const favoriteBodySchema = z.object({ placeId: placeIdSchema })

// ---------------------------------------------------------------------------
// Conversion des anciens identifiants (Phase 0)
// ---------------------------------------------------------------------------

export type ParsedPlaceId =
  | { source: 'osm'; osmType: 'node' | 'way' | 'relation'; osmId: number }
  | { source: 'user'; key: string }

export function parsePlaceId(id: string): ParsedPlaceId | null {
  if (!PLACE_ID_PATTERN.test(id)) return null
  const [source, a, b] = id.split(':') as [string, string, string | undefined]
  if (source === 'user') return { source: 'user', key: a }
  return { source: 'osm', osmType: a as 'node' | 'way' | 'relation', osmId: Number(b) }
}

export function osmPlaceId(type: 'node' | 'way' | 'relation', id: number | string): string {
  return `osm:${type}:${id}`
}

/**
 * Ancien format Phase 0 → nouveau : `node-123` → `osm:node:123`, `demo-1` → `user:demo-1`.
 * Renvoie l'id tel quel s'il est déjà au nouveau format, `null` s'il est illisible.
 * (Même règle que la migration `0001_places_cache.sql`.)
 */
export function convertLegacyPlaceId(id: string): string | null {
  if (PLACE_ID_PATTERN.test(id)) return id
  const m = /^(node|way|relation)-([1-9]\d{0,15})$/.exec(id)
  if (m) return osmPlaceId(m[1] as 'node' | 'way' | 'relation', m[2]!)
  if (/^demo-[\w-]{1,59}$/.test(id)) return `user:${id}`
  return null
}
