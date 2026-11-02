import { eq, or } from 'drizzle-orm'
import { db } from '../../database'
import { users } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const email = String(body.email || '').trim().toLowerCase()
  const username = String(body.username || '').trim()
  const password = String(body.password || '')

  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Email invalide' })
  }
  if (username.length < 3 || username.length > 20) {
    throw createError({ statusCode: 400, statusMessage: 'Le pseudo doit faire entre 3 et 20 caracteres' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Le mot de passe doit faire au moins 8 caracteres' })
  }

  const existing = await db.select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.username, username)))
    .get()

  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Email ou pseudo deja utilise' })
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
