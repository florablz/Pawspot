import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { favorites } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)

  return await db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, user.id))
    .all()
})
