import { eq, and } from 'drizzle-orm'
import { db } from '../../database'
import { favorites } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)

  const placeId = String(body.placeId || '')
  const placeName = String(body.placeName || '')
  const placeLat = Number(body.placeLat)
  const placeLon = Number(body.placeLon)
  const placeCategory = String(body.placeCategory || '')

  if (!placeId || !placeName) {
    throw createError({ statusCode: 400, statusMessage: 'Donnees du lieu requises' })
  }

  // Check if already favorited
  const existing = await db.select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.userId, user.id), eq(favorites.placeId, placeId)))
    .get()

  if (existing) {
    // Remove favorite (toggle)
    await db.delete(favorites).where(eq(favorites.id, existing.id))
    return { favorited: false }
  }

  // Add favorite
  await db.insert(favorites).values({
    userId: user.id,
    placeId,
    placeName,
    placeLat,
    placeLon,
    placeCategory,
  })

  return { favorited: true }
})
