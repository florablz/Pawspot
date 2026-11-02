import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import overpassFixture from '../../../fixtures/overpass/paris-mixte.json'
import type { PlacesResponse } from '../../../../shared/types'
import { fetchMock, overpassDown, overpassResponse, setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }

let api: ApiBench
const PARIS = 'bbox=2.30,48.85,2.35,48.88'

beforeAll(async () => {
  api = await setupApi()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  fetchMock.mockReset()
  await api.db.delete(api.schema.fetchedTiles)
})

describe('GET /api/places — validation', () => {
  it.each([
    ['sans bbox', 'zoom=14', 'Emprise (bbox) requise'],
    ['bbox illisible', 'bbox=abc&zoom=14', 'Emprise invalide : attendu minLon,minLat,maxLon,maxLat'],
    ['bbox à trois valeurs', 'bbox=2.3,48.8,2.4&zoom=14', 'Emprise invalide : attendu minLon,minLat,maxLon,maxLat'],
    ['latitude hors bornes', 'bbox=2.3,48.8,2.4,95&zoom=14', 'Emprise invalide : attendu minLon,minLat,maxLon,maxLat'],
    ['zoom non numérique', `${PARIS}&zoom=abc`, 'Zoom invalide'],
    ['zoom décimal', `${PARIS}&zoom=12.5`, 'Le zoom doit être un entier'],
    ['zoom trop grand', `${PARIS}&zoom=30`, 'Zoom invalide'],
  ])('refuse une requête %s (400, message en français) sans appeler Overpass', async (_label, query, message) => {
    const res = await api.request<ApiErrorBody>('GET', `/api/places?${query}`)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, message })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/places — réponses', () => {
  it('zoom < 11 : zoomTooLow, sans appel à Overpass', async () => {
    const res = await api.request<PlacesResponse>('GET', `/api/places?${PARIS}&zoom=10`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ stale: false, zoomTooLow: true, incomplete: false, truncated: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('zoom 14 : interroge Overpass et renvoie une PlacesResponse complète', async () => {
    fetchMock.mockResolvedValue(overpassResponse(overpassFixture.elements))
    const res = await api.request<PlacesResponse>('GET', `/api/places?${PARIS}&zoom=14`)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(res.body).sort()).toEqual(['incomplete', 'places', 'stale', 'truncated', 'zoomTooLow'])
    expect(res.body).toMatchObject({ stale: false, zoomTooLow: false, incomplete: false, truncated: false })

    // dog=no exclu, plage de Nice hors emprise.
    expect(res.body.places.map(p => p.id).sort()).toEqual(['osm:node:1001', 'osm:node:1004', 'osm:way:2002'])
    const flore = res.body.places.find(p => p.id === 'osm:node:1001')!
    expect(flore).toMatchObject({
      source: 'osm',
      name: 'Café de Flore',
      hasName: true,
      category: 'cafe',
      dogStatus: 'osm_yes',
      osmDogPolicy: 'all_day',
      hasTerrace: true,
      status: 'active',
      verified: true,
      address: '172 Boulevard Saint-Germain, 75006 Paris',
    })
    expect(typeof flore.updatedAt).toBe('string')
  })

  it('Overpass en panne : 200 avec les données en base et stale: true', async () => {
    // Le cache contient déjà les lieux (test précédent) ; on vide les tuiles pour forcer un rafraîchissement.
    overpassDown()
    const res = await api.request<PlacesResponse>('GET', `/api/places?${PARIS}&zoom=14`)
    expect(res.status).toBe(200)
    expect(res.body.stale).toBe(true)
    expect(res.body.zoomTooLow).toBe(false)
    expect(res.body.places.length).toBeGreaterThan(0)
    expect(res.text).not.toMatch(/overpass|HTTP 504/i)
  })

  it('Overpass en erreur réseau : stale: true, jamais de 500', async () => {
    fetchMock.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND overpass-api.de'))
    const res = await api.request<PlacesResponse>('GET', `/api/places?${PARIS}&zoom=14`)
    expect(res.status).toBe(200)
    expect(res.body.stale).toBe(true)
    expect(res.text).not.toContain('ENOTFOUND')
  })
})
