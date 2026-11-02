import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import overpassFixture from '../../../fixtures/overpass/paris-mixte.json'
import type { Database } from '../../../../server/database'
import * as schema from '../../../../server/database/schema'
import {
  MAX_REFRESH_TILES,
  ensurePlace,
  getPlacesInBbox,
  recomputeDogStatus,
} from '../../../../server/services/places'
import type { OverpassElement, PlacesDeps } from '../../../../server/services/places'
import { PAWSPOT_USER_AGENT } from '../../../../server/utils/http'
import { tileRangeForBbox, tileRangeSize } from '../../../../shared/geo'
import type { Bbox } from '../../../../shared/geo'

const MIGRATIONS = fileURLToPath(new URL('../../../../server/database/migrations', import.meta.url))
const ENDPOINTS = ['https://overpass-1.test/api/interpreter', 'https://overpass-2.test/api/interpreter']
const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-02T10:00:00Z')
const after = (days: number) => new Date(T0.getTime() + days * DAY)

/** Centre de Paris : contient le Café de Flore (node 1001), le parc Monceau (way 2002) et le resto 1004. */
const PARIS: Bbox = { minLon: 2.30, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 }
const ELEMENTS = overpassFixture.elements as unknown as OverpassElement[]

let client: Client
let db: Database
const fetchMock = vi.fn<typeof fetch>()

