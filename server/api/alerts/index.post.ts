import { db } from '../../database'
import { alerts } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const body = await readBody(event)

  const placeId = String(body.placeId || '')
  const type = String(body.type || '')
  const description = String(body.description || '').trim()

  if (!placeId) {
    throw createError({ statusCode: 400, statusMessage: 'placeId requis' })
  }
  if (type !== 'closed' && type !== 'change') {
    throw createError({ statusCode: 400, statusMessage: 'Type invalide (closed ou change)' })
  }
  if (type === 'change' && !description) {
    throw createError({ statusCode: 400, statusMessage: 'Description requise pour un changement' })
  }

  const inserted = await db.insert(alerts).values({
    placeId,
    userId: user.id,
    type,
    description: description || null,
  }).returning({ id: alerts.id }).get()

  return {
    id: inserted.id,
    placeId,
    type,
    description,
    username: user.username,
    createdAt: new Date(),
  }
})
