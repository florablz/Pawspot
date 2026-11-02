import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { users } from '../../database/schema'
import { apiError, readValidatedBodyOr400 } from '../../utils/api'
import { createSession, setSessionCookie, verifyPassword, verifyPasswordAgainstDummy } from '../../utils/auth'
import { loginBodySchema } from '../../utils/bodySchemas'

/**
 * `POST /api/auth/login` `{ email, password }` → `{ id, email, username, avatarUrl }`
 * et ouvre une session (cookie). Champs manquants → 400 ; identifiants faux → 401.
 *
 * Email inconnu ou mauvais mot de passe : même message, et une comparaison bcrypt
 * dans les deux cas, pour ne pas révéler par le temps de réponse qu'un email existe.
 */
export default defineEventHandler(async (event) => {
  const { email, password } = await readValidatedBodyOr400(event, loginBodySchema)

  const user = await db.select().from(users).where(eq(users.email, email)).get()

  const valid = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPasswordAgainstDummy(password)

  if (!user || !valid) {
    throw apiError(401, 'Email ou mot de passe incorrect')
  }

  const token = await createSession(user.id)
  setSessionCookie(event, token)

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
  }
})
