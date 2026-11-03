import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PlacesResponse } from '#shared/types'
import { getApiErrorMessage } from '~/utils/apiError'
import { MAX_INCOMPLETE_RETRIES, usePlacesSearch } from '~/composables/usePlacesSearch'
import type { MapView } from '~/types/map'
import { deferred, makePlace, placesResponse } from '../_helpers'

interface FetchOptions {
  query: { bbox: string, zoom: number }
  signal: AbortSignal
}

// Le composable s'appuie sur les auto-imports Nuxt (ref, $fetch, getApiErrorMessage) :
// on les fournit en globaux plutôt que de démarrer un environnement Nuxt complet.
const fetchMock = vi.fn<(url: string, options: FetchOptions) => Promise<PlacesResponse>>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('getApiErrorMessage', getApiErrorMessage)
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function view(bbox: string, zoom: number): MapView {
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number) as [number, number, number, number]
  return { center: { lat: (minLat + maxLat) / 2, lng: (minLon + maxLon) / 2 }, zoom, bbox }
}

const PARIS = view('2.30,48.84,2.40,48.88', 14)
/** Contenue dans PARIS (zoom avant). */
const PARIS_DEDANS = view('2.32,48.85,2.38,48.87', 15)
/** Déborde de PARIS vers le nord-est. */
const PARIS_DECALE = view('2.35,48.86,2.45,48.90', 14)
const LYON = view('4.80,45.74,4.88,45.78', 14)

const names = (search: ReturnType<typeof usePlacesSearch>) => search.places.value.map(p => p.name)

