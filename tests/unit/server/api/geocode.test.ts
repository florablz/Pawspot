/**
 * `GET /api/geocode?q=` : validation, cache en base (libSQL en mémoire), appel à
 * Nominatim simulé (`fetchMock` + fixture `tests/fixtures/nominatim/lyon.json`),
 * 503 en français sans détail interne. Aucun appel réseau.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { GeocodeResponse } from '~~/shared/types'
import { PAWSPOT_USER_AGENT } from '../../../../server/utils/http'
import { NOMINATIM_TIMEOUT_MS, nominatimSearchUrl } from '../../../../server/utils/nominatim'
import lyonFixture from '../../../fixtures/nominatim/lyon.json'
import { LYON_RESULTS } from '../_nominatim'
import { fetchMock, setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }

const UNAVAILABLE = 'Le service de recherche d\'adresses est momentanément indisponible, réessayez dans quelques instants.'
const LYON_URL = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=fr'
  + '&countrycodes=fr%2Cgp%2Cmq%2Cgf%2Cre%2Cyt%2Cpm%2Cbl%2Cmf%2Cpf%2Cnc%2Cwf&q=Lyon'

let api: ApiBench
const geocode = <T = GeocodeResponse>(q?: string) =>
  api.request<T>('GET', q === undefined ? '/api/geocode' : `/api/geocode?q=${encodeURIComponent(q)}`)
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const cacheRows = async () => Number((await api.db.get<{ n: number }>(sql`SELECT count(*) AS n FROM geocode_cache`)).n)

beforeAll(async () => {
  api = await setupApi()
})

beforeEach(async () => {
  fetchMock.mockReset()
  await api.db.run(sql`DELETE FROM geocode_cache`)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('GET /api/geocode : validation', () => {
  it.each([
    ['q absent', '/api/geocode', 'Recherche requise'],
    ['q en double', '/api/geocode?q=Lyon&q=Paris', 'Recherche requise'],
    ['q vide', '/api/geocode?q=', 'La recherche doit faire au moins 2 caractères'],
    ['q d\'un caractère (espaces retirés)', '/api/geocode?q=%20L%20', 'La recherche doit faire au moins 2 caractères'],
    ['q de 101 caractères', `/api/geocode?q=${'a'.repeat(101)}`, 'La recherche doit faire au plus 100 caractères'],
  ])('refuse %s (400) sans appeler Nominatim', async (_case, path, message) => {
    const res = await api.request<ApiErrorBody>('GET', path)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, message })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepte 100 caractères', async () => {
    fetchMock.mockResolvedValueOnce(json([]))
    expect((await geocode('a'.repeat(100))).status).toBe(200)
  })

  it('« !!! » (ni lettre ni chiffre) : liste vide, sans appel ni cache', async () => {
    const res = await geocode('!!!')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ results: [] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await cacheRows()).toBe(0)
  })
})

describe('GET /api/geocode : Nominatim et cache', () => {
  it('absent du cache : un appel à Nominatim (URL exacte, User-Agent PawSpot), puis réponse du cache', async () => {
    fetchMock.mockResolvedValueOnce(json(lyonFixture))
    const res = await geocode('Lyon')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ results: LYON_RESULTS })
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(LYON_URL)
    expect(url).toBe(nominatimSearchUrl('Lyon'))
    expect(new Headers(init!.headers).get('user-agent')).toBe(PAWSPOT_USER_AGENT)

    for (const q of ['lyon', 'LYON', '  Lyon  ', 'Lyon!']) {
      const hit = await geocode(q)
      expect(hit.status, q).toBe(200)
      expect(hit.body, q).toEqual({ results: LYON_RESULTS })
      expect(hit.headers.get('cache-control'), q).toBe('public, max-age=3600')
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('« aucun résultat » est mis en cache aussi', async () => {
    fetchMock.mockResolvedValueOnce(json([]))
    expect((await geocode('Zzyzx')).body).toEqual({ results: [] })
    expect((await geocode('zzyzx')).body).toEqual({ results: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await cacheRows()).toBe(1)
  })

  it('point hors couverture filtré (TAAF)', async () => {
    fetchMock.mockResolvedValueOnce(json([lyonFixture[5]]))
    const res = await geocode('Route de Lyon Kerguelen')
    expect(res.body).toEqual({ results: [] })
    expect(res.text).not.toContain('Kerguelen')
  })
})

describe('GET /api/geocode : Nominatim indisponible → 503', () => {
  it.each([
    ['HTTP 500', () => fetchMock.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))],
    ['HTTP 429', () => fetchMock.mockResolvedValueOnce(new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } }))],
    ['erreur réseau', () => fetchMock.mockRejectedValueOnce(new TypeError('fetch failed: getaddrinfo ENOTFOUND nominatim.openstreetmap.org'))],
    ['réponse non JSON', () => fetchMock.mockResolvedValueOnce(new Response('<html>Nominatim Bad Gateway</html>', { status: 200 }))],
    ['objet au lieu d\'une liste', () => fetchMock.mockResolvedValueOnce(json({ error: { code: 400, message: 'Nominatim internal' } }))],
  ])('%s : message français sans détail, Retry-After, rien en cache', async (_case, arrange) => {
    arrange()
    const res = await geocode<ApiErrorBody>('Lyon')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ statusCode: 503, message: UNAVAILABLE })
    expect(res.text).not.toMatch(/nominatim|HTTP \d|fetch failed|ENOTFOUND|stack/i)
    expect(res.headers.get('retry-after')).toBe('2')
    expect(res.headers.get('cache-control')).not.toBe('public, max-age=3600')
    expect(await cacheRows()).toBe(0)
  })

  it('délai dépassé (8 s) : 503', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}))
    const pending = geocode<ApiErrorBody>('Lyon')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(NOMINATIM_TIMEOUT_MS)
    const res = await pending
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ statusCode: 503, message: UNAVAILABLE })
    expect(res.headers.get('retry-after')).toBe('2')
  })
})