function overpassOk(elements: OverpassElement[] = ELEMENTS) {
  return new Response(JSON.stringify({ version: 0.6, elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function deps(now: Date = T0, extra: Partial<PlacesDeps> = {}): PlacesDeps {
  return { db, fetch: fetchMock, now: () => now, overpassEndpoints: ENDPOINTS, overpassTimeoutMs: 1000, ...extra }
}

const ids = (list: { id: string }[]) => list.map(p => p.id).sort()

async function placeRow(id: string) {
  return db.select().from(schema.places).where(eq(schema.places.id, id)).get()
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  fetchMock.mockReset()
})

afterEach(() => {
  client.close()
})

describe('getPlacesInBbox', () => {
  it('zoom 10 : aucun appel à Overpass, zoomTooLow', async () => {
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 10 }, deps())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ places: [], stale: false, zoomTooLow: true, incomplete: false, truncated: false })
  })

  it('zoom 10 : renvoie quand même ce qui est déjà en base', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    fetchMock.mockReset()
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 10 }, deps(after(30)))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.zoomTooLow).toBe(true)
    expect(result.places).toHaveLength(3)
  })

  it('premier appel : interroge Overpass puis sert le cache au second appel', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    const first = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.stale).toBe(false)
    expect(first.zoomTooLow).toBe(false)
    expect(first.incomplete).toBe(false)
    // 1003 (bar dog=no) exclu, 1005 hors emprise (Nice), 3006 sans coordonnées.
    expect(ids(first.places)).toEqual(['osm:node:1001', 'osm:node:1004', 'osm:way:2002'])

    const second = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(6)))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ids(second.places)).toEqual(ids(first.places))
    expect(second.stale).toBe(false)
  })

  it('n\'enregistre ni le bar dog=no ni l\'élément sans coordonnées', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    expect(await placeRow('osm:node:1003')).toBeUndefined()
    expect(await placeRow('osm:relation:3006')).toBeUndefined()
    // La plage de Nice est dans la réponse Overpass : elle est mise en cache.
    expect((await placeRow('osm:node:1005'))?.dogStatus).toBe('osm_conditional')
  })

  it('envoie la requête en POST avec le User-Agent PawSpot', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(ENDPOINTS[0])
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(PAWSPOT_USER_AGENT)
    const query = new URLSearchParams(String(init?.body)).get('data')!
    expect(query).toContain('[out:json]')
    expect(query).toContain('nwr["leisure"="park"];')
    expect(query).toMatch(/\[bbox:48\.\d+,2\.\d+,48\.\d+,2\.\d+\]/)
  })

  it('rafraîchit une tuile chargée il y a plus de 7 jours', async () => {
    fetchMock.mockImplementation(async () => overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(new Date(after(7).getTime() - 60_000)))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((await placeRow('osm:node:1001'))?.fetchedAt?.getTime()).toBe(after(8).getTime())
  })

  it('se replie sur la seconde instance Overpass', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }))
      .mockResolvedValueOnce(overpassOk())
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(ENDPOINTS)
    expect(result.stale).toBe(false)
    expect(result.places).toHaveLength(3)
  })

  it('se replie aussi après une erreur réseau ou un résultat partiel', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }), { status: 200 }))
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.stale).toBe(true)
  })

  it('deux instances en échec : données en base + stale, sans exception', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())

    fetchMock.mockReset()
    fetchMock
      .mockRejectedValueOnce(new DOMException('délai', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.stale).toBe(true)
    expect(result.places).toHaveLength(3)
    // Les lieux ne sont pas marqués disparus, et la tuile reste à rafraîchir.
    expect((await placeRow('osm:way:2002'))?.status).toBe('active')
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(overpassOk())
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('base vide et Overpass en échec : liste vide + stale', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    expect(result).toMatchObject({ places: [], stale: true, zoomTooLow: false })
  })

  it('plus de 64 tuiles couvrant l\'emprise : zoomTooLow, même à zoom 13', async () => {
    const big: Bbox = { minLon: 2.0, minLat: 48.5, maxLon: 3.0, maxLat: 49.2 }
    expect(tileRangeSize(tileRangeForBbox(big))).toBeGreaterThan(64)
    const result = await getPlacesInBbox({ bbox: big, zoom: 13 }, deps())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.zoomTooLow).toBe(true)
  })

  it('plus de 16 tuiles à rafraîchir : une seule requête, incomplete, puis complétée', async () => {
    // 6 × 6 tuiles z12 autour de Paris (≤ 64).
    const bbox: Bbox = { minLon: 2.10, minLat: 48.70, maxLon: 2.55, maxLat: 49.00 }
    const size = tileRangeSize(tileRangeForBbox(bbox))
    expect(size).toBeGreaterThan(MAX_REFRESH_TILES)
    expect(size).toBeLessThanOrEqual(64)
    fetchMock.mockImplementation(async () => overpassOk())

    const first = await getPlacesInBbox({ bbox, zoom: 12 }, deps())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.incomplete).toBe(true)
    const tiles = await db.select().from(schema.fetchedTiles)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThanOrEqual(MAX_REFRESH_TILES)

    let calls = 1
    let result = first
    while (result.incomplete && calls < 10) {
      result = await getPlacesInBbox({ bbox, zoom: 12 }, deps())
      calls++
    }
    expect(result.incomplete).toBe(false)
    expect(await db.$count(schema.fetchedTiles)).toBe(size)
    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })

  it('un lieu disparu d\'OSM passe en « removed », puis redevient actif s\'il réapparaît', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())

    fetchMock.mockResolvedValueOnce(overpassOk(ELEMENTS.filter(e => e.id !== 2002)))
    const without = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    expect(ids(without.places)).toEqual(['osm:node:1001', 'osm:node:1004'])
    expect((await placeRow('osm:way:2002'))?.status).toBe('removed')
    // Hors de l'emprise interrogée : la plage de Nice n'est pas touchée.
    expect((await placeRow('osm:node:1005'))?.status).toBe('active')

    fetchMock.mockResolvedValueOnce(overpassOk())
    const back = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(16)))
    expect(ids(back.places)).toContain('osm:way:2002')
    expect((await placeRow('osm:way:2002'))?.status).toBe('active')
  })

  it('un lieu devenu dog=no passe en « removed »', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    const changed = ELEMENTS.map(e => e.id === 1004 ? { ...e, tags: { ...e.tags, dog: 'no' } } : e)
    fetchMock.mockResolvedValueOnce(overpassOk(changed))
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    expect((await placeRow('osm:node:1004'))?.status).toBe('removed')
  })

  it('filtre website avant de l\'enregistrer', async () => {
    const elements: OverpassElement[] = [
      { type: 'node', id: 11, lat: 48.86, lon: 2.32, tags: { leisure: 'park', name: 'A', website: 'javascript:alert(1)' } },
      { type: 'node', id: 12, lat: 48.86, lon: 2.33, tags: { leisure: 'park', name: 'B', website: 'www.parc-b.fr' } },
      { type: 'node', id: 13, lat: 48.86, lon: 2.34, tags: { 'leisure': 'park', 'name': 'C', 'contact:website': 'https://c.fr;https://autre.fr' } },
    ]
    fetchMock.mockResolvedValueOnce(overpassOk(elements))
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    expect((await placeRow('osm:node:11'))?.website).toBeNull()
    expect((await placeRow('osm:node:12'))?.website).toBe('https://www.parc-b.fr/')
    expect((await placeRow('osm:node:13'))?.website).toBe('https://c.fr/')
    expect(result.places.find(p => p.id === 'osm:node:11')).not.toHaveProperty('website')
  })

  it('stocke dog_status, la terrasse, les tags utiles et l\'adresse', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    const flore = await placeRow('osm:node:1001')
    expect(flore).toMatchObject({
      dogStatus: 'osm_yes',
      osmDogPolicy: 'all_day',
      hasTerrace: true,
      name: 'Café de Flore',
      nameNormalized: 'cafe de flore',
      address: '172 Boulevard Saint-Germain, 75006 Paris',
      image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Cafe_de_Flore.jpg?width=600',
      source: 'osm',
      category: 'cafe',
    })
    expect(flore?.dogStatusInfo?.source).toBe('osm')
    expect((await placeRow('osm:node:1004'))?.dogStatus).toBe('likely_terrace')
    expect((await placeRow('osm:way:2002'))).toMatchObject({ dogStatus: 'osm_conditional', osmDogPolicy: 'restricted', lat: 48.8796, lon: 2.3095 })

    const resto = result.places.find(p => p.id === 'osm:node:1004')!
    expect(resto).toMatchObject({ name: 'Restaurant', hasName: false, dogStatus: 'likely_terrace', dogStatusSource: 'terrasse' })
  })
})

