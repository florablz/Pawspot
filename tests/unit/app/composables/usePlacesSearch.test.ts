import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PawspotPlace } from '~/types/places'
import { getApiErrorMessage } from '~/utils/apiError'
import { usePlacesSearch } from '~/composables/usePlacesSearch'

interface FetchOptions {
  query: { lat: number, lon: number, radius: number }
  signal: AbortSignal
}
type PlacesResponse = { places: PawspotPlace[] }

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

function place(id: string, name: string): PawspotPlace {
  return { id, name, lat: 48.8566, lon: 2.3522, category: 'park' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const PARIS = { lat: 48.8566, lng: 2.3522 }
// ~500 m de PARIS : sous le seuil de réutilisation (~1 km).
const PARIS_PROCHE = { lat: 48.8606, lng: 2.3552 }
// ~2,5 km de PARIS : au-delà du seuil.
const PARIS_LOIN = { lat: 48.8766, lng: 2.3672 }

describe('usePlacesSearch', () => {
  describe('requêtes concurrentes', () => {
    it('n\'écrase pas la réponse la plus récente par une réponse plus ancienne', async () => {
      const first = deferred<PlacesResponse>()
      const second = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS.lat, PARIS.lng)
      const p2 = search.fetchPlaces(PARIS_LOIN.lat, PARIS_LOIN.lng)
      second.resolve({ places: [place('node-2', 'Récent')] })
      await p2
      first.resolve({ places: [place('node-1', 'Ancien')] })
      await p1

      expect(search.places.value.map(p => p.name)).toEqual(['Récent'])
      expect(search.searchCenter.value).toEqual(PARIS_LOIN)
    })

    it('ignore l\'erreur d\'une requête plus ancienne', async () => {
      const first = deferred<PlacesResponse>()
      const second = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS.lat, PARIS.lng)
      const p2 = search.fetchPlaces(PARIS_LOIN.lat, PARIS_LOIN.lng)
      second.resolve({ places: [place('node-2', 'Récent')] })
      await p2
      first.reject(new Error('aborted'))
      await p1

      expect(search.searchError.value).toBeNull()
      expect(search.places.value.map(p => p.name)).toEqual(['Récent'])
    })

    it('annule le signal de la requête précédente', async () => {
      const first = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ places: [] })
      const search = usePlacesSearch()

      const p1 = search.fetchPlaces(PARIS.lat, PARIS.lng)
      await search.fetchPlaces(PARIS_LOIN.lat, PARIS_LOIN.lng)

      expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
      expect(fetchMock.mock.calls[1]![1].signal.aborted).toBe(false)
      first.resolve({ places: [] })
      await p1
    })

    it('ne repasse fetching à false qu\'à la fin de la dernière requête', async () => {
      const first = deferred<PlacesResponse>()
      const second = deferred<PlacesResponse>()
      fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const search = usePlacesSearch()

      expect(search.fetching.value).toBe(false)
      const p1 = search.fetchPlaces(PARIS.lat, PARIS.lng)
      const p2 = search.fetchPlaces(PARIS_LOIN.lat, PARIS_LOIN.lng)
      expect(search.fetching.value).toBe(true)

      first.resolve({ places: [] })
      await p1
      expect(search.fetching.value).toBe(true)

      second.resolve({ places: [] })
      await p2
      expect(search.fetching.value).toBe(false)
    })
  })

  describe('erreurs et retry', () => {
    it('remplit searchError avec le message de l\'API sans lever d\'exception', async () => {
      fetchMock.mockRejectedValueOnce({ statusCode: 503, statusMessage: 'Le service de cartes est saturé, réessayez dans quelques instants' })
      const search = usePlacesSearch()

      await expect(search.fetchPlaces(PARIS.lat, PARIS.lng)).resolves.toBeUndefined()

      expect(search.searchError.value).toBe('Le service de cartes est saturé, réessayez dans quelques instants')
      expect(search.fetching.value).toBe(false)
      expect(search.places.value).toEqual([])
    })

    it('utilise le message de repli pour une erreur réseau', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS.lat, PARIS.lng)

      expect(search.searchError.value).toBe('Impossible de charger les lieux.')
    })

    it('retry() rejoue la dernière recherche autour d\'un point et efface l\'erreur', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ places: [place('node-1', 'Parc Monceau')] })
      const search = usePlacesSearch()

      await search.fetchPlaces(PARIS.lat, PARIS.lng, 2000)
      await search.retry()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]![1].query).toEqual({ lat: PARIS.lat, lon: PARIS.lng, radius: 2000 })
      expect(search.searchError.value).toBeNull()
      expect(search.places.value.map(p => p.name)).toEqual(['Parc Monceau'])
    })

    it('retry() rejoue la dernière recherche par nom', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ places: [place('node-1', 'Café de Flore'), place('node-2', 'Parc Monceau')] })
      const search = usePlacesSearch()

      await search.searchByName('flore', PARIS.lat, PARIS.lng)
      expect(search.searchError.value).toBe('Impossible de charger les lieux.')
      await search.retry()

      expect(fetchMock.mock.calls[1]![1].query).toEqual({ lat: PARIS.lat, lon: PARIS.lng, radius: 15000 })
      expect(search.places.value.map(p => p.name)).toEqual(['Café de Flore'])
    })

    it('retry() sans recherche préalable ne fait rien', async () => {
      const search = usePlacesSearch()
      await search.retry()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('recherche par nom', () => {
    const POOL = [place('node-1', 'Café de Flore'), place('node-2', 'Parc Monceau'), place('node-3', 'Bar du Parc')]

    it('filtre sans tenir compte de la casse, dans un rayon de 15 km', async () => {
      fetchMock.mockResolvedValueOnce({ places: POOL })
      const search = usePlacesSearch()

      await search.searchByName('PARC', PARIS.lat, PARIS.lng)

      expect(fetchMock.mock.calls[0]![1].query.radius).toBe(15000)
      expect(search.places.value.map(p => p.name)).toEqual(['Parc Monceau', 'Bar du Parc'])
    })

    it('ne fait qu\'un appel réseau pour des recherches successives à moins de 1 km', async () => {
      fetchMock.mockResolvedValueOnce({ places: POOL })
      const search = usePlacesSearch()

      await search.searchByName('parc', PARIS.lat, PARIS.lng)
      await search.searchByName('flore', PARIS_PROCHE.lat, PARIS_PROCHE.lng)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(search.places.value.map(p => p.name)).toEqual(['Café de Flore'])
      expect(search.fetching.value).toBe(false)
    })

    it('relance un appel réseau au-delà de 1 km', async () => {
      fetchMock
        .mockResolvedValueOnce({ places: POOL })
        .mockResolvedValueOnce({ places: [place('node-9', 'Parc des Buttes-Chaumont')] })
      const search = usePlacesSearch()

      await search.searchByName('parc', PARIS.lat, PARIS.lng)
      await search.searchByName('parc', PARIS_LOIN.lat, PARIS_LOIN.lng)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(search.places.value.map(p => p.name)).toEqual(['Parc des Buttes-Chaumont'])
    })

    it('un résultat local annule une requête en cours plus ancienne', async () => {
      const pending = deferred<PlacesResponse>()
      fetchMock.mockResolvedValueOnce({ places: POOL }).mockReturnValueOnce(pending.promise)
      const search = usePlacesSearch()

      await search.searchByName('parc', PARIS.lat, PARIS.lng)
      const slow = search.fetchPlaces(PARIS_LOIN.lat, PARIS_LOIN.lng)
      expect(search.fetching.value).toBe(true)
      await search.searchByName('flore', PARIS.lat, PARIS.lng)

      expect(search.fetching.value).toBe(false)
      pending.resolve({ places: [place('node-9', 'Lointain')] })
      await slow
      expect(search.places.value.map(p => p.name)).toEqual(['Café de Flore'])
      expect(search.fetching.value).toBe(false)
    })
  })

  describe('shouldShowSearchHere', () => {
    it('renvoie false tant qu\'aucune recherche n\'a abouti', () => {
      const search = usePlacesSearch()
      expect(search.shouldShowSearchHere(PARIS)).toBe(false)
    })

    it('renvoie true seulement quand la carte s\'est éloignée du centre de recherche', async () => {
      fetchMock.mockResolvedValueOnce({ places: [] })
      const search = usePlacesSearch()
      await search.fetchPlaces(PARIS.lat, PARIS.lng)

      expect(search.shouldShowSearchHere(null)).toBe(false)
      expect(search.shouldShowSearchHere({ lat: PARIS.lat + 0.001, lng: PARIS.lng })).toBe(false)
      expect(search.shouldShowSearchHere(PARIS_LOIN)).toBe(true)
    })
  })
})
