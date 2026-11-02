import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { nanoid } from 'nanoid'
import { db } from '../database'
import { users, sessions } from '../database/schema'
import type { H3Event } from 'h3'

const SESSION_COOKIE = 'pawspot-session'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash)
}

export async function createSession(userId: number) {
  const id = nanoid(32)
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000)
  await db.insert(sessions).values({ id, userId, expiresAt })
  return id
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.id, token))
}

export function setSessionCookie(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

export function clearSessionCookie(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export async function getUserFromSession(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null

  const session = await db.select().from(sessions).where(eq(sessions.id, token)).get()
  if (!session || session.expiresAt < new Date()) {
    if (session) await deleteSession(token)
    clearSessionCookie(event)
    return null
  }

  const user = await db.select({
    id: users.id,
    email: users.email,
    username: users.username,
    avatarUrl: users.avatarUrl,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, session.userId)).get()

  return user || null
}

export async function requireAuth(event: H3Event) {
  const user = await getUserFromSession(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Non authentifie' })
  }
  return user
}
