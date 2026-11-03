import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GeocodeResponse } from '#shared/types'
import { GEOCODE_DEBOUNCE_MS, GEOCODE_OFFLINE_MESSAGE, useGeocode } from '~/composables/useGeocode'
import { getApiErrorMessage } from '~/utils/apiError'
import { isSearchable, SEARCH_MAX_LENGTH } from '~/utils/searchSuggestions'
import { GEOCODE_LYON, GEOCODE_RIVOLI } from '../_geocode'
import { deferred } from '../_helpers'

/**
 * Recherche d'adresses pendant la frappe (§3.2) : debounce, annulation, cache
 * mémoire, Entrée, erreurs, hors ligne. `$fetch` est simulé, jamais de réseau.
 */
interface FetchOptions {
  query: { q: string }
  signal: AbortSignal
  retry: number
}
const fetchMock = vi.fn<(url: string, options: FetchOptions) => Promise<GeocodeResponse>>()

/** Erreur telle que levée par ofetch pour `apiError(503, …)` côté serveur. */
const UNAVAILABLE = 'Le service de recherche d\'adresses est momentanément indisponible, réessayez dans quelques instants.'
const error503 = () => Object.assign(new Error('[GET] "/api/geocode": 503 Service Unavailable'), {
  statusCode: 503,
  statusMessage: 'Service Unavailable',
  data: { statusCode: 503, message: UNAVAILABLE },
})

let online = true

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  for (const [name, fn] of Object.entries({ ref, onMounted, onBeforeUnmount, getApiErrorMessage, isSearchable })) vi.stubGlobal(name, fn)
  vi.stubGlobal('SEARCH_MAX_LENGTH', SEARCH_MAX_LENGTH)
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

function geocode() {
  let api!: ReturnType<typeof useGeocode>
  mount(defineComponent({
    setup() {
      api = useGeocode()
      return () => h('div')
    },
  }))
  return api
}

const queries = () => fetchMock.mock.calls.map(([, o]) => o.query.q)

