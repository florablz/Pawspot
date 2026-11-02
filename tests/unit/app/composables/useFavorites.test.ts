import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Ref } from 'vue'
import { favoriteUrl, useFavorites } from '~/composables/useFavorites'

interface FetchOptions { method?: string, body?: unknown }
const fetchMock = vi.fn<(url: string, options?: FetchOptions) => Promise<unknown>>()

// `useState` de Nuxt : un état partagé par clé, recréé pour chaque test.
let states: Map<string, Ref<unknown>>
function useStateStub<T>(key: string, init: () => T): Ref<T> {
  if (!states.has(key)) states.set(key, ref(init()) as Ref<unknown>)
  return states.get(key) as Ref<T>
}

beforeEach(() => {
  fetchMock.mockReset()
  states = new Map()
  vi.stubGlobal('useState', useStateStub)
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ID = 'osm:node:1'

describe('favoriteUrl', () => {
  it('encode l\'identifiant du lieu', () => {
    expect(favoriteUrl(ID)).toBe('/api/favorites/osm%3Anode%3A1')
    expect(favoriteUrl('user:a/b?c')).toBe('/api/favorites/user%3Aa%2Fb%3Fc')
  })
})

describe('useFavorites', () => {
  it('ajout : POST /api/favorites { placeId } et état local mis à jour', async () => {
    fetchMock.mockResolvedValueOnce({ placeId: ID, favorited: true })
    const favorites = useFavorites()

    await expect(favorites.setFavorite(ID, true)).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/api/favorites', { method: 'POST', body: { placeId: ID } })
    expect(favorites.isFavorited(ID)).toBe(true)
  })

  it('retrait : DELETE sur l\'URL encodée osm%3Anode%3A1', async () => {
    fetchMock
      .mockResolvedValueOnce({ placeId: ID, favorited: true })
      .mockResolvedValueOnce({ placeId: ID, favorited: false })
    const favorites = useFavorites()

    await favorites.setFavorite(ID, true)
    await expect(favorites.setFavorite(ID, false)).resolves.toBe(false)

    expect(fetchMock).toHaveBeenLastCalledWith('/api/favorites/osm%3Anode%3A1', { method: 'DELETE' })
    expect(favorites.isFavorited(ID)).toBe(false)
  })

  it('toggleFavorite alterne POST puis DELETE', async () => {
    fetchMock
      .mockResolvedValueOnce({ placeId: ID, favorited: true })
      .mockResolvedValueOnce({ placeId: ID, favorited: false })
    const favorites = useFavorites()

    await favorites.toggleFavorite(ID)
    await favorites.toggleFavorite(ID)

    expect(fetchMock.mock.calls.map(([url, o]) => `${o?.method} ${url}`))
      .toEqual(['POST /api/favorites', 'DELETE /api/favorites/osm%3Anode%3A1'])
  })

  it('suit la réponse du serveur plutôt que la demande', async () => {
    fetchMock.mockResolvedValueOnce({ placeId: ID, favorited: false })
    const favorites = useFavorites()

    await expect(favorites.setFavorite(ID, true)).resolves.toBe(false)
    expect(favorites.isFavorited(ID)).toBe(false)
  })

  it('état partagé entre deux appels du composable, nouvel ensemble à chaque changement', async () => {
    fetchMock.mockResolvedValueOnce({ placeId: ID, favorited: true })
    const a = useFavorites()
    const b = useFavorites()
    const before = a.favoritedIds.value

    await a.setFavorite(ID, true)

    expect(b.isFavorited(ID)).toBe(true)
    expect(a.favoritedIds.value).not.toBe(before)
  })

  it('erreur de l\'API : relevée, état local inchangé', async () => {
    const apiError = { statusCode: 401, data: { message: 'Non authentifié' } }
    fetchMock.mockRejectedValueOnce(apiError)
    const favorites = useFavorites()

    await expect(favorites.setFavorite(ID, true)).rejects.toBe(apiError)
    expect(favorites.isFavorited(ID)).toBe(false)
  })

  it('checkFavorite : GET encodé ; une erreur garde l\'état actuel', async () => {
    fetchMock
      .mockResolvedValueOnce({ favorited: true })
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    const favorites = useFavorites()

    await favorites.checkFavorite(ID)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/favorites/check/osm%3Anode%3A1')
    expect(favorites.isFavorited(ID)).toBe(true)

    await expect(favorites.checkFavorite(ID)).resolves.toBeUndefined()
    expect(favorites.isFavorited(ID)).toBe(true)
  })
})
