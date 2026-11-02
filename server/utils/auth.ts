import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { nanoid } from 'nanoid'
import { db } from '../database'
import { users, sessions } from '../database/schema'
import { deleteCookie, getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { apiError } from './api'

const SESSION_COOKIE = 'pawspot-session'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash)
}

/**
 * Hash bcrypt (coût 10, comme `hashPassword`) d'un mot de passe qui n'appartient à
 * personne : comparé quand l'email est inconnu, pour que la connexion prenne le même
 * temps qu'avec un mauvais mot de passe.
 */
const DUMMY_PASSWORD_HASH = '$2b$10$p2fppiBmvP/LuAVoXAvxeuXvIraXE4pCmD0IpEmiWeBuEBxn5LQcy'

/** Comparaison bcrypt factice : même coût qu'une vraie, résultat toujours `false`. */
export async function verifyPasswordAgainstDummy(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_PASSWORD_HASH)
  return false
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

/** Jeton de session lu dans le cookie, ou `undefined`. */
export function getSessionToken(event: H3Event): string | undefined {
  return getCookie(event, SESSION_COOKIE)
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
  const token = getSessionToken(event)
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
    throw apiError(401, 'Non authentifié')
  }
  return user
}
