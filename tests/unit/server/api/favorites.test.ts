import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMock, overpassResponse, setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }
interface FavoritePlace { id: string; name: string; favoritedAt: string }

let api: ApiBench
let alice: { id: number; session: string }
let bob: { id: number; session: string }
const DEMO = 'user:demo-1'
const PARC = 'user:demo-2'
const enc = encodeURIComponent

async function favoriteRows(userId: number) {
  return api.db.select().from(api.schema.favorites).where(eq(api.schema.favorites.userId, userId)).all()
}

beforeAll(async () => {
  api = await setupApi()
  await api.insertPlace({ id: DEMO, name: 'Café démo' })
  await api.insertPlace({ id: PARC, name: 'Parc démo', category: 'park' })
  alice = await api.createUser('alice')
  bob = await api.createUser('bob')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  fetchMock.mockReset()
  await api.db.delete(api.schema.favorites)
})

describe('favoris — droits d\'accès', () => {
  it.each([
    ['GET', '/api/favorites', undefined],
    ['POST', '/api/favorites', { placeId: DEMO }],
    ['DELETE', `/api/favorites/${enc(DEMO)}`, undefined],
  ])('%s %s sans session : 401', async (method, path, body) => {
    const res = await api.request<ApiErrorBody>(method, path, { body })
    expect(res.status).toBe(401)
    expect(res.body.statusCode).toBe(401)
  })

  it('session inconnue : 401', async () => {
    const res = await api.request('GET', '/api/favorites', { session: 'jeton-inexistant' })
    expect(res.status).toBe(401)
  })

  it('check sans connexion : { favorited: false }', async () => {
    const res = await api.request('GET', `/api/favorites/check/${enc(DEMO)}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ favorited: false })
  })
})

describe('POST /api/favorites', () => {
  it('ajoute deux fois le même lieu sans créer de doublon', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await api.request('POST', '/api/favorites', { session: alice.session, body: { placeId: DEMO } })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ placeId: DEMO, favorited: true })
    }
    expect(await favoriteRows(alice.id)).toHaveLength(1)
  })

  it('lieu communautaire inconnu : 404', async () => {
    const res = await api.request<ApiErrorBody>('POST', '/api/favorites', { session: alice.session, body: { placeId: 'user:inconnu' } })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Lieu introuvable')
    expect(await favoriteRows(alice.id)).toHaveLength(0)
  })

  it('lieu OSM inconnu d\'Overpass : 404', async () => {
    fetchMock.mockResolvedValue(overpassResponse([]))
    const res = await api.request('POST', '/api/favorites', { session: alice.session, body: { placeId: 'osm:node:123456' } })
    expect(res.status).toBe(404)
  })

  it.each([
    ['corps vide', undefined, 'Corps de la requête manquant ou invalide'],
    ['corps JSON vide', '', 'Corps de la requête manquant ou invalide'],
    ['tableau', [DEMO], 'Corps de la requête manquant ou invalide'],
    ['sans placeId', {}, 'Identifiant de lieu requis'],
    ['placeId invalide', { placeId: 'node-1' }, 'Identifiant de lieu invalide'],
    ['JSON cassé', '{"placeId":', 'Corps de la requête illisible (JSON attendu)'],
  ])('%s : 400', async (_label, body, message) => {
    const res = await api.request<ApiErrorBody>('POST', '/api/favorites', { session: alice.session, body })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, message })
  })
})

describe('DELETE /api/favorites/:placeId', () => {
  it('retire deux fois de suite : idempotent', async () => {
    await api.request('POST', '/api/favorites', { session: alice.session, body: { placeId: DEMO } })
    for (let i = 0; i < 2; i++) {
      const res = await api.request('DELETE', `/api/favorites/${enc(DEMO)}`, { session: alice.session })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ placeId: DEMO, favorited: false })
    }
    expect(await favoriteRows(alice.id)).toHaveLength(0)
  })

  it('ne retire pas le favori d\'un autre utilisateur', async () => {
    await api.request('POST', '/api/favorites', { session: bob.session, body: { placeId: DEMO } })
    await api.request('DELETE', `/api/favorites/${enc(DEMO)}`, { session: alice.session })
    expect(await favoriteRows(bob.id)).toHaveLength(1)
  })

  it('id invalide : 400', async () => {
    const res = await api.request('DELETE', '/api/favorites/n%27importe', { session: alice.session })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/favorites et check', () => {
  it('liste les lieux complets de l\'utilisateur uniquement, check vrai puis faux', async () => {
    await api.request('POST', '/api/favorites', { session: alice.session, body: { placeId: DEMO } })
    await api.request('POST', '/api/favorites', { session: alice.session, body: { placeId: PARC } })
    await api.request('POST', '/api/favorites', { session: bob.session, body: { placeId: PARC } })

    const list = await api.request<FavoritePlace[]>('GET', '/api/favorites', { session: alice.session })
    expect(list.status).toBe(200)
    expect(list.body.map(p => p.id).sort()).toEqual([DEMO, PARC])
    expect(list.body[0]).toMatchObject({ name: expect.any(String), favoritedAt: expect.any(String) })

    const bobList = await api.request<FavoritePlace[]>('GET', '/api/favorites', { session: bob.session })
    expect(bobList.body.map(p => p.id)).toEqual([PARC])

    expect((await api.request('GET', `/api/favorites/check/${enc(DEMO)}`, { session: alice.session })).body).toEqual({ favorited: true })
    expect((await api.request('GET', `/api/favorites/check/${enc(DEMO)}`, { session: bob.session })).body).toEqual({ favorited: false })
  })

  it('check avec un id invalide : 400', async () => {
    const res = await api.request('GET', '/api/favorites/check/abc')
    expect(res.status).toBe(400)
  })
})