describe('useGeocode', () => {
  it(`un seul appel à /api/geocode après ${GEOCODE_DEBOUNCE_MS} ms sans frappe`, async () => {
    fetchMock.mockResolvedValue(GEOCODE_LYON)
    const g = geocode()

    g.search('Ly')
    await vi.advanceTimersByTimeAsync(100)
    g.search('Lyo')
    await vi.advanceTimersByTimeAsync(100)
    g.search('Lyon')
    expect(g.status.value).toBe('pending')
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS - 1)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/geocode')
    expect(queries()).toEqual(['Lyon'])
    expect(g.status.value).toBe('done')
    expect(g.results.value).toEqual(GEOCODE_LYON.results)
    expect(g.error.value).toBeNull()
  })

  it('envoie la saisie sans les espaces aux bords', async () => {
    fetchMock.mockResolvedValue(GEOCODE_LYON)
    const g = geocode()
    g.search('   Lyon  ')
    await vi.runAllTimersAsync()
    expect(queries()).toEqual(['Lyon'])
  })

  it.each([['vide', ''], ['1 caractère', 'L'], ['ponctuation seule', '?!']])('rien sous 2 caractères utiles (%s) : aucun appel, statut idle', async (_l, q) => {
    const g = geocode()
    g.search(q)
    await vi.runAllTimersAsync()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(g.status.value).toBe('idle')
    expect(g.results.value).toEqual([])
  })

  it('effacer la saisie vide les résultats et annule l\'appel en attente', async () => {
    fetchMock.mockResolvedValue(GEOCODE_LYON)
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    g.search('Paris')
    g.clear()
    await vi.runAllTimersAsync()
    expect(queries()).toEqual(['Lyon'])
    expect(g.results.value).toEqual([])
    expect(g.status.value).toBe('idle')
  })

  it('annulation : la requête précédente est abandonnée et seule la dernière réponse compte', async () => {
    const first = deferred<GeocodeResponse>()
    const second = deferred<GeocodeResponse>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const g = geocode()

    g.search('Rivoli')
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
    g.search('Lyon')
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
    expect(queries()).toEqual(['Rivoli', 'Lyon'])
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
    expect(fetchMock.mock.calls[1]![1].signal.aborted).toBe(false)

    second.resolve(GEOCODE_LYON)
    await vi.runAllTimersAsync()
    // Réponse tardive de « Rivoli » : ignorée.
    first.resolve(GEOCODE_RIVOLI)
    await vi.runAllTimersAsync()
    expect(g.results.value).toEqual(GEOCODE_LYON.results)
    expect(g.status.value).toBe('done')
  })

  it('une réponse arrivée après une nouvelle frappe n\'écrase pas l\'attente', async () => {
    const first = deferred<GeocodeResponse>()
    fetchMock.mockReturnValueOnce(first.promise)
    const g = geocode()
    g.search('Rivoli')
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
    g.search('Rivoli 12')
    first.resolve(GEOCODE_RIVOLI)
    await vi.advanceTimersByTimeAsync(0)
    expect(g.status.value).toBe('pending')
    expect(g.results.value).toEqual([])
  })

  it('cache mémoire : retaper une recherche déjà faite (accents, casse) ne rappelle pas l\'API', async () => {
    fetchMock.mockResolvedValueOnce(GEOCODE_LYON).mockResolvedValueOnce(GEOCODE_RIVOLI)
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    g.search('Rivoli')
    await vi.runAllTimersAsync()

    g.search('LYÖN')
    expect(g.status.value).toBe('done')
    expect(g.results.value).toEqual(GEOCODE_LYON.results)
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('flush() (Entrée) lance tout de suite la recherche en attente et attend la réponse', async () => {
    fetchMock.mockResolvedValue(GEOCODE_RIVOLI)
    const g = geocode()
    g.search('12 rue de Rivoli')
    await g.flush()
    expect(queries()).toEqual(['12 rue de Rivoli'])
    expect(g.status.value).toBe('done')
    expect(g.results.value).toEqual(GEOCODE_RIVOLI.results)
    // Le minuteur du debounce ne relance rien ensuite.
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('flush() pendant une requête déjà partie attend cette requête sans en relancer', async () => {
    const pending = deferred<GeocodeResponse>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const g = geocode()
    g.search('Lyon')
    await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
    let flushed = false
    const done = g.flush().then(() => {
      flushed = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(flushed).toBe(false)
    pending.resolve(GEOCODE_LYON)
    await done
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(g.results.value).toEqual(GEOCODE_LYON.results)
  })

  it('503 : statut error avec le message de l\'API, résultats vidés', async () => {
    fetchMock.mockRejectedValue(error503())
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    expect(g.status.value).toBe('error')
    expect(g.error.value).toBe(UNAVAILABLE)
    expect(g.results.value).toEqual([])
  })

  it('erreur sans message : message de repli en français', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    expect(g.status.value).toBe('error')
    expect(g.error.value).toMatch(/recherche d'adresses a échoué/)
  })

  it('aucune relance automatique : retry: 0 et un seul appel après un 503', async () => {
    fetchMock.mockRejectedValue(error503())
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1].retry).toBe(0)
  })

  it('« Réessayer » (retry) relance la même recherche tout de suite', async () => {
    fetchMock.mockRejectedValueOnce(error503()).mockResolvedValueOnce(GEOCODE_LYON)
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    g.retry()
    expect(g.status.value).toBe('pending')
    await vi.advanceTimersByTimeAsync(0)
    expect(queries()).toEqual(['Lyon', 'Lyon'])
    expect(g.status.value).toBe('done')
    expect(g.error.value).toBeNull()
  })

  it('une erreur n\'est pas mise en cache', async () => {
    fetchMock.mockRejectedValueOnce(error503()).mockResolvedValueOnce(GEOCODE_LYON)
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(g.status.value).toBe('done')
  })

  it('hors ligne : aucun appel, statut offline ; l\'événement online relance la recherche', async () => {
    online = false
    fetchMock.mockResolvedValue(GEOCODE_LYON)
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(g.status.value).toBe('offline')
    expect(GEOCODE_OFFLINE_MESSAGE).toMatch(/hors ligne/)

    online = true
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(queries()).toEqual(['Lyon'])
    expect(g.status.value).toBe('done')
    expect(g.results.value).toEqual(GEOCODE_LYON.results)
  })

  it('réseau coupé pendant la requête : statut offline (pas error)', async () => {
    fetchMock.mockImplementation(async () => {
      online = false
      throw new TypeError('Failed to fetch')
    })
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    expect(g.status.value).toBe('offline')
    expect(g.error.value).toBeNull()
  })

  it('l\'événement online ne relance rien si la recherche n\'était pas hors ligne', async () => {
    fetchMock.mockResolvedValue(GEOCODE_LYON)
    const g = geocode()
    g.search('Lyon')
    await vi.runAllTimersAsync()
    window.dispatchEvent(new Event('online'))
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
