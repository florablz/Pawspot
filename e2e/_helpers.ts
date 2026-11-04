/**
 * Outils communs aux parcours Playwright (pas de suffixe `.spec.ts` : ce n'est pas un test).
 * - `test` : `page` dont toute requête hors de l'application est interceptée : tuiles de
 *   carte → image grise, tout le reste (photos Wikimedia…) → abandonnée. Aucun appel réel.
 * - pilotage du serveur de fixtures (`e2e/fixture-server.ts`) ;
 * - accès à la base e2e (`.data/e2e/`), pour simuler des lieux « déjà en base ».
 */
import { deflateSync } from 'node:zlib'
import { createClient } from '@libsql/client'
import { expect, test as base, type Page } from '@playwright/test'

export const APP_ORIGIN = 'http://127.0.0.1:3100'
export const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.FIXTURE_PORT ?? 3101}`
export const E2E_DB_URL = 'file:.data/e2e/pawspot-e2e.db'

// ---------------------------------------------------------------------------
// Tuile grise (PNG 256×256 en niveaux de gris, construit une fois)
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xFF]! ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function greyPng(size = 256, grey = 0xC8): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8 bits
  ihdr[9] = 0 // niveaux de gris
  const row = Buffer.alloc(size + 1, grey)
  row[0] = 0 // filtre « aucun »
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export const GREY_TILE = greyPng()

/** Requêtes externes vues par le navigateur (toutes interceptées). */
export interface ExternalRequests { tiles: number, blocked: string[] }

export const test = base.extend<{ external: ExternalRequests }>({
  // `auto` : la route est posée avant toute navigation, dans chaque test.
  external: [async ({ page }, use) => {
    const external: ExternalRequests = { tiles: 0, blocked: [] }
    await page.route(url => url.origin !== APP_ORIGIN, async (route) => {
      const url = new URL(route.request().url())
      if (/\/\d+\/\d+\/\d+(@2x)?\.png$/.test(url.pathname)) {
        external.tiles++
        return route.fulfill({ status: 200, contentType: 'image/png', body: GREY_TILE })
      }
      external.blocked.push(url.href)
      return route.abort('blockedbyclient')
    })
    await use(external)
  }, { auto: true }],
})

export { expect }

// ---------------------------------------------------------------------------
// Serveur de fixtures
// ---------------------------------------------------------------------------

export async function setOverpass(mode: 'ok' | 'down'): Promise<void> {
  const res = await fetch(`${FIXTURE_ORIGIN}/__control`, { method: 'POST', body: JSON.stringify({ overpass: mode }) })
  expect(res.ok).toBe(true)
}

export async function fixtureStats(): Promise<{ overpass: number, overpass504: number, geocoder: number, queries: string[] }> {
  return await (await fetch(`${FIXTURE_ORIGIN}/__stats`)).json()
}

// ---------------------------------------------------------------------------
// Base e2e
// ---------------------------------------------------------------------------

/** Exécute une requête SQL sur la base du serveur e2e (fichier SQLite local). */
export async function e2eSql(statement: string, args: (string | number)[] = []): Promise<void> {
  const client = createClient({ url: E2E_DB_URL })
  try {
    await client.execute({ sql: statement, args })
  }
  finally {
    client.close()
  }
}

// ---------------------------------------------------------------------------
// Écran carte
// ---------------------------------------------------------------------------

/** Nombre affiché par la barre d'état (« 7 lieux affichés », « 2 lieux affichés sur 7 »). */
export async function placesCount(page: Page): Promise<{ shown: number, loaded: number }> {
  const text = (await page.getByTestId('places-count').textContent()) ?? ''
  const m = text.match(/(\d+) lieux? affichés?(?: sur (\d+))?/)
  if (!m) throw new Error(`Compteur illisible : « ${text} »`)
  return { shown: Number(m[1]), loaded: Number(m[2] ?? m[1]) }
}

/** Attend que des lieux soient chargés et affichés (compteur > 0, chargement terminé). */
export async function waitForPlaces(page: Page): Promise<{ shown: number, loaded: number }> {
  await expect(page.getByTestId('places-count')).toHaveText(/[1-9]\d* lieux? affichés?/, { timeout: 15_000 })
  await expect(page.getByTestId('loading')).toHaveCount(0, { timeout: 15_000 })
  return placesCount(page)
}

/** Vue de la carte lue dans l'URL (`?lat=…&lon=…&z=…`). */
export function urlView(page: Page): { lat: number, lon: number, z: number } | null {
  const q = new URL(page.url()).searchParams
  if (!q.has('lat') || !q.has('lon') || !q.has('z')) return null
  return { lat: Number(q.get('lat')), lon: Number(q.get('lon')), z: Number(q.get('z')) }
}

/** Attend que l'URL décrive une vue proche de (lat, lon), et la renvoie. */
export async function expectViewNear(page: Page, lat: number, lon: number, tolerance = 0.05) {
  await expect.poll(() => {
    const v = urlView(page)
    return v ? Math.max(Math.abs(v.lat - lat), Math.abs(v.lon - lon)) : Infinity
  }, { timeout: 10_000, message: `vue proche de ${lat}, ${lon}` }).toBeLessThan(tolerance)
  return urlView(page)!
}

/** Marqueurs et bulles de groupe visibles sur la carte. */
export function mapMarkers(page: Page) {
  return page.locator('.leaflet-marker-pane .leaflet-marker-icon:not([aria-hidden="true"])')
}
