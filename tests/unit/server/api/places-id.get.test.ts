import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import overpassFixture from '../../../fixtures/overpass/paris-mixte.json'
import type { Place } from '../../../../shared/types'
import { fetchMock, overpassDown, overpassResponse, setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }

let api: ApiBench
const url = (id: string) => `/api/places/${encodeURIComponent(id)}`

beforeAll(async () => {
  api = await setupApi()
  await api.insertPlace({ id: 'user:demo-1', name: 'Parc à chiens démo', category: 'dog_park', verified: false })
  await api.insertPlace({ id: 'osm:node:42', name: 'Café caché', status: 'hidden' })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  fetchMock.mockReset()
})

describe('GET /api/places/:id', () => {
  it('lit un id encodé (user%3Ademo-1) depuis la base, sans appeler Overpass', async () => {
    const res = await api.request<Place>('GET', '/api/places/user%3Ademo-1')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'user:demo-1', source: 'user', name: 'Parc à chiens démo', category: 'dog_park', status: 'active' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['n\'importe quoi', 'node-1001', 'osm:node:0', 'osm:point:1'])('refuse un id invalide « %s » (400)', async (id) => {
    const res = await api.request<ApiErrorBody>('GET', url(id))
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, message: 'Identifiant de lieu invalide' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lieu communautaire inconnu : 404 sans appeler Overpass', async () => {
    const res = await api.request<ApiErrorBody>('GET', url('user:inconnu'))
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ statusCode: 404, message: 'Lieu introuvable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lieu masqué par la modération : 404', async () => {
    const res = await api.request<ApiErrorBody>('GET', url('osm:node:42'))
    expect(res.status).toBe(404)
  })

  it('lieu OSM absent de la base mais inexistant sur Overpass : 404', async () => {
    fetchMock.mockResolvedValue(overpassResponse([]))
    const res = await api.request<ApiErrorBody>('GET', url('osm:node:999999'))
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Lieu introuvable')
  })

  it('lieu OSM absent de la base : lu sur Overpass puis servi depuis le cache', async () => {
    const flore = overpassFixture.elements.find(e => e.id === 1001)!
    fetchMock.mockResolvedValue(overpassResponse([flore]))
    const first = await api.request<Place>('GET', url('osm:node:1001'))
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ id: 'osm:node:1001', name: 'Café de Flore', dogStatus: 'osm_yes' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await api.request<Place>('GET', url('osm:node:1001'))
    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Overpass injoignable (OverpassError) : 503 avec un message français sans détail interne', async () => {
    overpassDown()
    const res = await api.request<ApiErrorBody>('GET', url('osm:way:777'))
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({
      statusCode: 503,
      message: 'Le service des lieux est momentanément indisponible, réessaie dans quelques instants',
    })
    expect(res.text).not.toMatch(/HTTP 504|overpass-api|kumi/i)
  })
})
