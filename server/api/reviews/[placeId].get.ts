import { desc, eq } from 'drizzle-orm'
import { db } from '../../database'
import { reviews, users } from '../../database/schema'
import { getPlaceIdParam } from '../../utils/api'

function parsePhotos(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
  }
  catch {
    return []
  }
}

/**
 * `GET /api/reviews/:placeId` → avis du lieu, plus récents d'abord. Auteur exposé par
 * `username` / `avatarUrl` uniquement (ni `userId`, ni email).
 */
export default defineEventHandler(async (event) => {
  const placeId = getPlaceIdParam(event)

  const rows = await db
    .select({
      id: reviews.id,
      placeId: reviews.placeId,
      rating: reviews.rating,
      comment: reviews.comment,
      photos: reviews.photos,
      createdAt: reviews.createdAt,
      username: users.username,
      avatarUrl: users.avatarUrl,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.userId, users.id))
    .where(eq(reviews.placeId, placeId))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .all()

  return rows.map(r => ({ ...r, photos: parsePhotos(r.photos) }))
})
