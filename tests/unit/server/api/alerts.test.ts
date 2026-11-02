import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../../../shared/types'
import { fetchMock, setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }
interface Alert { id: number; placeId: string; type: string; description: string | null; username: string; createdAt: string }

const DAY = 24 * 60 * 60 * 1000
const PLACE = 'osm:node:5001'

let api: ApiBench
let users: { id: number; session: string }[]
const enc = encodeURIComponent
const post = (body: unknown, session = users[0]!.session) => api.request<Alert & ApiErrorBody>('POST', '/api/alerts', { session, body })
const getPlace = async (id: string) => (await api.request<Place>('GET', `/api/places/${enc(id)}`)).body

beforeAll(async () => {
  api = await setupApi()
  users = []
  for (const name of ['alice', 'bob', 'chloe']) users.push(await api.createUser(name))
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  fetchMock.mockReset()
  await api.db.delete(api.schema.alerts)
  await api.db.delete(api.schema.places)
  // Café avec dog=yes : statut chien de départ osm_yes.
  await api.insertPlace({ id: PLACE, name: 'Café du Port', tags: { amenity: 'cafe', dog: 'yes' }, osmDogPolicy: 'all_day', dogStatus: 'osm_yes' })
})

describe('POST /api/alerts — refus', () => {
  it('sans session : 401', async () => {
    const res = await api.request('POST', '/api/alerts', { body: { placeId: PLACE, type: 'closed' } })
    expect(res.status).toBe(401)
  })

  it.each(['change', 'info_change'])('type %s sans description : 400', async (type) => {
    for (const description of [undefined, '', '   ']) {
      const res = await post({ placeId: PLACE, type, description })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Description requise pour ce type d\'alerte' })
    }
  })

  it.each([['type inconnu', 'hanté'], ['type absent', undefined]])('%s : 400', async (_label, type) => {
    const res = await post({ placeId: PLACE, type })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Type d\'alerte invalide')
  })

  it('description de plus de 500 caractères : 400', async () => {
    const res = await post({ placeId: PLACE, type: 'info_change', description: 'a'.repeat(501) })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Description trop longue (500 caractères maximum)')
  })

  it('corps vide, JSON cassé : 400 ; lieu inconnu : 404', async () => {
    expect((await post(undefined)).status).toBe(400)
    expect((await post('{"type":')).status).toBe(400)
    const unknown = await post({ placeId: 'user:inconnu', type: 'closed' })
    expect(unknown.status).toBe(404)
    expect(await api.db.select().from(api.schema.alerts).all()).toHaveLength(0)
  })
})

describe('POST /api/alerts puis GET /api/alerts/:placeId', () => {
  it('enregistre une alerte valide et la relit', async () => {
    const res = await post({ placeId: PLACE, type: 'info_change', description: '  Nouveaux horaires  ' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ placeId: PLACE, type: 'info_change', description: 'Nouveaux horaires', username: 'alice' })

    const list = await api.request<Alert[]>('GET', `/api/alerts/${enc(PLACE)}`)
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toMatchObject({ id: res.body.id, type: 'info_change', username: 'alice' })
  })

  it('masque les alertes de plus de 90 jours, les plus récentes d\'abord', async () => {
    const now = Date.now()
    await api.db.insert(api.schema.alerts).values([
      { placeId: PLACE, userId: users[0]!.id, type: 'closed', description: 'Très ancienne', createdAt: new Date(now - 91 * DAY) },
      { placeId: PLACE, userId: users[1]!.id, type: 'temporarily_closed', description: 'Récente', createdAt: new Date(now - 89 * DAY) },
      { placeId: PLACE, userId: users[2]!.id, type: 'temporarily_closed', description: 'Hier', createdAt: new Date(now - DAY) },
    ])
    const list = await api.request<Alert[]>('GET', `/api/alerts/${enc(PLACE)}`)
    expect(list.body.map(a => a.description)).toEqual(['Hier', 'Récente'])
  })

  it('GET ne renvoie ni passwordHash, ni email, ni userId', async () => {
    await post({ placeId: PLACE, type: 'closed' })
    await post({ placeId: PLACE, type: 'temporarily_closed' }, users[1]!.session)
    const list = await api.request<Alert[]>('GET', `/api/alerts/${enc(PLACE)}`)
    expect(list.body).toHaveLength(2)
    for (const alert of list.body) {
      expect(Object.keys(alert).sort()).toEqual(['createdAt', 'description', 'id', 'placeId', 'type', 'username'])
    }
    expect(list.text).not.toMatch(/hash-secret|@exemple\.fr|password/i)
  })
})

describe('alertes dogs_not_allowed et statut chien', () => {
  it('3 utilisateurs distincts : le lieu passe à refused', async () => {
    for (const [i, user] of users.entries()) {
      const res = await post({ placeId: PLACE, type: 'dogs_not_allowed' }, user.session)
      expect(res.status).toBe(200)
      expect((await getPlace(PLACE)).dogStatus).toBe(i < 2 ? 'osm_yes' : 'refused')
    }
    const row = await api.db.select().from(api.schema.places).where(eq(api.schema.places.id, PLACE)).get()
    expect(row?.dogStatus).toBe('refused')
  })

  it('3 alertes du même utilisateur ne suffisent pas', async () => {
    for (let i = 0; i < 3; i++) await post({ placeId: PLACE, type: 'dogs_not_allowed' })
    expect((await getPlace(PLACE)).dogStatus).toBe('osm_yes')
  })

  it('les alertes de plus de 90 jours ne comptent pas', async () => {
    await api.db.insert(api.schema.alerts).values([
      { placeId: PLACE, userId: users[0]!.id, type: 'dogs_not_allowed', createdAt: new Date(Date.now() - 120 * DAY) },
      { placeId: PLACE, userId: users[1]!.id, type: 'dogs_not_allowed', createdAt: new Date(Date.now() - 120 * DAY) },
    ])
    await post({ placeId: PLACE, type: 'dogs_not_allowed' }, users[2]!.session)
    expect((await getPlace(PLACE)).dogStatus).toBe('osm_yes')
  })
})
