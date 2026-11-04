/**
 * Client Nominatim (server/utils/nominatim.ts) : conversion jsonv2 → GeocodeResult,
 * emprise, code de département, nature du résultat, file « 1 requête/s » avec
 * horloge et attente injectées, dédoublonnage des requêtes en cours.
 * `fetch` simulé et fixture écrite à la main : aucun appel à Nominatim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GeocodeServiceError,
  NOMINATIM_BACKOFF_MAX_MS,
  NOMINATIM_BACKOFF_MS,
  NOMINATIM_LIMIT,
  NOMINATIM_MAX_QUEUE_WAIT_MS,
  NOMINATIM_MIN_INTERVAL_MS,
  NOMINATIM_TIMEOUT_MS,
  departmentCode,
  nominatimBbox,
  nominatimResultType,
  nominatimSearchUrl,
  resetNominatimQueue,
  searchNominatim,
  toGeocodeResult,
  toGeocodeResults,
} from '../../../../server/utils/nominatim'
import type { NominatimDeps } from '../../../../server/utils/nominatim'
import { PAWSPOT_USER_AGENT } from '../../../../server/utils/http'
import lyonFixture from '../../../fixtures/nominatim/lyon.json'
import { LYON_RESULTS } from '../_nominatim'

/** Élément jsonv2 minimal, complété par `extra`. */
function item(extra: Record<string, unknown>) {
  return { lat: '45.7578', lon: '4.8320', ...extra }
}

describe('toGeocodeResults sur la fixture Lyon', () => {
  it('convertit dans l\'ordre, sans doublon ni point hors couverture', () => {
    expect(toGeocodeResults(lyonFixture)).toEqual(LYON_RESULTS)
  })

  it('au plus NOMINATIM_LIMIT résultats', () => {
    const many = Array.from({ length: 12 }, (_, i) => item({ category: 'amenity', type: 'cafe', name: `Café n°${i + 1}` }))
    expect(toGeocodeResults(many)).toHaveLength(NOMINATIM_LIMIT)
  })

  it('dédoublonne sur le libellé normalisé (casse, accents)', () => {
    const results = toGeocodeResults([
      item({ addresstype: 'city', name: 'Saint-Étienne', address: { 'ISO3166-2-lvl6': 'FR-42' } }),
      item({ addresstype: 'city', name: 'saint etienne', address: { postcode: '42000' } }),
    ])
    expect(results.map(r => r.label)).toEqual(['Saint-Étienne (42)'])
  })
})

