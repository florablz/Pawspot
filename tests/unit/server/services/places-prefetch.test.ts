/**
 * Fonctions du service des lieux utilisées par le pré-remplissage
 * (scripts/places-prefetch.ts) : splitIntoRefreshRanges (pure), planTileRefresh
 * et refreshTileRange (base libSQL en mémoire, Overpass simulé par la fixture).
 */
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
  OVERPASS_SERVER_TIMEOUT_S,
  OverpassCircuit,
  OverpassError,
  TILE_TTL_MS,
  planTileRefresh,
  refreshTileRange,
  splitIntoRefreshRanges,
} from '../../../../server/services/places'
import type { OverpassElement, PlacesDeps } from '../../../../server/services/places'
import { CACHE_TILE_ZOOM, tileKey, tileRangeForBbox, tileRangeSize, tileToBbox, tilesInRange } from '../../../../shared/geo'
import type { Bbox, Tile, TileRange } from '../../../../shared/geo'

const MIGRATIONS = fileURLToPath(new URL('../../../../server/database/migrations', import.meta.url))
const ENDPOINTS = ['https://overpass-1.test/api/interpreter', 'https://overpass-2.test/api/interpreter']
const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-02T10:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const PARIS: Bbox = { minLon: 2.30, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 }
const ELEMENTS = overpassFixture.elements as unknown as OverpassElement[]

let client: Client
let db: Database
let circuit: OverpassCircuit
const fetchMock = vi.fn<typeof fetch>()

const overpassOk = (elements: OverpassElement[] = ELEMENTS) =>
  new Response(JSON.stringify({ version: 0.6, elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })

function deps(now: Date = T0, extra: Partial<PlacesDeps> = {}): PlacesDeps {
  return { db, fetch: fetchMock, now: () => now, overpassEndpoints: ENDPOINTS, overpassTimeoutMs: 1000, overpassCircuit: circuit, ...extra }
}

const sentTimeout = (i: number) => {
  const body = new URLSearchParams(String(fetchMock.mock.calls[i]![1]!.body))
  return Number(/\[timeout:(\d+)\]/.exec(body.get('data') ?? '')?.[1])
}

async function markTile(t: Tile, fetchedAt: Date) {
  await db.insert(schema.fetchedTiles).values({ ...t, fetchedAt })
}

const keys = (tiles: readonly Tile[]) => tiles.map(tileKey).sort()

beforeEach(async () => {
  client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  fetchMock.mockReset()
  circuit = new OverpassCircuit()
})

afterEach(() => {
  client.close()
})

// ---------------------------------------------------------------------------

/** Rectangle de tuiles z12 autour de Paris (origine 2074, 1408). */
const Z = CACHE_TILE_ZOOM
const grid = (w: number, h: number, x0 = 2074, y0 = 1408): Tile[] =>
  tilesInRange({ z: Z, minX: x0, maxX: x0 + w - 1, minY: y0, maxY: y0 + h - 1 })
const centerOf = (tiles: readonly Tile[]) => {
  const xs = tiles.map(t => t.x)
  const ys = tiles.map(t => t.y)
  const b = tileToBbox({ z: Z, x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) })
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 }
}

/** Chaque tuile dans exactement un rectangle, aucune hors liste, aucun rectangle > max. */
function expectPartition(tiles: readonly Tile[], ranges: readonly TileRange[], max: number) {
  const wanted = new Set(tiles.map(tileKey))
  const seen = new Map<string, number>()
  for (const r of ranges) {
    expect(tileRangeSize(r)).toBeLessThanOrEqual(max)
    for (const t of tilesInRange(r)) {
      expect(wanted.has(tileKey(t)), `tuile ${tileKey(t)} hors liste`).toBe(true)
      seen.set(tileKey(t), (seen.get(tileKey(t)) ?? 0) + 1)
    }
  }
  expect([...seen.keys()].sort()).toEqual([...wanted].sort())
  expect([...seen.values()].every(n => n === 1)).toBe(true)
}

