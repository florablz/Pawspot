import { db } from '../../database'
import { reviews } from '../../database/schema'
import { readValidatedBodyOr400, requirePlace } from '../../utils/api'
import { requireAuth } from '../../utils/auth'
import { reviewBodySchema } from '~~/shared/schemas'

/**
 * `POST /api/reviews` `{ placeId, rating, comment?, photos? }` → avis créé.
 * `rating` entier 1–5, `comment` ≤ 1000 caractères, `photos` ≤ 5 data URI
 * JPEG / PNG / WebP de ≈ 2 Mo maximum chacune.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { placeId, rating, comment, photos } = await readValidatedBodyOr400(event, reviewBodySchema)
  await requirePlace(placeId)

  const inserted = await db.insert(reviews).values({
    placeId,
    userId: user.id,
    rating,
    comment,
    photos: photos.length ? JSON.stringify(photos) : null,
  }).returning({ id: reviews.id, createdAt: reviews.createdAt }).get()

  return {
    id: inserted.id,
    placeId,
    rating,
    comment,
    photos,
    userId: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    createdAt: inserted.createdAt,
  }
})
