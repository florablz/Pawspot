import { eq, and } from 'drizzle-orm'
import { db } from '../../../database'
import { favorites } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event)
  if (!user) return { favorited: false }

  const placeId = getRouterParam(event, 'placeId')
  if (!placeId) return { favorited: false }

  const existing = await db.select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.userId, user.id), eq(favorites.placeId, placeId)))
    .get()

  return { favorited: !!existing }
})
