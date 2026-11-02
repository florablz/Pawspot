/**
 * Schémas Zod des corps des routes avis et alertes.
 * À déplacer dans `shared/schemas.ts` pour que le front valide
 * avec les mêmes règles.
 */
import { z } from 'zod'
import { placeIdSchema } from '~~/shared/schemas'

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
