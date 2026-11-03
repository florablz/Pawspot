import { parseBbox, type Bbox } from '#shared/geo'
import type { Place, PlacesResponse } from '#shared/types'
import type { MapView } from '~/types/map'

/** En dessous de ce zoom, le serveur ne rafraîchit pas les lieux (`zoomTooLow`). */
export const MIN_PLACES_ZOOM = 11
/** Nombre maximal de relances automatiques quand la réponse est `incomplete`. */
export const MAX_INCOMPLETE_RETRIES = 3

/** Tolérance (degrés) pour considérer qu'une emprise est contenue dans une autre. */
const BBOX_EPSILON = 1e-6

function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return inner.minLon >= outer.minLon - BBOX_EPSILON
    && inner.minLat >= outer.minLat - BBOX_EPSILON
    && inner.maxLon <= outer.maxLon + BBOX_EPSILON
    && inner.maxLat <= outer.maxLat + BBOX_EPSILON
}

/**
 * Chargement des lieux par emprise (`GET /api/places?bbox=…&zoom=…`).
 * Seule la dernière requête lancée écrit le résultat ; une réponse `incomplete`
 * est relancée automatiquement (au plus `MAX_INCOMPLETE_RETRIES` fois).
 */
export const usePlacesSearch = () => {
  const places = ref<Place[]>([])
  const fetching = ref(false)
  const searchError = ref<string | null>(null)
  const stale = ref(false)
  const zoomTooLow = ref(false)
  /** L'emprise ne touche aucun territoire français (lieux lus en cache seulement). */
  const outsideCoverage = ref(false)
  const truncated = ref(false)
  const incomplete = ref(false)
  /** Vue de la carte des derniers lieux affichés (`null` tant que rien n'est chargé). */
  const loadedView = ref<MapView | null>(null)

  let latestRequest = 0
  let controller: AbortController | null = null
  let lastView: MapView | null = null

  function apply(data: PlacesResponse, view: MapView) {
    places.value = data.places
    stale.value = data.stale
    zoomTooLow.value = data.zoomTooLow
    outsideCoverage.value = data.outsideCoverage === true
    truncated.value = data.truncated
    incomplete.value = data.incomplete
    loadedView.value = view
  }

  async function fetchPlaces(view: MapView) {
    lastView = view
    const id = ++latestRequest
    controller?.abort()
    const current = new AbortController()
    controller = current
    fetching.value = true
    searchError.value = null
    const query = { bbox: view.bbox, zoom: Math.round(view.zoom) }
    try {
      for (let attempt = 0; ; attempt++) {
        const data = await $fetch<PlacesResponse>('/api/places', { query, signal: current.signal })
        if (id !== latestRequest) return
        // Les lieux déjà reçus s'affichent pendant la relance.
        apply(data, view)
        if (!data.incomplete || attempt >= MAX_INCOMPLETE_RETRIES) break
      }
    }
    catch (err: unknown) {
      if (id !== latestRequest) return
      searchError.value = getApiErrorMessage(err, 'Impossible de charger les lieux.')
    }
    finally {
      if (id === latestRequest) fetching.value = false
    }
  }

  async function retry() {
    if (lastView) await fetchPlaces(lastView)
  }

  /**
   * Faut-il proposer « Rechercher dans cette zone » ? Oui si la vue sort de
   * l'emprise chargée, ou si l'on a zoomé alors que la réponse précédente
   * était limitée (`zoomTooLow` / `truncated`).
   */
  function shouldShowSearchHere(view: MapView | null): boolean {
    const loaded = loadedView.value
    if (!view || !loaded) return false
    if ((zoomTooLow.value || truncated.value) && view.zoom > loaded.zoom) return true
    const outer = parseBbox(loaded.bbox)
    const inner = parseBbox(view.bbox)
    if (!outer || !inner) return view.bbox !== loaded.bbox
    return !bboxContains(outer, inner)
  }

  return {
    places,
    fetching,
    searchError,
    stale,
    zoomTooLow,
    outsideCoverage,
    truncated,
    incomplete,
    loadedView,
    fetchPlaces,
    retry,
    shouldShowSearchHere,
  }
}
