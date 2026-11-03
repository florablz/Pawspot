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
  ELEMENT_DEADLINE_MS,
  OSM_MISS_TTL_MS,
  MAX_REFRESH_TILES,
  OVERPASS_CIRCUIT_PAUSE_MS,
  OverpassCircuit,
  OverpassError,
  REFRESH_DEADLINE_CACHED_MS,
  REFRESH_DEADLINE_EMPTY_MS,
  defaultOverpassCircuit,
  ensurePlace,
  getPlaceById,
  getPlacesInBbox,
  isRecentOsmMiss,
  recomputeDogStatus,
  recordOsmMiss,
  resetOverpassCircuit,
} from '../../../../server/services/places'
import type { OverpassElement, PlacesDeps } from '../../../../server/services/places'
import { PAWSPOT_USER_AGENT } from '../../../../server/utils/http'
import { TERRACE_SOURCE_TEXT } from '../../../../shared/dogStatus'
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
/** Disjoncteur neuf à chaque test (celui du processus garderait les pauses d'un test à l'autre). */
let circuit: OverpassCircuit
const fetchMock = vi.fn<typeof fetch>()

function overpassOk(elements: OverpassElement[] = ELEMENTS) {
  return new Response(JSON.stringify({ version: 0.6, elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function deps(now: Date = T0, extra: Partial<PlacesDeps> = {}): PlacesDeps {
  return { db, fetch: fetchMock, now: () => now, overpassEndpoints: ENDPOINTS, overpassTimeoutMs: 1000, overpassCircuit: circuit, ...extra }
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
  circuit = new OverpassCircuit()
  resetOverpassCircuit()
})

afterEach(() => {
  vi.useRealTimers()
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
    vi.useFakeTimers({ toFake: ['Date'], now: T0 })
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
    // Juste après : les deux instances sont en pause, le cache est servi en stale sans appel.
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    // Fin de la pause : la tuile, restée périmée, est rafraîchie.
    vi.advanceTimersByTime(OVERPASS_CIRCUIT_PAUSE_MS)
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
    expect(resto).toMatchObject({ name: 'Restaurant', hasName: false, dogStatus: 'likely_terrace', dogStatusSource: TERRACE_SOURCE_TEXT })
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

describe('getPlacesInBbox — territoires couverts', () => {
  /** Manhattan : hors de toute zone couverte. */
  const NEW_YORK: Bbox = { minLon: -74.01, minLat: 40.70, maxLon: -73.98, maxLat: 40.72 }
  /** Genève et la frontière française. */
  const GENEVE: Bbox = { minLon: 6.10, minLat: 46.18, maxLon: 6.16, maxLat: 46.22 }
  const MATA_UTU: Bbox = { minLon: -176.19, minLat: -13.29, maxLon: -176.16, maxLat: -13.27 }
  const PAPEETE: Bbox = { minLon: -149.58, minLat: -17.56, maxLon: -149.54, maxLat: -17.53 }

  it('emprise hors couverture (zoom 14) : aucun appel Overpass, outsideCoverage', async () => {
    const result = await getPlacesInBbox({ bbox: NEW_YORK, zoom: 14 }, deps())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ places: [], stale: false, zoomTooLow: false, incomplete: false, truncated: false, outsideCoverage: true })
    expect(await db.$count(schema.fetchedTiles)).toBe(0)
  })

  it('emprise hors couverture à zoom bas : aucun appel, zoomTooLow et outsideCoverage', async () => {
    const result = await getPlacesInBbox({ bbox: NEW_YORK, zoom: 9 }, deps())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ zoomTooLow: true, outsideCoverage: true, stale: false })
  })

  it('emprise hors couverture : les lieux déjà en base sont quand même servis', async () => {
    await db.insert(schema.places).values({ id: 'osm:node:7001', source: 'osm', name: 'Café new-yorkais', lat: 40.71, lon: -74.0, category: 'cafe', verified: true })
    const result = await getPlacesInBbox({ bbox: NEW_YORK, zoom: 15 }, deps())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ids(result.places)).toEqual(['osm:node:7001'])
    expect(result.outsideCoverage).toBe(true)
  })

  it('emprise qui chevauche la frontière (Genève) : Overpass interrogé, pas de outsideCoverage', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk([]))
    const result = await getPlacesInBbox({ bbox: GENEVE, zoom: 14 }, deps())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).not.toHaveProperty('outsideCoverage')
  })

  it.each([['Wallis (près de l\'antiméridien)', MATA_UTU], ['Papeete (Polynésie)', PAPEETE]])('%s : Overpass interrogé', async (_name, bbox) => {
    fetchMock.mockResolvedValueOnce(overpassOk([]))
    const result = await getPlacesInBbox({ bbox, zoom: 15 }, deps())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.stale).toBe(false)
    expect(result).not.toHaveProperty('outsideCoverage')
  })

  it('emprise en France : le champ outsideCoverage est absent', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    expect(await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())).not.toHaveProperty('outsideCoverage')
  })
})

