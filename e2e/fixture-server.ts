/**
 * Faux Overpass + faux géocodeurs (Photon, Nominatim) pour les parcours Playwright
 * (aucun appel réseau réel).
 * Lancé par `playwright.config.ts` (`webServer`), sur 127.0.0.1 uniquement.
 *
 * - `POST /api/interpreter` (Overpass) : éléments des fixtures `tests/fixtures/overpass/*.json`
 *   compris dans le `[bbox:s,w,n,e]` de la requête, ou l'élément demandé (`node(1101);`).
 *   Mode panne : HTTP 504 « at capacity », comme une instance publique saturée.
 * - `GET /api/?q=` (Photon, fournisseur par défaut, GeoJSON) et `GET /search?q=` (Nominatim
 *   jsonv2) : « lyon », « brest », « 12 rue de rivoli paris » (casse, accents et ponctuation
 *   ignorés) ; sinon aucun résultat.
 * - `POST /__control` `{ "overpass": "ok" | "down" }` : bascule la panne ; `GET /__stats` :
 *   compteurs d'appels ; `POST /__stats/reset` ; `GET /__health`.
 */
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

export const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3101)

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number, lon: number }
  tags?: Record<string, string>
}

const fixtures = new URL('../tests/fixtures/', import.meta.url)
const readJson = <T>(path: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(path, fixtures)), 'utf8')) as T

const ELEMENTS: OverpassElement[] = [
  ...readJson<{ elements: OverpassElement[] }>('overpass/paris-mixte.json').elements,
  ...readJson<{ elements: OverpassElement[] }>('overpass/paris-centre.json').elements,
]

const NOMINATIM: Record<string, unknown[]> = {
  'lyon': readJson('nominatim/lyon.json'),
  'brest': readJson('nominatim/brest.json'),
  '12 rue de rivoli paris': readJson('nominatim/rivoli.json'),
}

const PHOTON: Record<string, unknown> = {
  'lyon': readJson('photon/lyon.json'),
  'brest': readJson('photon/brest.json'),
  '12 rue de rivoli paris': readJson('photon/rivoli.json'),
}

const state = { overpass: 'ok' as 'ok' | 'down' }
const stats = { overpass: 0, overpass504: 0, geocoder: 0, queries: [] as string[] }

function normalize(q: string): string {
  return q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function position(el: OverpassElement): { lat: number, lon: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon }
  return el.center ?? null
}

/** Réponse Overpass à une requête QL (bbox globale ou élément seul). */
export function answerOverpass(query: string): OverpassElement[] {
  const single = query.match(/\b(node|way|relation)\((\d+)\);/)
  if (single) return ELEMENTS.filter(el => el.type === single[1] && el.id === Number(single[2]))
  const bbox = query.match(/\[bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/)
  if (!bbox) return []
  const [s, w, n, e] = bbox.slice(1).map(Number) as [number, number, number, number]
  return ELEMENTS.filter((el) => {
    const p = position(el)
    return !!p && p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e
  })
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${FIXTURE_PORT}`)
  try {
    if (url.pathname === '/__health') return send(res, 200, { ok: true })
    if (url.pathname === '/__stats' && req.method === 'GET') return send(res, 200, stats)
    if (url.pathname === '/__stats/reset' && req.method === 'POST') {
      Object.assign(stats, { overpass: 0, overpass504: 0, geocoder: 0, queries: [] })
      return send(res, 200, stats)
    }
    if (url.pathname === '/__control' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { overpass?: 'ok' | 'down' }
      if (body.overpass === 'ok' || body.overpass === 'down') state.overpass = body.overpass
      return send(res, 200, state)
    }
    if (url.pathname === '/api/interpreter') {
      stats.overpass++
      const raw = req.method === 'POST' ? await readBody(req) : url.search.slice(1)
      if (state.overpass === 'down') {
        stats.overpass504++
        return send(res, 504, '<html><body><p>The server is probably too busy to handle your request.</p></body></html>', 'text/html')
      }
      const query = new URLSearchParams(raw).get('data') ?? ''
      return send(res, 200, {
        version: 0.6,
        generator: 'Overpass API (fixture PawSpot e2e)',
        osm3s: { timestamp_osm_base: '2026-11-01T00:00:00Z', copyright: 'ODbL' },
        elements: answerOverpass(query),
      })
    }
    if (url.pathname === '/search' || url.pathname === '/api/' || url.pathname === '/api') {
      stats.geocoder++
      const q = url.searchParams.get('q') ?? ''
      stats.queries.push(q)
      if (url.pathname === '/search') return send(res, 200, NOMINATIM[normalize(q)] ?? [])
      return send(res, 200, PHOTON[normalize(q)] ?? { type: 'FeatureCollection', features: [] })
    }
    return send(res, 404, { error: 'fixture inconnue' })
  }
  catch (error) {
    return send(res, 500, { error: String(error) })
  }
})

server.listen(FIXTURE_PORT, '127.0.0.1', () => {
  console.log(`[fixtures] Overpass et Nominatim simulés sur http://127.0.0.1:${FIXTURE_PORT}`)
})
