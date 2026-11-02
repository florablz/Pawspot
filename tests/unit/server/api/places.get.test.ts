import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError, isError } from 'h3'
import overpassFixture from '../../../fixtures/overpass/paris-mixte.json'

interface FakeEvent { query: Record<string, string> }
interface PlaceResult {
  id: string
  name: string
  lat: number
  lon: number
  category: string
  dog?: string
  dogPolicy: string
  dogPolicySource?: string
  address?: string
  image?: string
}
type Handler = (event: FakeEvent) => Promise<{ places: PlaceResult[] }>

// Le handler n'utilise de l'événement que getQuery : on évite un serveur Nuxt
// complet en fournissant les auto-imports Nitro en globaux (createError/isError réels de h3).
const fetchMock = vi.fn<typeof fetch>()
let handler: Handler

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (fn: Handler) => fn)
  vi.stubGlobal('getQuery', (event: FakeEvent) => event.query)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('isError', isError)
  vi.stubGlobal('fetch', fetchMock)
  handler = (await import('../../../../server/api/places.get')).default as unknown as Handler
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  fetchMock.mockReset()
})

const PARIS = { lat: '48.8566', lon: '2.3522' }

async function callAndCatch(event: FakeEvent) {
  try {
    await handler(event)
  }
  catch (err) {
    return err as { statusCode: number, statusMessage: string }
  }
  throw new Error('le handler aurait dû lever une erreur')
}

describe('GET /api/places', () => {
  it('refuse une latitude ou longitude invalide (400) sans appeler Overpass', async () => {
    const err = await callAndCatch({ query: { lat: 'abc', lon: '2.35' } })
    expect(err.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([429, 502, 503, 504])('renvoie 503 quand Overpass répond %i (saturé)', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status }))
    const err = await callAndCatch({ query: PARIS })
    expect(err.statusCode).toBe(503)
    expect(err.statusMessage).toBe('Le service de cartes est saturé, réessayez dans quelques instants')
  })

  it('renvoie 502 pour une autre erreur amont (500)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }))
    const err = await callAndCatch({ query: PARIS })
    expect(err.statusCode).toBe(502)
    expect(err.statusMessage).toBe('Le service de cartes est indisponible')
  })

  it('renvoie 502 sans détail interne pour une erreur réseau', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('getaddrinfo ENOTFOUND overpass-api.de'))
    const err = await callAndCatch({ query: PARIS })
    expect(err.statusCode).toBe(502)
    expect(err.statusMessage).toBe('Le service de cartes est indisponible')
    expect(JSON.stringify(err)).not.toContain('ENOTFOUND')
  })

  it('renvoie 502 pour un JSON invalide', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>pas du json</html>', { status: 200 }))
    const err = await callAndCatch({ query: PARIS })
    expect(err.statusCode).toBe(502)
  })

  it('envoie la requête à Overpass avec un User-Agent identifiable et le rayon demandé', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ elements: [] }))
    await handler({ query: { ...PARIS, radius: '1500' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://overpass-api.de/api/interpreter')
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/^PawSpot\//)
    expect(String(init?.body)).toContain('around:1500,48.8566,2.3522')
  })

  it('transforme la réponse Overpass en lieux PawSpot', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(overpassFixture))
    const { places } = await handler({ query: PARIS })

    // dog=no et l'élément sans coordonnées sont exclus.
    expect(places.map(p => p.id)).toEqual(['node-1001', 'way-2002', 'node-1004', 'node-1005'])

    const flore = places[0]!
    expect(flore).toMatchObject({
      name: 'Café de Flore',
      category: 'cafe',
      dog: 'yes',
      dogPolicy: 'all_day',
      address: '172 Boulevard Saint-Germain 75006 Paris',
      image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Cafe_de_Flore.jpg?width=600',
    })

    expect(places[1]).toMatchObject({ name: 'Parc Monceau', category: 'park', lat: 48.8796, lon: 2.3095, dogPolicy: 'restricted' })
    expect(places[2]).toMatchObject({ name: 'Lieu sans nom', category: 'restaurant', dogPolicy: 'unknown', dog: undefined })
    expect(places[3]).toMatchObject({ category: 'beach', dogPolicy: 'night_only' })
  })
})
