import { desc, eq } from 'drizzle-orm'
import type { Place } from '~~/shared/types'
import { rowToPlace } from '~~/server/services/places'
import { db } from '../../database'
import { favorites, places } from '../../database/schema'
import { requireAuth } from '../../utils/auth'

export type FavoritePlace = Place & { favoritedAt: string }

/** `GET /api/favorites` → `FavoritePlace[]` (lieux complets, plus récents d'abord). */
export default defineEventHandler(async (event): Promise<FavoritePlace[]> => {
  const user = await requireAuth(event)
  const now = new Date()

  const rows = await db
    .select({ place: places, favoritedAt: favorites.createdAt })
    .from(favorites)
    .innerJoin(places, eq(favorites.placeId, places.id))
    .where(eq(favorites.userId, user.id))
    .orderBy(desc(favorites.createdAt), desc(favorites.id))
    .all()

  return rows
    .filter(r => r.place.status !== 'hidden')
    .map(r => ({ ...rowToPlace(r.place, now), favoritedAt: r.favoritedAt.toISOString() }))
})
