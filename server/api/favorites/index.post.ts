import { favoriteBodySchema } from '~~/shared/schemas'
import { db } from '../../database'
import { favorites } from '../../database/schema'
import { readValidatedBodyOr400, requirePlace } from '../../utils/api'
import { requireAuth } from '../../utils/auth'

/**
 * `POST /api/favorites` `{ placeId }` → `{ placeId, favorited: true }`.
 * Idempotent : un lieu déjà en favori renvoie la même réponse, sans doublon.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { placeId } = await readValidatedBodyOr400(event, favoriteBodySchema)
  await requirePlace(placeId, { allowOverpass: true })

  await db.insert(favorites)
    .values({ userId: user.id, placeId })
    .onConflictDoNothing({ target: [favorites.userId, favorites.placeId] })

  return { placeId, favorited: true }
})
