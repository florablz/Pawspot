import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { reviews, users } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const placeId = getRouterParam(event, 'placeId')
  if (!placeId) {
    throw createError({ statusCode: 400, statusMessage: 'placeId requis' })
  }

  const rows = await db
    .select({
      id: reviews.id,
      placeId: reviews.placeId,
      rating: reviews.rating,
      comment: reviews.comment,
      photos: reviews.photos,
      createdAt: reviews.createdAt,
      userId: reviews.userId,
      username: users.username,
      avatarUrl: users.avatarUrl,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.userId, users.id))
    .where(eq(reviews.placeId, placeId))
    .all()

  return rows.map(r => ({
    ...r,
    photos: r.photos ? JSON.parse(r.photos) : [],
  }))
})
