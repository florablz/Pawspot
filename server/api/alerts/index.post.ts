import { db } from '../../database'
import { alerts } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
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

  const result = db.insert(alerts).values({
    placeId,
    userId: user.id,
    type,
    description: description || null,
  }).run()

  return {
    id: Number(result.lastInsertRowid),
    placeId,
    type,
    description,
    username: user.username,
    createdAt: new Date(),
  }
})
