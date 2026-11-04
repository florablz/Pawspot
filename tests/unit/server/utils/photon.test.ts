/**
 * Client Photon (géocodeur par défaut, server/utils/photon.ts) : URL sans position,
 * conversion GeoJSON → GeocodeResult (libellés, types, emprise), filtre des pays et de
 * la couverture, choix du fournisseur (`GEOCODER`). `fetch` et horloge injectés :
 * aucun appel réseau (fixtures tests/fixtures/photon/).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuredGeocoder, searchGeocoder } from '../../../../server/utils/geocoder'
import { GeocodeServiceError, resetGeocoderQueue } from '../../../../server/utils/geocoding/core'
import type { GeocoderDeps } from '../../../../server/utils/geocoding/core'
import { PAWSPOT_USER_AGENT } from '../../../../server/utils/http'
import {
  configuredPhotonSearchUrl,
  parsePhotonBaseUrl,
  PHOTON_DEFAULT_BASE_URL,
  photonBbox,
  photonPostcode,
  photonResultType,
  photonSearchUrl,
  photonToGeocodeResult,
  photonToGeocodeResults,
  searchPhoton,
} from '../../../../server/utils/photon'
import brestFixture from '../../../fixtures/photon/brest.json'
import lyonFixture from '../../../fixtures/photon/lyon.json'
import rivoliFixture from '../../../fixtures/photon/rivoli.json'

/** Feature Photon minimale en France, surchargée au besoin. */
function feature(props: Record<string, unknown>, coordinates: [number, number] = [2.3522, 48.8566]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { countrycode: 'FR', ...props } }
}

describe('adresse de Photon', () => {
  it('URL : q, lang=fr et limit=10, sans aucun biais de position', () => {
    const url = new URL(photonSearchUrl('lyon', 'https://photon.komoot.io/api/'))
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/')
    expect([...url.searchParams.keys()]).toEqual(['q', 'lang', 'limit'])
    expect(url.searchParams.get('q')).toBe('lyon')
    expect(url.searchParams.get('lang')).toBe('fr')
    expect(url.searchParams.get('limit')).toBe('10')
    for (const key of ['lat', 'lon', 'location_bias_scale', 'zoom']) expect(url.searchParams.has(key)).toBe(false)
  })

  it('PHOTON_URL : serveur local accepté, valeur invalide → instance publique', () => {
    expect(configuredPhotonSearchUrl({ PHOTON_URL: 'http://127.0.0.1:3101/' })).toBe('http://127.0.0.1:3101/api/')
    expect(configuredPhotonSearchUrl({})).toBe(`${PHOTON_DEFAULT_BASE_URL}/api/`)
    for (const raw of ['ftp://photon.example', 'https://user:pw@photon.example', 'https://photon.example/?x=1', 'pas une url', '']) {
      expect(parsePhotonBaseUrl(raw), raw).toBe(PHOTON_DEFAULT_BASE_URL)
    }
  })
})

