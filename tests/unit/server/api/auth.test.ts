import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }
interface PublicUser { id: number; email: string; username: string; avatarUrl: string | null }

let api: ApiBench
const PASSWORD = 'croquettes-2026'
const CAMILLE = { email: 'Camille@Exemple.fr', username: 'camille', password: PASSWORD }

const register = (body: unknown) => api.request<PublicUser & ApiErrorBody>('POST', '/api/auth/register', { body })
const login = (body: unknown) => api.request<PublicUser & ApiErrorBody>('POST', '/api/auth/login', { body })
const me = (session?: string) => api.request<{ user: PublicUser | null }>('GET', '/api/auth/me', { session })

async function sessionRow(id: string) {
  return api.db.select().from(api.schema.sessions).where(eq(api.schema.sessions.id, id)).get()
}

beforeAll(async () => {
  api = await setupApi()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/auth/register', () => {
  it('inscrit un utilisateur, ouvre une session, ne renvoie pas le hash', async () => {
    const res = await register(CAMILLE)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: expect.any(Number), email: 'camille@exemple.fr', username: 'camille', avatarUrl: null })
    expect(res.text).not.toMatch(/password|hash/i)
    expect(res.sessionCookie).toMatch(/^[\w-]{32}$/)
    expect(await sessionRow(res.sessionCookie!)).toBeTruthy()

    const row = await api.db.select().from(api.schema.users).where(eq(api.schema.users.id, res.body.id)).get()
    expect(row!.passwordHash).not.toBe(PASSWORD)
    expect(row!.passwordHash).toMatch(/^\$2[aby]\$10\$/)
  })

  it.each([
    ['email déjà utilisé (casse différente)', { ...CAMILLE, username: 'camille2', email: 'CAMILLE@exemple.fr' }],
    ['pseudo déjà utilisé', { ...CAMILLE, email: 'autre@exemple.fr' }],
  ])('refuse un doublon : %s (409)', async (_label, body) => {
    const res = await register(body)
    expect(res.status).toBe(409)
    expect(res.body.statusCode).toBe(409)
    expect(res.sessionCookie).toBeUndefined()
  })

  it.each([
    ['email invalide', { ...CAMILLE, email: 'pas-un-email' }],
    ['pseudo trop court', { ...CAMILLE, email: 'x@exemple.fr', username: 'ab' }],
    ['pseudo trop long', { ...CAMILLE, email: 'x@exemple.fr', username: 'a'.repeat(21) }],
    ['mot de passe trop court', { ...CAMILLE, email: 'x@exemple.fr', username: 'xavier', password: '1234567' }],
  ])('refuse %s (400)', async (_label, body) => {
    const res = await register(body)
    expect(res.status).toBe(400)
    expect(res.body.statusCode).toBe(400)
  })

  // Bug : la route lit `body.email` sans vérifier que le corps existe ; un corps
  // vide lève une TypeError et renvoie 500 au lieu de 400.
  it.fails('corps vide : 400 (et non 500)', async () => {
    const res = await register(undefined)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  it('connecte avec le bon mot de passe (email insensible à la casse)', async () => {
    const res = await login({ email: '  CAMILLE@exemple.fr ', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ email: 'camille@exemple.fr', username: 'camille' })
    expect(res.text).not.toMatch(/password|hash/i)
    expect(res.sessionCookie).toMatch(/^[\w-]{32}$/)
  })

  it('mauvais mot de passe et email inconnu : même 401, sans cookie', async () => {
    const wrong = await login({ email: CAMILLE.email, password: 'mauvais-mot-de-passe' })
    const unknown = await login({ email: 'personne@exemple.fr', password: PASSWORD })
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401)
      expect(res.sessionCookie).toBeUndefined()
    }
    expect(wrong.body.message).toBe(unknown.body.message)
  })

  it('champs manquants : 400', async () => {
    expect((await login({ email: CAMILLE.email })).status).toBe(400)
  })

  // Même bug que pour l'inscription : corps vide → TypeError → 500.
  it.fails('corps vide : 400 (et non 500)', async () => {
    const res = await login(undefined)
    expect(res.status).toBe(400)
  })
})

describe('session : me, déconnexion, expiration', () => {
  it('me : utilisateur connecté (sans hash) ; sans session : null', async () => {
    const { sessionCookie } = await login({ email: CAMILLE.email, password: PASSWORD })
    const res = await me(sessionCookie)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ email: 'camille@exemple.fr', username: 'camille', avatarUrl: null })
    expect(res.text).not.toMatch(/password|hash/i)

    expect((await me()).body).toEqual({ user: null })
    expect((await me('jeton-inconnu')).body).toEqual({ user: null })
  })

  it('déconnexion : supprime la session et efface le cookie', async () => {
    const { sessionCookie } = await login({ email: CAMILLE.email, password: PASSWORD })
    const res = await api.request('POST', '/api/auth/logout', { session: sessionCookie })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(res.sessionCookie).toBe('')
    expect(await sessionRow(sessionCookie!)).toBeUndefined()
    expect((await me(sessionCookie)).body).toEqual({ user: null })
  })

  it('déconnexion sans session : ok', async () => {
    const res = await api.request('POST', '/api/auth/logout')
    expect(res.status).toBe(200)
  })

  it('session expirée : traitée comme déconnectée, supprimée en base, 401 sur une route protégée', async () => {
    const user = await api.createUser('dora')
    await api.db.update(api.schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(api.schema.sessions.id, user.session))

    const protectedRes = await api.request('GET', '/api/favorites', { session: user.session })
    expect(protectedRes.status).toBe(401)
    expect(protectedRes.sessionCookie).toBe('')
    expect(await sessionRow(user.session)).toBeUndefined()
    expect((await me(user.session)).body).toEqual({ user: null })
  })

  it('me ne renvoie jamais l\'email d\'un autre utilisateur', async () => {
    const other = await api.createUser('eliot')
    const res = await me(other.session)
    expect(res.body.user?.email).toBe('eliot@exemple.fr')
    expect(res.text).not.toContain('camille@exemple.fr')
  })
})

describe('messages d\'erreur de l\'authentification', () => {
  // Bug : messages sans accents (« Non authentifie », « caracteres », « deja utilise »),
  // contraire à la règle « messages en français avec les accents ».
  it.fails('portent leurs accents', async () => {
    const unauthorized = await api.request<ApiErrorBody>('GET', '/api/favorites')
    const tooShort = await register({ ...CAMILLE, email: 'y@exemple.fr', username: 'ab' })
    const duplicate = await register(CAMILLE)
    expect(unauthorized.body.message).toBe('Non authentifié')
    expect(tooShort.body.message).toBe('Le pseudo doit faire entre 3 et 20 caractères')
    expect(duplicate.body.message).toBe('Email ou pseudo déjà utilisé')
  })
})
