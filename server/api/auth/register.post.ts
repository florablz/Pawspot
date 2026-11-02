import { eq, or } from 'drizzle-orm'
import { db } from '../../database'
import { users } from '../../database/schema'
import { apiError, readValidatedBodyOr400 } from '../../utils/api'
import { createSession, hashPassword, setSessionCookie } from '../../utils/auth'
import { registerBodySchema } from '~~/shared/schemas'

/**
 * `POST /api/auth/register` `{ email, username, password }` → `{ id, email, username, avatarUrl }`
 * et ouvre une session (cookie). Entrée invalide → 400 ; email ou pseudo pris → 409.
 */
export default defineEventHandler(async (event) => {
  const { email, username, password } = await readValidatedBodyOr400(event, registerBodySchema)

  const existing = await db.select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
    .get()

  if (existing) {
    throw apiError(409, 'Email ou pseudo déjà utilisé')
  }

  const passwordHash = await hashPassword(password)

  const inserted = await db.insert(users)
    .values({ email, username, passwordHash })
    .returning({ id: users.id })
    .get()
  const userId = inserted.id

  const token = await createSession(userId)
  setSessionCookie(event, token)

  return {
    id: userId,
    email,
    username,
    avatarUrl: null,
  }
})
