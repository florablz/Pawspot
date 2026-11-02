import { db } from '../../database'
import { reviews } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)

  const placeId = String(body.placeId || '')
  const rating = Number(body.rating)
  const comment = String(body.comment || '').trim()
  const photos: string[] = Array.isArray(body.photos) ? body.photos : []

  if (!placeId) {
    throw createError({ statusCode: 400, statusMessage: 'placeId requis' })
  }
  if (!rating || rating < 1 || rating > 5) {
    throw createError({ statusCode: 400, statusMessage: 'Note entre 1 et 5 requise' })
  }
  if (photos.length > 5) {
    throw createError({ statusCode: 400, statusMessage: '5 photos maximum' })
  }

  const inserted = await db.insert(reviews).values({
    placeId,
    userId: user.id,
    rating,
    comment: comment || null,
    photos: photos.length ? JSON.stringify(photos) : null,
  }).returning({ id: reviews.id }).get()

  return {
    id: inserted.id,
    placeId,
    rating,
    comment,
    photos,
    username: user.username,
    avatarUrl: user.avatarUrl,
    createdAt: new Date(),
  }
})