describe('toGeocodeResult : libellés', () => {
  it('ville de Corse : code 2A depuis ISO3166-2-lvl6', () => {
    const ajaccio = toGeocodeResult({ lat: '41.9263', lon: '8.7376', addresstype: 'city', name: 'Ajaccio', address: { city: 'Ajaccio', 'ISO3166-2-lvl6': 'FR-2A', postcode: '20000' } })
    expect(ajaccio).toMatchObject({ label: 'Ajaccio (2A)', type: 'city', city: 'Ajaccio', postcode: '20000' })
  })

  it('DROM : Saint-Denis de La Réunion (974) d\'après le code postal', () => {
    const result = toGeocodeResult({ lat: '-20.8823', lon: '55.4504', addresstype: 'city', name: 'Saint-Denis', address: { city: 'Saint-Denis', 'ISO3166-2-lvl4': 'FR-RE', postcode: '97400', country_code: 're' } })
    expect(result).toMatchObject({ label: 'Saint-Denis (974)', type: 'city' })
  })

  it('DROM : Guadeloupe (971) d\'après ISO3166-2-lvl4', () => {
    const result = toGeocodeResult({ lat: '16.2411', lon: '-61.5331', addresstype: 'town', name: 'Pointe-à-Pitre', address: { town: 'Pointe-à-Pitre', 'ISO3166-2-lvl4': 'FR-971' } })
    expect(result?.label).toBe('Pointe-à-Pitre (971)')
  })

  it('COM sans code : « ville, territoire »', () => {
    const result = toGeocodeResult({ lat: '-17.5350', lon: '-149.5696', addresstype: 'city', name: 'Papeete', address: { city: 'Papeete', state: 'Polynésie française', country_code: 'pf' } })
    expect(result).toMatchObject({ label: 'Papeete, Polynésie française', type: 'city', city: 'Papeete' })
  })

  it('COM avec code postal : Nouméa (988)', () => {
    const result = toGeocodeResult({ lat: '-22.2758', lon: '166.4580', addresstype: 'city', name: 'Nouméa', address: { city: 'Nouméa', postcode: '98800' } })
    expect(result?.label).toBe('Nouméa (988)')
  })

  it('code postal : « 69001 Lyon »', () => {
    const result = toGeocodeResult(item({ addresstype: 'postcode', category: 'place', type: 'postcode', name: '69001', address: { postcode: '69001', city: 'Lyon' } }))
    expect(result).toMatchObject({ label: '69001 Lyon', type: 'postcode', postcode: '69001', city: 'Lyon' })
  })

  it('adresse précise : « 8 Rue de Rivoli, 75004 Paris »', () => {
    const result = toGeocodeResult({ lat: '48.8556', lon: '2.3601', addresstype: 'place', category: 'place', type: 'house', name: null, address: { house_number: '8', road: 'Rue de Rivoli', city: 'Paris', postcode: '75004' } })
    expect(result).toEqual({ label: '8 Rue de Rivoli, 75004 Paris', lat: 48.8556, lon: 2.3601, type: 'address', postcode: '75004', city: 'Paris' })
  })

  it('région et département : « Bretagne », « Rhône (69) », sans commune', () => {
    const bretagne = toGeocodeResult({ lat: '48.2', lon: '-2.9', addresstype: 'state', name: 'Bretagne', address: { state: 'Bretagne', city: 'Rennes' } })
    expect(bretagne).toMatchObject({ label: 'Bretagne', type: 'region' })
    expect(bretagne).not.toHaveProperty('city')
    const rhone = toGeocodeResult(item({ addresstype: 'county', name: 'Rhône', address: { county: 'Rhône', 'ISO3166-2-lvl6': 'FR-69' } }))
    expect(rhone?.label).toBe('Rhône (69)')
  })

  it('lieu sans nom : trois premiers morceaux de display_name, sans « France »', () => {
    const result = toGeocodeResult(item({
      category: 'amenity', type: 'cafe', name: '',
      display_name: '12, Rue Mercière, Lyon 2e Arrondissement, Lyon, Métropole de Lyon, France',
    }))
    expect(result?.label).toBe('12, Rue Mercière, Lyon 2e Arrondissement')
  })

  it('lieu nommé dans sa commune : « Tour Eiffel, 75007 Paris »', () => {
    const result = toGeocodeResult({ lat: '48.8584', lon: '2.2945', category: 'tourism', type: 'attraction', addresstype: 'tourism', name: 'Tour Eiffel', address: { city: 'Paris', postcode: '75007' } })
    expect(result).toMatchObject({ label: 'Tour Eiffel, 75007 Paris', type: 'place' })
  })

  it('libellé tronqué à 200 caractères', () => {
    const result = toGeocodeResult(item({ category: 'amenity', type: 'cafe', name: 'A'.repeat(250) }))
    expect(result?.label).toHaveLength(200)
  })

  it('refuse : hors couverture, coordonnées absentes ou illisibles, libellé vide', () => {
    expect(toGeocodeResult(lyonFixture[5])).toBeNull() // Kerguelen (TAAF)
    expect(toGeocodeResult({ lat: '40.4168', lon: '-3.7038', addresstype: 'city', name: 'Madrid' })).toBeNull()
    expect(toGeocodeResult({ lon: '4.83', name: 'Lyon' })).toBeNull()
    expect(toGeocodeResult(item({ lat: 'abc', name: 'Lyon' }))).toBeNull()
    expect(toGeocodeResult(item({ category: 'amenity', type: 'cafe' }))).toBeNull()
    expect(toGeocodeResult(null)).toBeNull()
    expect(toGeocodeResult('Lyon')).toBeNull()
  })

  it('accepte des coordonnées numériques et ignore une emprise illisible', () => {
    const result = toGeocodeResult({ lat: 45.7578, lon: 4.832, addresstype: 'city', name: 'Lyon', boundingbox: ['45.8', '45.7', '4.7', '4.9'] })
    expect(result).toMatchObject({ lat: 45.7578, lon: 4.832, label: 'Lyon' })
    expect(result).not.toHaveProperty('bbox')
  })
})

