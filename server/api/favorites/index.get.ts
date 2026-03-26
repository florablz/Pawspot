import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { favorites } from '../../database/schema'

export default defineEventHandler((event) => {
  const user = requireAuth(event)

  return db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, user.id))
    .all()
})
