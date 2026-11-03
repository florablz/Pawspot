import { normalizeName } from '#shared/text'
import type { GeocodeResponse, GeocodeResult } from '#shared/types'

/** Attente après la dernière frappe avant d'appeler `/api/geocode` (ms). */
export const GEOCODE_DEBOUNCE_MS = 300
/** Réponses gardées en mémoire (retaper « Lyon » ne refait pas d'appel). */
const MEMORY_CACHE_SIZE = 30

/**
 * - `idle` : rien à chercher ;
 * - `pending` : frappe en cours (debounce) ou requête partie ;
 * - `done` : `results` correspond à la recherche courante ;
 * - `error` : message de l'API (503 compris) dans `error` ;
 * - `offline` : pas de réseau.
 */
export type GeocodeStatus = 'idle' | 'pending' | 'done' | 'error' | 'offline'

export const GEOCODE_OFFLINE_MESSAGE = 'Vous êtes hors ligne : la recherche d\'adresses reviendra avec la connexion. Les lieux déjà affichés restent cherchables.'
const GEOCODE_ERROR_FALLBACK = 'La recherche d\'adresses a échoué. Réessayez dans quelques instants.'

function isOffline(): boolean {
  return import.meta.client && typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Recherche d'adresses et de villes (`GET /api/geocode?q=`) pendant la frappe :
 * debounce de 300 ms, rien sous 2 caractères, la requête précédente est annulée
 * et seule la dernière écrit le résultat. Le texte cherché n'est jamais mis dans l'URL.
 */
export function useGeocode() {
  const results = ref<GeocodeResult[]>([])
  const status = ref<GeocodeStatus>('idle')
  const error = ref<string | null>(null)

  const memory = new Map<string, GeocodeResult[]>()
  let query = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null
  let running: Promise<void> | null = null
  let latest = 0

  function remember(key: string, value: GeocodeResult[]) {
    memory.delete(key)
    memory.set(key, value)
    if (memory.size > MEMORY_CACHE_SIZE) memory.delete(memory.keys().next().value!)
  }

  function cancel() {
    clearTimeout(timer)
    timer = undefined
    controller?.abort()
    controller = null
    running = null
    latest++
  }

  async function run(q: string): Promise<void> {
    timer = undefined
    const id = ++latest
    controller?.abort()
    const current = new AbortController()
    controller = current
    if (isOffline()) {
      status.value = 'offline'
      return
    }
    try {
      const data = await $fetch<GeocodeResponse>('/api/geocode', {
        query: { q },
        signal: current.signal,
        // Pas de relance automatique d'ofetch sur 503 : le serveur limite déjà à 1 req/s.
        retry: 0,
      })
      if (id !== latest) return
      remember(normalizeName(q), data.results)
      results.value = data.results
      error.value = null
      status.value = 'done'
    }
    catch (err: unknown) {
      if (id !== latest) return
      if (isOffline()) {
        status.value = 'offline'
        return
      }
      results.value = []
      error.value = getApiErrorMessage(err, GEOCODE_ERROR_FALLBACK)
      status.value = 'error'
    }
  }

  /** Nouvelle recherche (à chaque frappe). Les résultats précédents restent affichés pendant l'attente. */
  function search(value: string) {
    query = value.trim().slice(0, SEARCH_MAX_LENGTH)
    cancel()
    if (!isSearchable(query)) {
      results.value = []
      error.value = null
      status.value = 'idle'
      return
    }
    const cached = memory.get(normalizeName(query))
    if (cached) {
      results.value = cached
      error.value = null
      status.value = 'done'
      return
    }
    status.value = 'pending'
    const q = query
    timer = setTimeout(() => {
      running = run(q)
    }, GEOCODE_DEBOUNCE_MS)
  }

  /** Lance tout de suite la recherche en attente (Entrée) et attend sa réponse. */
  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      running = run(query)
    }
    await running
  }

  function retry() {
    if (!isSearchable(query)) return
    cancel()
    status.value = 'pending'
    running = run(query)
  }

  function clear() {
    search('')
  }

  // Retour du réseau : on relance la recherche restée en plan.
  const onOnline = () => {
    if (status.value === 'offline') retry()
  }
  onMounted(() => window.addEventListener('online', onOnline))
  onBeforeUnmount(() => {
    window.removeEventListener('online', onOnline)
    cancel()
  })

  return { results, status, error, search, flush, retry, clear }
}