describe('nominatimBbox', () => {
  it('[minLat, maxLat, minLon, maxLon] (chaînes ou nombres) → Bbox', () => {
    expect(nominatimBbox(['45.70', '45.80', '4.77', '4.89'])).toEqual({ minLon: 4.77, minLat: 45.7, maxLon: 4.89, maxLat: 45.8 })
    expect(nominatimBbox([45.7, 45.8, 4.77, 4.89])).toEqual({ minLon: 4.77, minLat: 45.7, maxLon: 4.89, maxLat: 45.8 })
  })

  it('undefined si absente, mal formée, inversée ou hors bornes', () => {
    expect(nominatimBbox(undefined)).toBeUndefined()
    expect(nominatimBbox(['45.7', '45.8', '4.77'])).toBeUndefined()
    expect(nominatimBbox(['45.8', '45.7', '4.77', '4.89'])).toBeUndefined()
    expect(nominatimBbox(['45.7', '45.8', 'abc', '4.89'])).toBeUndefined()
    expect(nominatimBbox(['-91', '45.8', '4.77', '4.89'])).toBeUndefined()
  })
})

describe('departmentCode', () => {
  it('ISO3166-2-lvl6 : métropole, Corse (majuscules), DROM', () => {
    expect(departmentCode({ 'ISO3166-2-lvl6': 'FR-69' }, undefined)).toBe('69')
    expect(departmentCode({ 'ISO3166-2-lvl6': 'FR-2A' }, undefined)).toBe('2A')
    expect(departmentCode({ 'ISO3166-2-lvl6': 'fr-2b' }, undefined)).toBe('2B')
    expect(departmentCode({ 'ISO3166-2-lvl6': 'FR-974' }, undefined)).toBe('974')
  })

  it('ISO3166-2-lvl4 seulement pour un DROM (FR-97x)', () => {
    expect(departmentCode({ 'ISO3166-2-lvl4': 'FR-972' }, undefined)).toBe('972')
    expect(departmentCode({ 'ISO3166-2-lvl4': 'FR-ARA' }, undefined)).toBeUndefined()
  })

  it('sinon le code postal, sauf en Corse (20…)', () => {
    expect(departmentCode({ 'ISO3166-2-lvl6': 'FR-75C' }, '75012')).toBe('75')
    expect(departmentCode(undefined, '69001')).toBe('69')
    expect(departmentCode(undefined, '97400')).toBe('974')
    expect(departmentCode(undefined, '98714')).toBe('987')
    expect(departmentCode(undefined, '20000')).toBeUndefined()
    expect(departmentCode(undefined, '7500')).toBeUndefined()
    expect(departmentCode(undefined, undefined)).toBeUndefined()
  })
})

