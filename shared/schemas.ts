/**
 * Schémas Zod partagés (validation des entrées d'API, §4.3). Messages en français.
 */
import { z } from 'zod'
import { CATEGORY_KEYS } from './categories'
import { parseBbox } from './geo'
import type { Bbox } from './geo'
import { GEOCODE_RESULT_TYPES } from './types'

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
// Avis (§3.8)
// ---------------------------------------------------------------------------

export const REVIEW_COMMENT_MAX_LENGTH = 1000
export const REVIEW_MAX_PHOTOS = 5
/**
 * Longueur maximale d'une photo en data URI : ≈ 2 Mo binaires une fois décodés
 * (base64 = 4 caractères pour 3 octets). Mesure transitoire : les photos passeront
 * en fichiers (`POST /api/uploads`) en Phase 3.
 */
export const REVIEW_PHOTO_MAX_LENGTH = 2_800_000

const PHOTO_DATA_URL_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export const reviewPhotoSchema = z.string({ error: 'Photo invalide' })
  .max(REVIEW_PHOTO_MAX_LENGTH, { error: 'Photo trop lourde (2 Mo maximum)' })
  .regex(PHOTO_DATA_URL_PATTERN, { error: 'Photo invalide : image JPEG, PNG ou WebP attendue' })

export const reviewBodySchema = z.object({
  placeId: placeIdSchema,
  rating: z.number({ error: 'Note entre 1 et 5 requise' })
    .int({ error: 'La note doit être un nombre entier' })
    .min(1, { error: 'Note entre 1 et 5 requise' })
    .max(5, { error: 'Note entre 1 et 5 requise' }),
  comment: z.string({ error: 'Commentaire invalide' })
    .trim()
    .max(REVIEW_COMMENT_MAX_LENGTH, { error: `Commentaire trop long (${REVIEW_COMMENT_MAX_LENGTH} caractères maximum)` })
    .nullish()
    .transform(value => value || null),
  photos: z.array(reviewPhotoSchema, { error: 'Photos invalides' })
    .max(REVIEW_MAX_PHOTOS, { error: `${REVIEW_MAX_PHOTOS} photos maximum` })
    .nullish()
    .transform(value => value ?? []),
})

export type ReviewBody = z.infer<typeof reviewBodySchema>

// ---------------------------------------------------------------------------
// Alertes (§3.10)
// ---------------------------------------------------------------------------

/**
 * `closed` et `change` : types de la Phase 0 (formulaire actuel du front).
 * `temporarily_closed`, `dogs_not_allowed`, `info_change` : types du §3.10, déjà
 * pris en compte par `computeAlertFlags` (`dogs_not_allowed` à partir de 3 membres).
 */
export const ALERT_TYPES = ['closed', 'temporarily_closed', 'dogs_not_allowed', 'info_change', 'change'] as const
export type AlertType = (typeof ALERT_TYPES)[number]

/** Types pour lesquels la description est obligatoire. */
export const ALERT_TYPES_WITH_DESCRIPTION: readonly AlertType[] = ['change', 'info_change']

export const ALERT_DESCRIPTION_MAX_LENGTH = 500

export const alertBodySchema = z.object({
  placeId: placeIdSchema,
  type: z.enum(ALERT_TYPES, { error: 'Type d\'alerte invalide' }),
  description: z.string({ error: 'Description invalide' })
    .trim()
    .max(ALERT_DESCRIPTION_MAX_LENGTH, { error: `Description trop longue (${ALERT_DESCRIPTION_MAX_LENGTH} caractères maximum)` })
    .nullish()
    .transform(value => value || null),
}).superRefine((body, ctx) => {
  if (ALERT_TYPES_WITH_DESCRIPTION.includes(body.type) && !body.description) {
    ctx.addIssue({ code: 'custom', path: ['description'], message: 'Description requise pour ce type d\'alerte' })
  }
})

export type AlertBody = z.infer<typeof alertBodySchema>

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20
export const PASSWORD_MIN_LENGTH = 8

/** Email normalisé : espaces retirés, minuscules. */
const normalizedEmail = z.string({ error: 'Email invalide' }).trim().toLowerCase()

export const registerBodySchema = z.object({
  email: normalizedEmail.pipe(z.email({ error: 'Email invalide' })),
  username: z.string({ error: 'Pseudo requis' })
    .trim()
    .min(USERNAME_MIN_LENGTH, { error: `Le pseudo doit faire entre ${USERNAME_MIN_LENGTH} et ${USERNAME_MAX_LENGTH} caractères` })
    .max(USERNAME_MAX_LENGTH, { error: `Le pseudo doit faire entre ${USERNAME_MIN_LENGTH} et ${USERNAME_MAX_LENGTH} caractères` }),
  password: z.string({ error: 'Mot de passe requis' })
    .min(PASSWORD_MIN_LENGTH, { error: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères` }),
})

export type RegisterBody = z.infer<typeof registerBodySchema>

/** Connexion : on ne vérifie pas le format de l'email (un email mal formé n'existe simplement pas). */
export const loginBodySchema = z.object({
  email: z.string({ error: 'Email et mot de passe requis' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'Email et mot de passe requis' }),
  password: z.string({ error: 'Email et mot de passe requis' })
    .min(1, { error: 'Email et mot de passe requis' }),
})

export type LoginBody = z.infer<typeof loginBodySchema>

// ---------------------------------------------------------------------------
// Géocodage (§3.2)
// ---------------------------------------------------------------------------

export const GEOCODE_QUERY_MIN_LENGTH = 2
export const GEOCODE_QUERY_MAX_LENGTH = 100

/** Requête de `GET /api/geocode?q=` : `q` de 2 à 100 caractères après suppression des espaces aux bords. */
export const geocodeQuerySchema = z.object({
  q: z.string({ error: 'Recherche requise' })
    .trim()
    .min(GEOCODE_QUERY_MIN_LENGTH, { error: `La recherche doit faire au moins ${GEOCODE_QUERY_MIN_LENGTH} caractères` })
    .max(GEOCODE_QUERY_MAX_LENGTH, { error: `La recherche doit faire au plus ${GEOCODE_QUERY_MAX_LENGTH} caractères` }),
})

export type GeocodeQuery = z.infer<typeof geocodeQuerySchema>

const latSchema = z.number().min(-90).max(90)
const lonSchema = z.number().min(-180).max(180)

/**
 * Forme d'un `GeocodeResult` (shared/types.ts) : sert à relire le cache en base
 * (`geocode_cache`) et peut servir à `back` pour vérifier sa conversion.
 */
export const geocodeResultSchema = z.object({
  label: z.string().min(1),
  lat: latSchema,
  lon: lonSchema,
  bbox: z.object({ minLon: lonSchema, minLat: latSchema, maxLon: lonSchema, maxLat: latSchema })
    .refine(b => b.minLon <= b.maxLon && b.minLat <= b.maxLat, { error: 'Emprise inversée' })
    .optional(),
  type: z.enum(GEOCODE_RESULT_TYPES),
  postcode: z.string().optional(),
  city: z.string().optional(),
})

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