describe('usePlacesSearch', () => {
  describe('requête', () => {
    it('appelle /api/places avec { bbox, zoom } et un zoom arrondi à l\'entier', async () => {
      fetchMock.mockResolvedValue(placesResponse([]))
      const search = usePlacesSearch()

      await search.fetchPlaces({ ...PARIS, zoom: 13.6 })
      await search.fetchPlaces({ ...PARIS, zoom: 12.4 })

      expect(fetchMock.mock.calls[0]![0]).toBe('/api/places')
      expect(fetchMock.mock.calls[0]![1].query).toEqual({ bbox: PARIS.bbox, zoom: 14 })
      expect(fetchMock.mock.calls[1]![1].query).toEqual({ bbox: PARIS.bbox, zoom: 12 })
    })

    it('remplit places et loadedView, recopie stale / zoomTooLow / truncated / incomplete', async () => {
      fetchMock.mockResolvedValueOnce(placesResponse([makePlace({ id: 'osm:node:1', name: 'Parc Monceau' })], {
        stale: true, zoomTooLow: true, truncated: true,
      }))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS)

      expect(names(search)).toEqual(['Parc Monceau'])
      expect(search.loadedView.value).toEqual(PARIS)
      expect(search.stale.value).toBe(true)
      expect(search.zoomTooLow.value).toBe(true)
      expect(search.truncated.value).toBe(true)
      expect(search.incomplete.value).toBe(false)
    })

    it('remet les drapeaux à faux quand la réponse suivante est normale', async () => {
      fetchMock
        .mockResolvedValueOnce(placesResponse([], { stale: true, zoomTooLow: true, truncated: true }))
        .mockResolvedValueOnce(placesResponse([]))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS)
      await search.fetchPlaces(LYON)

      expect([search.stale.value, search.zoomTooLow.value, search.truncated.value]).toEqual([false, false, false])
    })

    it('recopie outsideCoverage et le remet à faux quand le champ est absent de la réponse suivante', async () => {
      fetchMock
        .mockResolvedValueOnce(placesResponse([], { outsideCoverage: true }))
        .mockResolvedValueOnce(placesResponse([]))
      const search = usePlacesSearch()
      expect(search.outsideCoverage.value).toBe(false)

      await search.fetchPlaces(view('-0.20,51.48,-0.05,51.53', 14))
      expect(search.outsideCoverage.value).toBe(true)

      await search.fetchPlaces(PARIS)
      expect(search.outsideCoverage.value).toBe(false)
    })
  })

  describe('requêtes concurrentes', () => {
    it('la dernière requête gagne, même si l\'ancienne répond après', async () => {
      const first = deferred<PlacesResponse>()
      const second = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS)
      const p2 = search.fetchPlaces(LYON)
      second.resolve(placesResponse([makePlace({ id: 'osm:node:2', name: 'Récent' })]))
      await p2
      first.resolve(placesResponse([makePlace({ id: 'osm:node:1', name: 'Ancien' })], { stale: true }))
      await p1

      expect(names(search)).toEqual(['Récent'])
      expect(search.loadedView.value).toEqual(LYON)
      expect(search.stale.value).toBe(false)
    })

    it('ignore l\'erreur d\'une requête plus ancienne', async () => {
      const first = deferred<PlacesResponse>()
      const second = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS)
      const p2 = search.fetchPlaces(LYON)
      second.resolve(placesResponse([makePlace({ id: 'osm:node:2', name: 'Récent' })]))
      await p2
      first.reject(new Error('aborted'))
      await p1

      expect(search.searchError.value).toBeNull()
      expect(names(search)).toEqual(['Récent'])
    })

    it('annule le signal de la requête précédente', async () => {
      const first = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(placesResponse([]))
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS)
      await search.fetchPlaces(LYON)

      expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
      expect(fetchMock.mock.calls[1]![1].signal.aborted).toBe(false)
      first.resolve(placesResponse([]))
      await p1
    })

    it('ne repasse fetching à false qu\'à la fin de la dernière requête', async () => {
      const first = deferred<PlacesResponse>()
      const second = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const search = usePlacesSearch()

      expect(search.fetching.value).toBe(false)
      const p1 = search.fetchPlaces(PARIS)
      const p2 = search.fetchPlaces(LYON)
      expect(search.fetching.value).toBe(true)

      first.resolve(placesResponse([]))
      await p1
      expect(search.fetching.value).toBe(true)

      second.resolve(placesResponse([]))
      await p2
      expect(search.fetching.value).toBe(false)
    })
  })

  describe('réponses incomplete', () => {
    it(`relance la même requête, au plus ${MAX_INCOMPLETE_RETRIES} fois`, async () => {
      expect(MAX_INCOMPLETE_RETRIES).toBe(3)
      fetchMock.mockResolvedValue(placesResponse([makePlace({ id: 'osm:node:1', name: 'Partiel' })], { incomplete: true }))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS)

      expect(fetchMock).toHaveBeenCalledTimes(1 + MAX_INCOMPLETE_RETRIES)
      for (const [, options] of fetchMock.mock.calls) expect(options.query).toEqual({ bbox: PARIS.bbox, zoom: 14 })
      expect(search.incomplete.value).toBe(true)
      expect(names(search)).toEqual(['Partiel'])
      expect(search.fetching.value).toBe(false)
    })

    it('s\'arrête dès qu\'une réponse est complète', async () => {
      fetchMock
        .mockResolvedValueOnce(placesResponse([makePlace({ id: 'osm:node:1', name: 'A' })], { incomplete: true }))
        .mockResolvedValueOnce(placesResponse([makePlace({ id: 'osm:node:1', name: 'A' }), makePlace({ id: 'osm:node:2', name: 'B' })]))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(search.incomplete.value).toBe(false)
      expect(names(search)).toEqual(['A', 'B'])
    })

    it('affiche les lieux déjà reçus pendant la relance', async () => {
      const relance = deferred<PlacesResponse>()
      fetchMock
        .mockResolvedValueOnce(placesResponse([makePlace({ id: 'osm:node:1', name: 'Déjà là' })], { incomplete: true }))
        .mockReturnValueOnce(relance.promise)
      const search = usePlacesSearch()

      const pending = search.fetchPlaces(PARIS)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

      expect(names(search)).toEqual(['Déjà là'])
      expect(search.fetching.value).toBe(true)
      relance.resolve(placesResponse([]))
      await pending
    })

    it('abandonne les relances quand une nouvelle requête part', async () => {
      const relance = deferred<PlacesResponse>()
      fetchMock
        .mockResolvedValueOnce(placesResponse([], { incomplete: true }))
        .mockReturnValueOnce(relance.promise)
        .mockResolvedValueOnce(placesResponse([makePlace({ id: 'osm:node:9', name: 'Lyon' })]))
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      await search.fetchPlaces(LYON)
      expect(fetchMock.mock.calls[1]![1].signal.aborted).toBe(true)

      relance.resolve(placesResponse([], { incomplete: true }))
      await p1

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[2]![1].query.bbox).toBe(LYON.bbox)
      expect(names(search)).toEqual(['Lyon'])
      expect(search.incomplete.value).toBe(false)
      expect(search.loadedView.value).toEqual(LYON)
    })
  })

  describe('erreurs et retry', () => {
    it('remplit searchError avec le message de l\'API sans lever d\'exception', async () => {
      fetchMock.mockRejectedValueOnce({ statusCode: 503, statusMessage: 'Le service de cartes est saturé, réessayez dans quelques instants' })
      const search = usePlacesSearch()

      await expect(search.fetchPlaces(PARIS)).resolves.toBeUndefined()

      expect(search.searchError.value).toBe('Le service de cartes est saturé, réessayez dans quelques instants')
      expect(search.fetching.value).toBe(false)
      expect(search.places.value).toEqual([])
    })

    it('utilise le message de repli pour une erreur réseau', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS)

      expect(search.searchError.value).toBe('Impossible de charger les lieux.')
    })

    it('retry() rejoue la dernière vue et efface l\'erreur', async () => {
      fetchMock
        .mockResolvedValueOnce(placesResponse([]))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(placesResponse([makePlace({ id: 'osm:node:1', name: 'Parc de la Tête d\'Or' })]))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS)
      await search.fetchPlaces(LYON)
      expect(search.searchError.value).toBe('Impossible de charger les lieux.')
      await search.retry()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[2]![1].query).toEqual({ bbox: LYON.bbox, zoom: 14 })
      expect(search.searchError.value).toBeNull()
      expect(names(search)).toEqual(['Parc de la Tête d\'Or'])
    })

    it('retry() sans recherche préalable ne fait rien', async () => {
      const search = usePlacesSearch()
      await search.retry()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('shouldShowSearchHere', () => {
    it('renvoie false tant que rien n\'est chargé, ou sans vue', async () => {
      const search = usePlacesSearch()
      expect(search.shouldShowSearchHere(PARIS)).toBe(false)

      fetchMock.mockResolvedValueOnce(placesResponse([]))
      await search.fetchPlaces(PARIS)
      expect(search.shouldShowSearchHere(null)).toBe(false)
    })

    it('false si la vue reste dans l\'emprise chargée, true si elle en sort', async () => {
      fetchMock.mockResolvedValueOnce(placesResponse([]))
      const search = usePlacesSearch()
      await search.fetchPlaces(PARIS)

      expect(search.shouldShowSearchHere(PARIS)).toBe(false)
      expect(search.shouldShowSearchHere(PARIS_DEDANS)).toBe(false)
      expect(search.shouldShowSearchHere(PARIS_DECALE)).toBe(true)
      expect(search.shouldShowSearchHere(LYON)).toBe(true)
    })

    it('après zoomTooLow : true dès qu\'on zoome, même dans l\'emprise', async () => {
      const large = view('2.0,48.6,2.7,49.1', 10)
      fetchMock.mockResolvedValueOnce(placesResponse([], { zoomTooLow: true }))
      const search = usePlacesSearch()
      await search.fetchPlaces(large)

      expect(search.shouldShowSearchHere(large)).toBe(false)
      expect(search.shouldShowSearchHere(view('2.2,48.7,2.5,49.0', 10))).toBe(false)
      expect(search.shouldShowSearchHere(view('2.2,48.7,2.5,49.0', 11))).toBe(true)
    })

    it('après truncated : true dès qu\'on zoome', async () => {
      fetchMock.mockResolvedValueOnce(placesResponse([], { truncated: true }))
      const search = usePlacesSearch()
      await search.fetchPlaces(PARIS)

      expect(search.shouldShowSearchHere(PARIS_DEDANS)).toBe(true)
    })

    it('sans zoomTooLow ni truncated, zoomer dans l\'emprise ne propose rien', async () => {
      fetchMock.mockResolvedValueOnce(placesResponse([]))
      const search = usePlacesSearch()
      await search.fetchPlaces(PARIS)

      expect(search.shouldShowSearchHere({ ...PARIS_DEDANS, zoom: 17 })).toBe(false)
    })
  })
})
