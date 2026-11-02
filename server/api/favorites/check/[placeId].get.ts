import { and, eq } from 'drizzle-orm'
import { db } from '../../../database'
import { favorites } from '../../../database/schema'
import { getPlaceIdParam } from '../../../utils/api'
import { getUserFromSession } from '../../../utils/auth'

/** `GET /api/favorites/check/:placeId` → `{ favorited }` (`false` si non connecté). */
export default defineEventHandler(async (event) => {
  const placeId = getPlaceIdParam(event)
  const user = await getUserFromSession(event)
  if (!user) return { favorited: false }

  const existing = await db.select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.userId, user.id), eq(favorites.placeId, placeId)))
    .get()

  return { favorited: !!existing }
})
