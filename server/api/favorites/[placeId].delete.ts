import { and, eq } from 'drizzle-orm'
import { db } from '../../database'
import { favorites } from '../../database/schema'
import { getPlaceIdParam } from '../../utils/api'
import { requireAuth } from '../../utils/auth'

/**
 * `DELETE /api/favorites/:placeId` → `{ placeId, favorited: false }`.
 * Idempotent : retirer un lieu qui n'est pas (ou plus) en favori renvoie la même réponse.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const placeId = getPlaceIdParam(event)

  await db.delete(favorites)
    .where(and(eq(favorites.userId, user.id), eq(favorites.placeId, placeId)))

  return { placeId, favorited: false }
})
