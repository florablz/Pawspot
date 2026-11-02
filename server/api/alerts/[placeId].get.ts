import { and, desc, eq, gte } from 'drizzle-orm'
import { ALERT_VISIBILITY_DAYS } from '~~/shared/dogStatus'
import { db } from '../../database'
import { alerts, users } from '../../database/schema'
import { getPlaceIdParam } from '../../utils/api'

const DAY_MS = 24 * 60 * 60 * 1000

/** `GET /api/alerts/:placeId` → alertes des 90 derniers jours, plus récentes d'abord (§3.10). */
export default defineEventHandler(async (event) => {
  const placeId = getPlaceIdParam(event)
  const since = new Date(Date.now() - ALERT_VISIBILITY_DAYS * DAY_MS)

  return await db
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
    .where(and(eq(alerts.placeId, placeId), gte(alerts.createdAt, since)))
    .orderBy(desc(alerts.createdAt), desc(alerts.id))
    .all()
})