describe('conversion GeoJSON → GeocodeResult', () => {
  it('Lyon : ville « Lyon (69) » avec emprise ; résultat aux États-Unis écarté', () => {
    const results = photonToGeocodeResults(lyonFixture.features)
    expect(results.map(r => r.label)).toEqual(['Lyon (69)', 'Gare de Lyon, 75012 Paris'])
    expect(results[0]).toMatchObject({ type: 'city', lat: 45.7578137, lon: 4.8320114, city: 'Lyon', postcode: '69001' })
    expect(results[0]!.bbox).toEqual({ minLon: 4.7718134, minLat: 45.7073666, maxLon: 4.8983774, maxLat: 45.8082628 })
    expect(results[1]!.type).toBe('place')
  })

  it('Brest : « Brest (29) » ; Brest (Biélorussie) écarté', () => {
    const results = photonToGeocodeResults(brestFixture.features)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ label: 'Brest (29)', type: 'city' })
  })

  it('« 12 rue de Rivoli, Paris » : adresse précise puis la rue', () => {
    const results = photonToGeocodeResults(rivoliFixture.features)
    expect(results.map(r => [r.label, r.type])).toEqual([
      ['12 Rue de Rivoli, 75004 Paris', 'address'],
      ['Rue de Rivoli, 75001 Paris', 'street'],
    ])
  })

  it('pays couvert mais point hors couverture (TAAF) : écarté', () => {
    expect(photonToGeocodeResult(feature({ type: 'city', name: 'Port-aux-Français', countrycode: 'FR' }, [70.2, -49.35]))).toBeNull()
  })

  it('outre-mer : La Réunion acceptée (code pays RE)', () => {
    const result = photonToGeocodeResult(feature({ type: 'city', osm_key: 'place', osm_value: 'city', name: 'Saint-Denis', state: 'La Réunion', countrycode: 'RE' }, [55.4481, -20.8789]))
    expect(result).toMatchObject({ label: 'Saint-Denis (974)', type: 'city' })
  })

  it('sans code pays ou feature illisible : écartée', () => {
    expect(photonToGeocodeResult({ ...feature({ type: 'city', name: 'Paris' }), properties: { type: 'city', name: 'Paris' } })).toBeNull()
    expect(photonToGeocodeResult({ geometry: { coordinates: ['a', 'b'] }, properties: {} })).toBeNull()
    expect(photonToGeocodeResult(null)).toBeNull()
  })

  it('Paris : département 75 déduit du nom', () => {
    expect(photonToGeocodeResult(feature({ type: 'city', name: 'Paris', county: 'Paris' }))?.label).toBe('Paris (75)')
  })

  it('code postal : premier d\'une liste « 69001;69002 »', () => {
    expect(photonPostcode('69001;69002')).toBe('69001')
    expect(photonPostcode('  ')).toBeUndefined()
  })

  it('emprise : ordre Photon [minLon, maxLat, maxLon, minLat], invalide → undefined', () => {
    expect(photonBbox([2.2, 48.9, 2.4, 48.8])).toEqual({ minLon: 2.2, minLat: 48.8, maxLon: 2.4, maxLat: 48.9 })
    expect(photonBbox([2.2, 48.9])).toBeUndefined()
    expect(photonBbox(undefined)).toBeUndefined()
  })

  it.each([
    [{ osm_value: 'postcode' }, 'postcode'],
    [{ type: 'city' }, 'city'],
    [{ osm_key: 'place', osm_value: 'village' }, 'city'],
    [{ type: 'county' }, 'region'],
    [{ type: 'street' }, 'street'],
    [{ type: 'house', housenumber: '12' }, 'address'],
    [{ type: 'house', housenumber: '12', name: 'Café de Flore', osm_key: 'amenity' }, 'place'],
    [{ type: 'other', name: 'Tour Eiffel' }, 'place'],
  ] as const)('type %j → %s', (props, expected) => {
    expect(photonResultType(props)).toBe(expected)
  })

  it('au plus 8 résultats, sans doublon de libellé', () => {
    const many = Array.from({ length: 12 }, (_, i) => feature({ type: 'other', name: `Square n°${i + 1}`, city: 'Paris', postcode: '75004' }))
    expect(photonToGeocodeResults([...many, many[0]])).toHaveLength(8)
  })
})

describe('appel (fetch et horloge injectés)', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let clock = Date.UTC(2026, 10, 4, 10)
  const deps = (): GeocoderDeps => ({ fetch: fetchMock, now: () => clock, sleep: async () => {}, endpoint: 'https://photon.test/api/' })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

  beforeEach(() => {
    resetGeocoderQueue()
    fetchMock.mockReset()
    clock += 60_000
  })

  it('envoie la requête normalisée et le User-Agent PawSpot, sans Referer', async () => {
    fetchMock.mockResolvedValueOnce(json(lyonFixture))
    const results = await searchPhoton('  LYON ', deps())
    expect(results[0]!.label).toBe('Lyon (69)')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('q')).toBe('lyon')
    const headers = new Headers(init!.headers)
    expect(headers.get('user-agent')).toBe(PAWSPOT_USER_AGENT)
    expect(headers.has('referer')).toBe(false)
  })

  it('requêtes identiques en cours : un seul appel ; « Lyon 東京 » jamais servi sous « lyon »', async () => {
    fetchMock.mockImplementation(async url => json(new URL(String(url)).searchParams.get('q') === 'lyon' ? lyonFixture : { features: [] }))
    const [a, b, c] = await Promise.all([searchPhoton('Lyon', deps()), searchPhoton('lyon', deps()), searchPhoton('Lyon 東京', deps())])
    expect(a).toEqual(b)
    expect(c).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('HTTP 500 ou réponse sans `features` : GeocodeServiceError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(searchPhoton('Paris', deps())).rejects.toBeInstanceOf(GeocodeServiceError)
    clock += 60_000
    fetchMock.mockResolvedValueOnce(json({ type: 'FeatureCollection' }))
    await expect(searchPhoton('Nice', deps())).rejects.toMatchObject({ reason: 'invalid' })
  })
})

describe('choix du fournisseur (GEOCODER)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Photon par défaut ; « nominatim » insensible à la casse ; valeur inconnue → Photon', () => {
    expect(configuredGeocoder({})).toBe('photon')
    expect(configuredGeocoder({ GEOCODER: ' Nominatim ' })).toBe('nominatim')
    expect(configuredGeocoder({ GEOCODER: 'google' })).toBe('photon')
  })

  it('searchGeocoder sans GEOCODER : appelle Photon (format GeoJSON)', async () => {
    resetGeocoderQueue()
    vi.stubEnv('GEOCODER', '')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(brestFixture)))
    const results = await searchGeocoder('Brest', { fetch: fetchMock, sleep: async () => {}, endpoint: 'https://photon.test/api/' })
    expect(results.map(r => r.label)).toEqual(['Brest (29)'])
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^https:\/\/photon\.test\/api\/\?q=brest&lang=fr&limit=10$/)
  })
})
