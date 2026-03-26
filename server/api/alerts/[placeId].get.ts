import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { alerts, users } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const placeId = getRouterParam(event, 'placeId')
  if (!placeId) {
    throw createError({ statusCode: 400, statusMessage: 'placeId requis' })
  }

  return db
    .select({
      id: alerts.id,
      placeId: alerts.placeId,
      type: alerts.type,
      description: alerts.description,
      createdAt: alerts.createdAt,
      username: users.username,
    })
    .from(alerts)
    .innerJoin(users, eq(alerts.userId, users.id))
    .where(eq(alerts.placeId, placeId))
    .all()
})