describe('nominatimResultType', () => {
  it.each([
    [{ addresstype: 'postcode' }, 'postcode'],
    [{ type: 'postcode' }, 'postcode'],
    [{ addresstype: 'city' }, 'city'],
    [{ addresstype: 'town' }, 'city'],
    [{ addresstype: 'village' }, 'city'],
    [{ addresstype: 'municipality' }, 'city'],
    [{ addresstype: 'state' }, 'region'],
    [{ addresstype: 'county' }, 'region'],
    [{ addresstype: 'territory' }, 'region'],
    [{ addresstype: 'suburb', category: 'boundary', type: 'administrative' }, 'region'],
    [{ addresstype: 'place', category: 'place', type: 'house', address: { house_number: '8' } }, 'address'],
    [{ addresstype: 'building', category: 'building', type: 'yes', address: { house_number: '3' } }, 'address'],
    [{ addresstype: 'road', address: { house_number: '12' } }, 'address'],
    [{ addresstype: 'road' }, 'street'],
    [{ category: 'highway', type: 'residential' }, 'street'],
    [{ category: 'highway', type: 'secondary', addresstype: 'road' }, 'street'],
    [{ addresstype: 'place', category: 'place', type: 'house' }, 'place'],
    [{ category: 'amenity', type: 'cafe', addresstype: 'amenity' }, 'place'],
    [{}, 'place'],
  ] as const)('%o → %s', (input, expected) => {
    expect(nominatimResultType(input)).toBe(expected)
  })
})

describe('nominatimSearchUrl', () => {
  it('France, DROM et COM, en français, 8 résultats, jsonv2 avec adresse', () => {
    expect(nominatimSearchUrl('8 rue de Rivoli')).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&accept-language=fr'
      + '&countrycodes=fr%2Cgp%2Cmq%2Cgf%2Cre%2Cyt%2Cpm%2Cbl%2Cmf%2Cpf%2Cnc%2Cwf&q=8+rue+de+Rivoli',
    )
  })
})