describe('ensurePlace — ids introuvables mémorisés 24 h', () => {
  const FLORE = ELEMENTS.find(e => e.id === 1001)!
  /** Café à New York, hors couverture. */
  const NY_CAFE: OverpassElement = { type: 'node', id: 7002, lat: 40.7128, lon: -74.006, tags: { amenity: 'cafe', name: 'Joe\'s', dog: 'yes' } }
  const misses = () => db.select().from(schema.osmLookupMisses)

  it('deux appels pour un id introuvable : un seul fetch', async () => {
    fetchMock.mockResolvedValue(overpassOk([]))
    expect(await ensurePlace('osm:node:999', deps())).toBeNull()
    expect(await ensurePlace('osm:node:999', deps(new Date(T0.getTime() + 60_000)))).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await misses()).toEqual([{ id: 'osm:node:999', checkedAt: T0 }])
  })

  it('juste avant 24 h : toujours pas de fetch ; après 24 h : Overpass est rappelé', async () => {
    fetchMock.mockResolvedValue(overpassOk([]))
    await ensurePlace('osm:node:999', deps())
    expect(await ensurePlace('osm:node:999', deps(new Date(T0.getTime() + OSM_MISS_TTL_MS - 1000)))).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValue(overpassOk([{ ...FLORE, id: 999 }]))
    const place = await ensurePlace('osm:node:999', deps(new Date(T0.getTime() + OSM_MISS_TTL_MS + 1000)))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(place).toMatchObject({ id: 'osm:node:999', name: 'Café de Flore' })
  })

  it('élément non éligible (bar dog=no) : mémorisé aussi', async () => {
    fetchMock.mockResolvedValue(overpassOk([ELEMENTS.find(e => e.id === 1003)!]))
    expect(await ensurePlace('osm:node:1003', deps())).toBeNull()
    expect(await ensurePlace('osm:node:1003', deps())).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('élément hors couverture : ni mis en cache, ni redemandé', async () => {
    fetchMock.mockResolvedValue(overpassOk([NY_CAFE]))
    expect(await ensurePlace('osm:node:7002', deps())).toBeNull()
    expect(await placeRow('osm:node:7002')).toBeUndefined()
    expect(await isRecentOsmMiss('osm:node:7002', deps())).toBe(true)
    expect(await ensurePlace('osm:node:7002', deps())).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('élément renvoyé pour un autre id : ignoré, l\'id demandé est mémorisé introuvable', async () => {
    fetchMock.mockResolvedValue(overpassOk([FLORE]))
    expect(await ensurePlace('osm:way:1001', deps())).toBeNull()
    expect(await placeRow('osm:node:1001')).toBeUndefined()
    expect(await isRecentOsmMiss('osm:way:1001', deps())).toBe(true)
  })

  it('échec Overpass puis succès : l\'échec n\'est pas mémorisé', async () => {
    const noPause = deps(T0, { overpassCircuitPauseMs: 0 })
    fetchMock.mockResolvedValue(new Response('', { status: 504 }))
    await expect(ensurePlace('osm:node:1001', noPause)).rejects.toBeInstanceOf(OverpassError)
    expect(await misses()).toEqual([])

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk([FLORE]))
    expect(await ensurePlace('osm:node:1001', noPause)).toMatchObject({ id: 'osm:node:1001' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('résultat partiel (runtime error) : pas mémorisé non plus', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }), { status: 200 }))
    await expect(ensurePlace('osm:node:1001', deps())).rejects.toBeInstanceOf(OverpassError)
    expect(await misses()).toEqual([])
  })

  it('allowOverpass: false : null sans fetch pour un id absent, et rien de mémorisé', async () => {
    expect(await ensurePlace('osm:node:1001', deps(), { allowOverpass: false })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await misses()).toEqual([])
  })

  it('allowOverpass: false : un id présent en base est renvoyé', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk([FLORE]))
    await ensurePlace('osm:node:1001', deps())
    fetchMock.mockReset()
    expect(await ensurePlace('osm:node:1001', deps(), { allowOverpass: false })).toMatchObject({ id: 'osm:node:1001', name: 'Café de Flore' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un id présent en base est renvoyé même s\'il a été mémorisé introuvable', async () => {
    await recordOsmMiss('osm:node:1001', deps())
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    fetchMock.mockReset()
    expect(await ensurePlace('osm:node:1001', deps())).toMatchObject({ id: 'osm:node:1001' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recordOsmMiss purge les entrées de plus de 24 h et met à jour la date d\'un id déjà mémorisé', async () => {
    await recordOsmMiss('osm:node:1', deps())
    await recordOsmMiss('osm:node:2', deps(after(0.5)))
    await recordOsmMiss('osm:node:2', deps(after(2)))
    expect(await misses()).toEqual([{ id: 'osm:node:2', checkedAt: after(2) }])
    expect(await isRecentOsmMiss('osm:node:1', deps(after(2)))).toBe(false)
    expect(await isRecentOsmMiss('osm:node:2', deps(after(2)))).toBe(true)
  })
})

describe('lecture d\'une ligne ancienne (rowToPlace)', () => {
  it('une image http: restée en base n\'est pas renvoyée', async () => {
    await db.insert(schema.places).values({ id: 'osm:node:8001', source: 'osm', name: 'Vieux café', lat: 48.86, lon: 2.34, category: 'cafe', verified: true, image: 'http://exemple.fr/photo.jpg' })
    await db.insert(schema.places).values({ id: 'osm:node:8002', source: 'osm', name: 'Café récent', lat: 48.86, lon: 2.341, category: 'cafe', verified: true, image: 'https://exemple.fr/photo.jpg' })
    const old = await getPlaceById('osm:node:8001', deps())
    expect(old).not.toHaveProperty('image')
    expect((await getPlaceById('osm:node:8002', deps()))?.image).toBe('https://exemple.fr/photo.jpg')
    const { places } = await getPlacesInBbox({ bbox: PARIS, zoom: 10 }, deps())
    expect(places.find(p => p.id === 'osm:node:8001')).not.toHaveProperty('image')
  })

  it('osmDetail figé en base (ancien texte avec syntaxe OSM) : régénéré depuis les tags', async () => {
    await db.insert(schema.places).values({
      id: 'osm:way:8003', source: 'osm', name: 'Parc ancien', lat: 48.86, lon: 2.34, category: 'park', verified: true,
      tags: { 'leisure': 'park', 'dog:conditional': 'yes @ (19:00-08:00)' },
      dogStatus: 'osm_conditional', osmDogPolicy: 'night_only',
      dogStatusInfo: { source: 'osm', reports: { total: 0, accepted: 0, refused: 0, inside: 0, recent: 0 }, osmDetail: 'Uniquement la nuit (yes @ (19:00-08:00))' },
    })
    const place = await getPlaceById('osm:way:8003', deps())
    expect(place?.dogStatusInfo.osmDetail).toBe('Chiens acceptés de 19 h à 8 h seulement')
    expect(place?.osmDogDetail).toBe('Chiens acceptés de 19 h à 8 h seulement')
    expect(JSON.stringify(place)).not.toContain('@')
  })

  it('osmDetail figé mais tags sans condition : le détail disparaît', async () => {
    await db.insert(schema.places).values({
      id: 'osm:node:8004', source: 'osm', name: 'Café', lat: 48.86, lon: 2.34, category: 'cafe', verified: true,
      tags: { amenity: 'cafe', dog: 'yes' },
      dogStatusInfo: { source: 'osm', reports: { total: 0, accepted: 0, refused: 0, inside: 0, recent: 0 }, osmDetail: 'yes @ ancien' },
    })
    const place = await getPlaceById('osm:node:8004', deps())
    expect(place?.dogStatusInfo).not.toHaveProperty('osmDetail')
    expect(place).not.toHaveProperty('osmDogDetail')
  })
})

describe('disjoncteur Overpass', () => {
  /** Emprise jamais chargée, loin de Paris (Lyon). */
  const LYON: Bbox = { minLon: 4.83, minLat: 45.75, maxLon: 4.86, maxLat: 45.77 }
  const FLORE = ELEMENTS.find(e => e.id === 1001)!
  const partial = () => new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query run out of memory' }), { status: 200 })
  /** `fetch` qui ne répond jamais et ignore le signal d'annulation. */
  const neverAnswers = () => new Promise<Response>(() => {})

  /** Lance l'appel et indique s'il s'est terminé (pour les faux minuteurs). */
  function track<T>(promise: Promise<T>) {
    const state = { settled: false, promise }
    promise.then(() => (state.settled = true), () => (state.settled = true))
    return state
  }

  async function seedParis() {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps())
    fetchMock.mockReset()
  }

  it('après un échec des deux instances, l\'appel suivant renvoie stale sans appeler fetch', async () => {
    await seedParis()
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    const result = await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.stale).toBe(true)
    expect(result.places).toHaveLength(3)
  })

  it('la pause dure 2 minutes, puis Overpass est de nouveau interrogé', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 })
    await seedParis()
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk())

    vi.advanceTimersByTime(OVERPASS_CIRCUIT_PAUSE_MS - 1000)
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('un délai dépassé sur une emprise en cache n\'empêche pas un essai plus long, et un succès referme la pause', async () => {
    await seedParis()
    // Emprise en cache (10 s, 5 s par instance) : les deux instances expirent.
    fetchMock.mockRejectedValue(new DOMException('délai', 'TimeoutError'))
    const slow = deps(after(8), { overpassTimeoutMs: 30_000 })
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, slow)).stale).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Emprise vide (25 s, 12,5 s par instance) : essai plus long permis, l'instance principale répond.
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk([]))
    expect((await getPlacesInBbox({ bbox: LYON, zoom: 14 }, slow)).stale).toBe(false)
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([ENDPOINTS[0]])

    // Pause refermée sur l'instance principale : l'emprise en cache est de nouveau rafraîchie.
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk())
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, slow)).stale).toBe(false)
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([ENDPOINTS[0]])
  })

  it('un résultat partiel (runtime error) ne met pas l\'instance en pause', async () => {
    await seedParis()
    fetchMock.mockImplementation(async () => partial())
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk())
    expect((await getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8)))).stale).toBe(false)
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([ENDPOINTS[0]])
  })

  it('tuiles déjà chargées : délai total de 10 s, puis le cache en stale', async () => {
    await seedParis()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 })
    fetchMock.mockImplementation(neverAnswers)
    const call = track(getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(after(8), { overpassTimeoutMs: 60_000 })))

    await vi.advanceTimersByTimeAsync(REFRESH_DEADLINE_CACHED_MS - 1)
    expect(call.settled).toBe(false)
    // 5 s par instance : la seconde a été essayée.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(call.settled).toBe(true)
    const result = await call.promise
    expect(result.stale).toBe(true)
    expect(result.places).toHaveLength(3)
  })

  it('tuile jamais chargée : délai total de 25 s, puis liste vide en stale', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 })
    fetchMock.mockImplementation(neverAnswers)
    const call = track(getPlacesInBbox({ bbox: PARIS, zoom: 14 }, deps(T0, { overpassTimeoutMs: 60_000 })))

    await vi.advanceTimersByTimeAsync(REFRESH_DEADLINE_CACHED_MS)
    expect(call.settled).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(REFRESH_DEADLINE_EMPTY_MS - REFRESH_DEADLINE_CACHED_MS - 1)
    expect(call.settled).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(call.settled).toBe(true)
    expect(await call.promise).toMatchObject({ places: [], stale: true })
    expect(await db.$count(schema.fetchedTiles)).toBe(0)
  })

  it('ensurePlace : délai total de 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 })
    fetchMock.mockImplementation(neverAnswers)
    const call = track(ensurePlace('osm:node:1001', deps(T0, { overpassTimeoutMs: 60_000 })))
    call.promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(ELEMENT_DEADLINE_MS - 1)
    expect(call.settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(call.promise).rejects.toBeInstanceOf(OverpassError)
  })

  it('ensurePlace avec les deux instances en pause : OverpassError immédiate, sans fetch', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 504 }))
    await expect(ensurePlace('osm:node:1001', deps())).rejects.toBeInstanceOf(OverpassError)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk([FLORE]))
    const error = await ensurePlace('osm:node:1001', deps()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OverpassError)
    expect((error as OverpassError).attempts).toEqual([
      'overpass-1.test: en pause après un échec récent',
      'overpass-2.test: en pause après un échec récent',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HTTP 400 (requête refusée) ne met pas l\'instance en pause', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 400 }))
    await expect(ensurePlace('osm:node:1001', deps())).rejects.toBeInstanceOf(OverpassError)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk([FLORE]))
    expect(await ensurePlace('osm:node:1001', deps())).toMatchObject({ id: 'osm:node:1001' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('overpassCircuitPauseMs: 0 désactive le disjoncteur', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 504 }))
    const noPause = deps(T0, { overpassCircuitPauseMs: 0 })
    await expect(ensurePlace('osm:node:1001', noPause)).rejects.toBeInstanceOf(OverpassError)
    await expect(ensurePlace('osm:node:1001', noPause)).rejects.toBeInstanceOf(OverpassError)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('sans disjoncteur injecté, celui du processus est utilisé et resetOverpassCircuit l\'oublie', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 504 }))
    const shared = deps(T0, { overpassCircuit: undefined })
    await expect(ensurePlace('osm:node:1001', shared)).rejects.toBeInstanceOf(OverpassError)
    expect(defaultOverpassCircuit.isOpen(ENDPOINTS[0]!, 1000, Date.now())).toBe(true)
    expect(circuit.isOpen(ENDPOINTS[0]!, 1000, Date.now())).toBe(false)

    resetOverpassCircuit()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(overpassOk([FLORE]))
    expect(await ensurePlace('osm:node:1001', shared)).toMatchObject({ id: 'osm:node:1001' })
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