describe('ensurePlace', () => {
  const FLORE = ELEMENTS.find(e => e.id === 1001)!

  it('id OSM absent de la base : lu sur Overpass puis mis en cache', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk([FLORE]))
    const place = await ensurePlace('osm:node:1001', deps())
    expect(place).toMatchObject({ id: 'osm:node:1001', name: 'Café de Flore', dogStatus: 'osm_yes' })
    const query = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)).get('data')!
    expect(query).toContain('node(1001)')

    fetchMock.mockReset()
    expect(await ensurePlace('osm:node:1001', deps())).toMatchObject({ id: 'osm:node:1001' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('id user: inconnu → null, sans appel réseau', async () => {
    expect(await ensurePlace('user:inconnu', deps())).toBeNull()
    expect(await ensurePlace('pas-un-id', deps())).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('élément introuvable ou non éligible → null', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk([]))
    expect(await ensurePlace('osm:node:999', deps())).toBeNull()
    fetchMock.mockResolvedValueOnce(overpassOk([ELEMENTS.find(e => e.id === 1003)!]))
    expect(await ensurePlace('osm:node:1003', deps())).toBeNull()
    expect(await placeRow('osm:node:1003')).toBeUndefined()
  })

  it('Overpass injoignable → OverpassError', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 504 }))
    await expect(ensurePlace('osm:node:1001', deps())).rejects.toMatchObject({ name: 'OverpassError' })
  })
})

describe('recomputeDogStatus', () => {
  async function seedUsers(n: number) {
    const rows = Array.from({ length: n }, (_, i) => ({ email: `u${i}@exemple.fr`, username: `u${i}`, passwordHash: 'x' }))
    return db.insert(schema.users).values(rows).returning({ id: schema.users.id })
  }

  it('3 alertes dogs_not_allowed d\'utilisateurs distincts → refused, enregistré en base', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    const users = await seedUsers(3)
    await db.insert(schema.alerts).values(users.map(u => ({ placeId: 'osm:node:1001', userId: u.id, type: 'dogs_not_allowed', createdAt: after(1) })))

    const result = await recomputeDogStatus('osm:node:1001', deps(after(2)))
    expect(result?.status).toBe('refused')
    expect(result?.info).toMatchObject({ source: 'alerts', dogsNotAllowedAlerts: 3 })
    expect(await placeRow('osm:node:1001')).toMatchObject({ dogStatus: 'refused' })
  })

  it('2 utilisateurs distincts (dont un qui signale deux fois) → statut OSM conservé', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    const [a, b] = await seedUsers(2)
    await db.insert(schema.alerts).values([a!, a!, b!].map(u => ({ placeId: 'osm:node:1001', userId: u.id, type: 'dogs_not_allowed', createdAt: after(1) })))
    expect((await recomputeDogStatus('osm:node:1001', deps(after(2))))?.status).toBe('osm_yes')
  })

  it('les alertes sont aussi prises en compte au rafraîchissement suivant', async () => {
    fetchMock.mockImplementation(async () => overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    const users = await seedUsers(3)
    await db.insert(schema.alerts).values(users.map(u => ({ placeId: 'osm:node:1001', userId: u.id, type: 'dogs_not_allowed', createdAt: after(1) })))
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    expect((await placeRow('osm:node:1001'))?.dogStatus).toBe('refused')
  })

  it('lieu inexistant → null', async () => {
    expect(await recomputeDogStatus('osm:node:424242', deps())).toBeNull()
  })
})
