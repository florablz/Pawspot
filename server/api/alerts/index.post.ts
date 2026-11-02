import { recomputeDogStatus } from '~~/server/services/places'
import { db } from '../../database'
import { alerts } from '../../database/schema'
import { readValidatedBodyOr400, requirePlace } from '../../utils/api'
import { requireAuth } from '../../utils/auth'
import { alertBodySchema } from '../../utils/bodySchemas'

/**
 * `POST /api/alerts` `{ placeId, type, description? }` → alerte créée.
 * Le statut chien du lieu est recalculé ensuite (`dogs_not_allowed` compte à partir de 3 membres).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { placeId, type, description } = await readValidatedBodyOr400(event, alertBodySchema)
  await requirePlace(placeId)

  const inserted = await db.insert(alerts).values({
    placeId,
    userId: user.id,
    type,
    description,
  }).returning({ id: alerts.id, createdAt: alerts.createdAt }).get()

  await recomputeDogStatus(placeId)

  return {
    id: inserted.id,
    placeId,
    type,
    description,
    username: user.username,
    createdAt: inserted.createdAt,
  }
})
