import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Place } from '#shared/types'
import { PLACE_ZOOM, useMapScreen } from '~/composables/useMapScreen'
import type { MapView, PawspotMapApi } from '~/types/map'
import { parseViewQuery } from '~/utils/mapUrl'
import { makePlace } from '../_helpers'

/**
 * Position de départ de la carte (§4.4) : URL > lieu ouvert > dernière vue de la
 * session > géolocalisation. Tout le reste de l'écran (chargement, filtres) est simulé.
 */
const route = reactive<{ path: string, query: Record<string, string> }>({ path: '/', query: {} })
const latitude = ref<number | null>(null)
const longitude = ref<number | null>(null)
const locationError = ref<string | null>(null)
const getLocation = vi.fn<() => Promise<void>>()
const view = ref<MapView | null>(null)
const settled = ref(false)
const selected = ref<Place | null>(null)
const fetchPlaces = vi.fn()

const map = {
  flyTo: vi.fn(() => true),
  getView: vi.fn<() => MapView | null>(() => null),
  reveal: vi.fn(() => true),
  isVisible: vi.fn(() => false),
  focusMarker: vi.fn(),
}

beforeEach(() => {
  Object.assign(route, { path: '/', query: {} })
  latitude.value = longitude.value = null
  locationError.value = null
  view.value = null
  settled.value = false
  selected.value = null
  vi.clearAllMocks()
  map.getView.mockReturnValue(null)
  map.isVisible.mockReturnValue(false)
  // Géolocalisation acceptée par défaut : Bordeaux.
  getLocation.mockImplementation(async () => {
    latitude.value = 44.8378
    longitude.value = -0.5792
  })

  for (const [name, fn] of Object.entries({ ref, computed, watch, nextTick, onMounted, onBeforeUnmount, parseViewQuery })) vi.stubGlobal(name, fn)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useUserLocation', () => ({ latitude, longitude, loading: ref(false), error: locationError, getLocation }))
  vi.stubGlobal('usePlaces', () => ({
    places: ref([]),
    fetching: ref(false),
    loadedView: ref(null),
    shouldShowSearchHere: () => false,
    fetchPlaces,
  }))
  vi.stubGlobal('useFilters', () => ({ categories: ref([]), confirmedOnly: ref(false), nameQuery: ref(''), filtersActive: ref(false), clearFilters: vi.fn() }))
  vi.stubGlobal('useMapView', () => ({ view, settled }))
  vi.stubGlobal('usePlaceSheet', () => ({ selected, snap: ref('peek'), peekHeight: ref(null), open: vi.fn(), close: vi.fn() }))
  vi.stubGlobal('useMapUrlSync', () => {})
  vi.stubGlobal('filterPlaces', (places: Place[]) => places)
  vi.stubGlobal('matchesMedia', () => false)
  vi.stubGlobal('DESKTOP_QUERY', '(min-width: 1024px)')
  vi.stubGlobal('MIN_PLACES_ZOOM', 11)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

/** Écran monté dans un composant minimal (le composable pose des hooks de cycle de vie). */
function screen() {
  let api!: ReturnType<typeof useMapScreen>
  mount(defineComponent({
    setup() {
      api = useMapScreen(ref(map as unknown as PawspotMapApi))
      return () => h('div')
    },
  }))
  return api
}

const SESSION_VIEW: MapView = { center: { lat: 43.6045, lng: 1.4442 }, zoom: 13, bbox: '1.40,43.58,1.48,43.62' }
const PLACE = makePlace({ id: 'osm:node:42', name: 'Plage du Prado', category: 'beach', lat: 43.2596, lon: 5.3753 })

describe('useMapScreen — position de départ', () => {
  it('URL d\'abord : la vue de l\'URL l\'emporte sur le lieu ouvert et la dernière vue', async () => {
    route.query = { lat: '48.8566', lon: '2.3522', z: '15' }
    view.value = SESSION_VIEW
    selected.value = PLACE
    const s = screen()
    expect(s.startView).toEqual({ lat: 48.8566, lng: 2.3522, zoom: 15 })

    s.onMapReady()
    expect(settled.value).toBe(true)
    await vi.waitFor(() => expect(getLocation).toHaveBeenCalled())
    // La position est demandée (point bleu, itinéraire) sans déplacer la carte.
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(map.reveal).not.toHaveBeenCalled()
  })

  it('lieu ouvert ensuite : sans vue dans l\'URL, la carte se centre sur le lieu', async () => {
    selected.value = PLACE
    const s = screen()
    expect(s.startView).toBeNull()

    s.onMapReady()
    expect(map.reveal).toHaveBeenCalledWith(PLACE.lat, PLACE.lon, expect.any(Object), PLACE_ZOOM)
    expect(settled.value).toBe(true)
    await vi.waitFor(() => expect(getLocation).toHaveBeenCalled())
    expect(map.flyTo).not.toHaveBeenCalled()
  })

  // BUG (front, app/composables/useMapScreen.ts) : `startView` prend la dernière vue de la
  // session avant le lieu ouvert, et `onMapReady` ne montre alors pas le lieu. Sur `/lieu/<id>`
  // sans vue dans l'URL après être déjà passé par la carte, la fiche s'ouvre sur un lieu hors
  // de la carte. Ordre attendu (commentaire du composable) : URL > lieu ouvert > dernière vue.
  it.fails('lieu ouvert avant la dernière vue de la session', () => {
    view.value = SESSION_VIEW
    selected.value = PLACE
    const s = screen()
    s.onMapReady()
    expect(map.reveal).toHaveBeenCalledWith(PLACE.lat, PLACE.lon, expect.any(Object), PLACE_ZOOM)
  })

  it('dernière vue de la session (retour depuis « Mes favoris ») avant la géolocalisation', async () => {
    view.value = SESSION_VIEW
    const s = screen()
    expect(s.startView).toEqual({ lat: 43.6045, lng: 1.4442, zoom: 13 })

    s.onMapReady()
    expect(settled.value).toBe(true)
    await vi.waitFor(() => expect(getLocation).toHaveBeenCalled())
    expect(map.flyTo).not.toHaveBeenCalled()
  })

  it('géolocalisation en dernier : la carte vole vers la position, puis la vue est « posée »', async () => {
    const s = screen()
    expect(s.startView).toBeNull()

    s.onMapReady()
    expect(settled.value).toBe(false)
    await vi.waitFor(() => expect(settled.value).toBe(true))
    expect(map.flyTo).toHaveBeenCalledWith(44.8378, -0.5792, 14)
    expect(s.localized.value).toBe(true)
  })

  it('après la géolocalisation, la fin du vol charge les lieux', async () => {
    const s = screen()
    s.onMapReady()
    await vi.waitFor(() => expect(map.flyTo).toHaveBeenCalled())
    const arrived: MapView = { center: { lat: 44.8378, lng: -0.5792 }, zoom: 14, bbox: '-0.6,44.82,-0.55,44.85' }
    s.onViewChange(arrived)
    expect(fetchPlaces).toHaveBeenCalledWith(arrived)
  })

  it('géolocalisation refusée : pas de déplacement, la vue est quand même posée', async () => {
    getLocation.mockImplementation(async () => {
      locationError.value = 'Géolocalisation refusée.'
      throw new Error('refusée')
    })
    const s = screen()
    s.onMapReady()
    await vi.waitFor(() => expect(settled.value).toBe(true))
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(s.localized.value).toBe(false)
    expect(s.locationMessage.value).toContain('Géolocalisation refusée.')
  })

  it.each([
    ['partielle', { lat: '48.8566', lon: '2.3522' }],
    ['hors bornes', { lat: '95', lon: '2.3522', z: '15' }],
    ['zoom non entier', { lat: '48.8566', lon: '2.3522', z: '12.5' }],
  ])('vue d\'URL %s ignorée : on passe à la suite (géolocalisation)', async (_label, query) => {
    route.query = query
    const s = screen()
    expect(s.startView).toBeNull()
    s.onMapReady()
    await vi.waitFor(() => expect(map.flyTo).toHaveBeenCalled())
  })

  it('l\'URL n\'est lue qu\'une fois, au montage', () => {
    route.query = { lat: '48.8566', lon: '2.3522', z: '15' }
    const s = screen()
    route.query = { lat: '45.764', lon: '4.8357', z: '14' }
    expect(s.startView).toEqual({ lat: 48.8566, lng: 2.3522, zoom: 15 })
  })
})