describe('splitIntoRefreshRanges', () => {
  it('liste vide → []', () => {
    expect(splitIntoRefreshRanges([], { lat: 48.85, lon: 2.35 })).toEqual([])
  })

  it('grille 3×3 avec max 4 → 3 rectangles qui la partagent exactement', () => {
    const tiles = grid(3, 3)
    const ranges = splitIntoRefreshRanges(tiles, centerOf(tiles), 4)
    expect(ranges).toHaveLength(3)
    expectPartition(tiles, ranges, 4)
  })

  it('max par défaut : MAX_REFRESH_TILES (8)', () => {
    const tiles = grid(4, 4)
    const ranges = splitIntoRefreshRanges(tiles, centerOf(tiles))
    expectPartition(tiles, ranges, MAX_REFRESH_TILES)
    expect(MAX_REFRESH_TILES).toBe(8)
  })

  it.each([0, -3, 0.5])('max %s → ramené à 1 (une tuile par rectangle)', (max) => {
    const tiles = grid(2, 2)
    const ranges = splitIntoRefreshRanges(tiles, centerOf(tiles), max)
    expect(ranges).toHaveLength(4)
    expectPartition(tiles, ranges, 1)
  })

  it('forme en L : aucun rectangle ne recouvre la tuile fraîche absente de la liste', () => {
    const fresh = { z: Z, x: 2076, y: 1408 }
    const tiles = grid(3, 3).filter(t => tileKey(t) !== tileKey(fresh))
    const ranges = splitIntoRefreshRanges(tiles, centerOf(grid(3, 3)), 8)
    expectPartition(tiles, ranges, 8)
  })

  it('tuiles éparses : chacune dans son propre rectangle', () => {
    const tiles: Tile[] = [{ z: Z, x: 2074, y: 1408 }, { z: Z, x: 2080, y: 1408 }, { z: Z, x: 2074, y: 1415 }]
    const ranges = splitIntoRefreshRanges(tiles, centerOf(tiles), 8)
    expect(ranges).toHaveLength(3)
    expectPartition(tiles, ranges, 8)
  })

  it('le premier rectangle contient la tuile la plus proche du centre', () => {
    const tiles = grid(5, 1)
    const center = centerOf([{ z: Z, x: 2078, y: 1408 }])
    const [first] = splitIntoRefreshRanges(tiles, center, 2)
    expect(first!.maxX).toBe(2078)
  })

  it('ne modifie pas la liste reçue', () => {
    const tiles = grid(3, 3)
    const copy = tiles.map(t => ({ ...t }))
    splitIntoRefreshRanges(tiles, centerOf(tiles), 4)
    expect(tiles).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------

describe('planTileRefresh', () => {
  const RANGE: TileRange = { z: Z, minX: 2074, maxX: 2075, minY: 1408, maxY: 1409 }
  const [A, B, C, D] = tilesInRange(RANGE) as [Tile, Tile, Tile, Tile]

  it('base vide : toutes les tuiles sont à charger', async () => {
    const plan = await planTileRefresh(RANGE, deps())
    expect(plan.range).toEqual(RANGE)
    expect(plan.fresh).toEqual([])
    expect(keys(plan.stale)).toEqual(keys(tilesInRange(RANGE)))
  })

  it('tuile chargée il y a exactement 7 jours : encore fraîche ; 1 s de plus : à charger', async () => {
    await markTile(A, T0)
    await markTile(B, at(-1000))
    const plan = await planTileRefresh(RANGE, deps(at(TILE_TTL_MS)))
    expect(keys(plan.fresh)).toEqual(keys([A]))
    expect(keys(plan.stale)).toEqual(keys([B, C, D]))
  })

  it('une tuile fraîche hors du rectangle est ignorée', async () => {
    await markTile({ z: Z, x: 2090, y: 1408 }, T0)
    await markTile({ z: 13, x: A.x, y: A.y }, T0)
    const plan = await planTileRefresh(RANGE, deps())
    expect(plan.fresh).toEqual([])
    expect(plan.stale).toHaveLength(4)
  })

  it('force : toutes les tuiles à charger, même fraîches', async () => {
    for (const t of [A, B, C, D]) await markTile(t, T0)
    expect((await planTileRefresh(RANGE, deps())).stale).toEqual([])
    const forced = await planTileRefresh(RANGE, deps(), { force: true })
    expect(forced.fresh).toEqual([])
    expect(keys(forced.stale)).toEqual(keys([A, B, C, D]))
  })

  it('n\'appelle jamais Overpass', async () => {
    await planTileRefresh(RANGE, deps())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('refreshTileRange', () => {
  const RANGE = tileRangeForBbox(PARIS, Z)
  const placeRow = (id: string) => db.select().from(schema.places).where(eq(schema.places.id, id)).get()

  it('enregistre les lieux, marque toutes les tuiles et renvoie le nombre de lieux lus', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    const { places } = await refreshTileRange(RANGE, deps())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Fixture : dog=no et sans coordonnées non enregistrés.
    expect(places).toBe(4)
    expect((await placeRow('osm:node:1001'))?.status).toBe('active')
    expect(await placeRow('osm:node:1003')).toBeUndefined()
    const plan = await planTileRefresh(RANGE, deps(at(DAY)))
    expect(plan.stale).toEqual([])
    expect(plan.fresh).toHaveLength(tileRangeSize(RANGE))
  })

  it('lieu OSM absent d\'une nouvelle lecture : marqué removed', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await refreshTileRange(RANGE, deps())
    fetchMock.mockResolvedValueOnce(overpassOk(ELEMENTS.filter(e => e.id !== 1004)))
    await refreshTileRange(RANGE, deps(at(DAY)))
    expect((await placeRow('osm:node:1004'))?.status).toBe('removed')
    expect((await placeRow('osm:node:1001'))?.status).toBe('active')
  })

  it('recharge même des tuiles fraîches (pas de contrôle de fraîcheur)', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk()).mockResolvedValueOnce(overpassOk())
    await refreshTileRange(RANGE, deps())
    await refreshTileRange(RANGE, deps(at(1000)))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('échec d\'Overpass sur toutes les instances : OverpassError, rien n\'est écrit', async () => {
    fetchMock.mockRejectedValue(new Error('connexion refusée'))
    await expect(refreshTileRange(RANGE, deps())).rejects.toBeInstanceOf(OverpassError)
    expect(await db.select().from(schema.fetchedTiles).all()).toEqual([])
    expect(await db.select().from(schema.places).all()).toEqual([])
  })

  it('HTTP 504 partout : OverpassError', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 504 }))
    await expect(refreshTileRange(RANGE, deps())).rejects.toBeInstanceOf(OverpassError)
  })

  it('[timeout:N] demandé honoré quand le délai d\'essai le permet', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await refreshTileRange(RANGE, deps(T0, { overpassTimeoutMs: 120_000, overpassDeadlineMs: 240_000 }), { serverTimeoutS: 90 })
    expect(sentTimeout(0)).toBe(90)
  })

  it('sans serverTimeoutS : [timeout:N] par défaut', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk())
    await refreshTileRange(RANGE, deps(T0, { overpassTimeoutMs: 120_000, overpassDeadlineMs: 240_000 }))
    expect(sentTimeout(0)).toBe(OVERPASS_SERVER_TIMEOUT_S)
  })
})