describe('file d\'attente (horloge et attente injectées)', () => {
  const T0 = Date.UTC(2026, 10, 3, 10)
  let clock: number
  let sleeps: number[]
  const fetchMock = vi.fn<typeof fetch>()
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })
  /** L'attente est notée sans avancer l'horloge : les créneaux réservés restent visibles. */
  const deps = (extra: Partial<NominatimDeps> = {}): NominatimDeps => ({
    fetch: fetchMock,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...extra,
  })
  const reasonOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GeocodeServiceError)
    return (error as GeocodeServiceError).reason
  }

  beforeEach(() => {
    resetNominatimQueue()
    clock = T0
    sleeps = []
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => json([]))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('envoie le User-Agent PawSpot et l\'URL de recherche', async () => {
    fetchMock.mockResolvedValueOnce(json(lyonFixture))
    expect(await searchNominatim('Lyon', deps())).toEqual(LYON_RESULTS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(nominatimSearchUrl('Lyon'))
    expect((init!.headers as Record<string, string>)['User-Agent']).toBe(PAWSPOT_USER_AGENT)
    expect(init!.signal).toBeInstanceOf(AbortSignal)
  })

  it('espace les appels d\'une seconde, puis 503 (file) au-delà de 3 s d\'attente', async () => {
    const calls = ['Paris', 'Lyon', 'Nice', 'Brest', 'Lille'].map(q => searchNominatim(q, deps()))
    await Promise.all(calls.slice(0, 4))
    expect(sleeps).toEqual([1_000, 2_000, NOMINATIM_MAX_QUEUE_WAIT_MS])
    expect(await reasonOf(calls[4]!)).toBe('queue')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('pas d\'attente quand le créneau précédent est passé', async () => {
    await searchNominatim('Paris', deps())
    clock += NOMINATIM_MIN_INTERVAL_MS
    await searchNominatim('Lyon', deps())
    expect(sleeps).toEqual([])
  })

  it('429 avec Retry-After : recul de cette durée, puis reprise', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
    expect(await reasonOf(searchNominatim('Paris', deps()))).toBe('http')
    expect(await reasonOf(searchNominatim('Lyon', deps()))).toBe('queue')
    clock += 120_000 - NOMINATIM_MAX_QUEUE_WAIT_MS
    await searchNominatim('Lyon', deps())
    expect(sleeps).toEqual([NOMINATIM_MAX_QUEUE_WAIT_MS])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('503 sans Retry-After : recul par défaut de 30 s', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await reasonOf(searchNominatim('Paris', deps()))).toBe('http')
    clock += NOMINATIM_BACKOFF_MS - NOMINATIM_MAX_QUEUE_WAIT_MS - 1
    expect(await reasonOf(searchNominatim('Lyon', deps()))).toBe('queue')
    clock += 1
    await searchNominatim('Lyon', deps())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Retry-After d\'un jour : recul plafonné à 10 min', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '86400' } }))
    await reasonOf(searchNominatim('Paris', deps()))
    clock += NOMINATIM_BACKOFF_MAX_MS
    await searchNominatim('Lyon', deps())
    expect(sleeps).toEqual([])
  })

  it('HTTP 500 sans recul : la requête suivante attend seulement 1 s', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    expect(await reasonOf(searchNominatim('Paris', deps()))).toBe('http')
    await searchNominatim('Lyon', deps())
    expect(sleeps).toEqual([NOMINATIM_MIN_INTERVAL_MS])
  })

  it('erreur réseau, non-JSON, objet au lieu d\'une liste', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await reasonOf(searchNominatim('a1', deps()))).toBe('network')
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 200 }))
    expect(await reasonOf(searchNominatim('a2', deps()))).toBe('invalid')
    fetchMock.mockResolvedValueOnce(json({ error: 'Unable to geocode' }))
    expect(await reasonOf(searchNominatim('a3', deps()))).toBe('invalid')
  })

  it('délai dépassé : échec à 8 s et requête annulée', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let signal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const call = searchNominatim('Paris', deps())
    const reason = reasonOf(call)
    await vi.advanceTimersByTimeAsync(NOMINATIM_TIMEOUT_MS)
    expect(await reason).toBe('timeout')
    expect(signal?.aborted).toBe(true)
  })

  it('requêtes identiques en cours (casse, espaces) : un seul appel partagé', async () => {
    let answer!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      answer = resolve
    }))
    const first = searchNominatim('Lyon', deps())
    const second = searchNominatim('  LYON ', deps())
    expect(second).toBe(first)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    answer(json(lyonFixture))
    expect(await second).toEqual(LYON_RESULTS)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Terminée : une nouvelle requête identique repart vers Nominatim.
    clock += NOMINATIM_MIN_INTERVAL_MS
    await searchNominatim('lyon', deps())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // BUG (agent `back`, server/utils/nominatim.ts:429) : la clé des requêtes en cours est
  // encore `normalizeName` (accents, ponctuation et caractères non latins retirés), alors
  // que depuis 682e019 la clé du cache est `normalizeGeocodeQuery`. « Lyon 東京 » lancé
  // pendant « Lyon » reçoit la réponse de « Lyon », que la route écrit ensuite en cache
  // sous la clé « lyon 東京 » : exactement le mélange que 682e019 voulait empêcher.
  // Correctif attendu : clé `normalizeGeocodeQuery(query)` (et envoyer cette chaîne à Nominatim).
  it.fails('requêtes différentes pour le cache (« Lyon » / « Lyon 東京 ») : jamais partagées en cours', async () => {
    fetchMock.mockImplementation(async url => json(new URL(String(url)).searchParams.get('q') === 'Lyon' ? lyonFixture : []))
    const first = searchNominatim('Lyon', deps())
    const second = searchNominatim('Lyon 東京', deps())
    expect(second).not.toBe(first)
    expect(await first).toEqual(LYON_RESULTS)
    expect(await second).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('une requête en échec n\'est pas gardée en cours', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    await reasonOf(searchNominatim('Lyon', deps()))
    clock += NOMINATIM_MIN_INTERVAL_MS
    expect(await searchNominatim('Lyon', deps())).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
