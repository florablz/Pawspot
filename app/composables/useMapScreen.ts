import type { GeocodeResult, Place } from '#shared/types'
import type { MapInsets, MapStartView, MapView, PawspotMapApi } from '~/types/map'

/** Zoom d'un lieu ouvert depuis une URL sans vue (`/lieu/<id>` seul). */
export const PLACE_ZOOM = 16
/** Largeur du panneau latéral desktop + marge (px). */
const SIDE_PANEL_INSET = 416
/** Si la carte ne bouge pas après une recherche (même vue), on charge quand même (ms). */
const SEARCH_LOAD_FALLBACK_MS = 1500

/**
 * Logique de l'écran carte (layout `map`) : position de départ (URL > lieu
 * ouvert > dernière vue > géolocalisation), chargement des lieux, filtres,
 * fiche ouverte, URL. La page n'a plus que l'affichage.
 */
export function useMapScreen(mapRef: Ref<PawspotMapApi | null>) {
  const route = useRoute()
  const { latitude, longitude, loading: locating, error: locationError, getLocation } = useUserLocation()
  const places = usePlaces()
  const filters = useFilters()
  const { view, settled } = useMapView()
  const sheet = usePlaceSheet()
  useMapUrlSync()

  const localized = ref(false)
  /** Charger les lieux à la prochaine fin de déplacement (après un déplacement programmé). */
  let loadOnNextView = false

  // Lue une fois : l'URL a priorité, puis la dernière vue (retour depuis « Mes favoris »).
  const urlView = parseViewQuery(route.query)
  const startView: MapStartView | null = urlView
    ?? (view.value ? { lat: view.value.center.lat, lng: view.value.center.lng, zoom: view.value.zoom } : null)

  const userPosition = computed(() =>
    latitude.value != null && longitude.value != null ? { lat: latitude.value, lng: longitude.value } : null,
  )

  const filteredPlaces = computed(() => filterPlaces(places.places.value, {
    categories: filters.categories.value,
    confirmedOnly: filters.confirmedOnly.value,
  }))

  /** Le lieu ouvert reste sur la carte même s'il est filtré, fermé ou hors de la zone chargée. */
  const mapPlaces = computed(() => {
    const sel = sheet.selected.value
    const list = filteredPlaces.value
    return sel && !list.some(p => p.id === sel.id) ? [...list, sel] : list
  })

  const showSearchHere = computed(() => !places.fetching.value && places.shouldShowSearchHere(view.value))

  /** Géolocalisation impossible et rien de chargé : inviter à chercher une ville (vue France entière). */
  const locationMessage = computed(() => {
    if (!locationError.value || places.loadedView.value || places.fetching.value) return null
    return `${locationError.value} Cherchez votre ville ou une adresse dans la barre de recherche, ou zoomez sur la carte.`
  })

  let searchFallback: ReturnType<typeof setTimeout> | undefined

  function onViewChange(v: MapView) {
    view.value = v
    clearTimeout(searchFallback)
    if (loadOnNextView || (!places.loadedView.value && !places.fetching.value && v.zoom >= MIN_PLACES_ZOOM)) {
      loadOnNextView = false
      places.fetchPlaces(v)
    }
  }

  /** Partie de la carte cachée par la fiche (bas sur mobile, droite sur desktop). */
  function sheetInsets(): MapInsets {
    if (!sheet.selected.value) return { bottom: 0, right: 0 }
    if (matchesMedia(DESKTOP_QUERY)) return { bottom: 0, right: SIDE_PANEL_INSET }
    // Même règle que la fiche : aperçu borné entre 30 % et 60 % de la hauteur.
    const h = window.innerHeight
    const peek = sheet.peekHeight.value ?? h * 0.4
    return { bottom: Math.round(Math.min(Math.max(peek, h * 0.3), h * 0.6)), right: 0 }
  }

  /** Lieu ouvert hors de la vue (URL, « Retour ») : on centre dessus ; sinon on le dégage de sous la fiche. */
  function revealPlace(place: Place) {
    const map = mapRef.value
    if (!map) return
    const insets = sheetInsets()
    const current = map.getView()
    const far = !current || current.zoom < MIN_PLACES_ZOOM || !map.isVisible(place.lat, place.lon, insets)
    if (far) loadOnNextView = true
    map.reveal(place.lat, place.lon, insets, far ? Math.max(current?.zoom ?? 0, PLACE_ZOOM) : undefined)
  }

  /** `move` : déplacer la carte sur la position (faux si l'URL ou une fiche fixe déjà la vue). */
  async function locateMe(move = true) {
    try {
      await getLocation()
      localized.value = true
      if (!move || latitude.value == null || longitude.value == null) return
      loadOnNextView = true
      mapRef.value?.flyTo(latitude.value, longitude.value, 14)
    }
    catch {
      localized.value = false
    }
    finally {
      settled.value = true
    }
  }

  function onMapReady() {
    const sel = sheet.selected.value
    if (startView) {
      settled.value = true
      locateMe(false)
    }
    else if (sel) {
      revealPlace(sel)
      settled.value = true
      locateMe(false)
    }
    else {
      locateMe(true)
    }
  }

  /**
   * Adresse ou ville choisie dans la recherche : la fiche ouverte se ferme, la
   * carte cadre la zone (emprise, sinon zoom selon le type) puis charge les lieux.
   */
  function goToResult(result: GeocodeResult) {
    const map = mapRef.value
    if (!map) return
    if (sheet.selected.value) sheet.close()
    loadOnNextView = true
    settled.value = true
    map.showArea({
      lat: result.lat,
      lng: result.lon,
      bbox: result.bbox,
      maxZoom: GEOCODE_ZOOM[result.type],
      minZoom: geocodeMinZoom(result.type),
    }, { bottom: 0, right: 0 })
    // Vue identique (même recherche deux fois) : pas de `moveend`, on charge quand même.
    clearTimeout(searchFallback)
    searchFallback = setTimeout(() => {
      if (!loadOnNextView) return
      loadOnNextView = false
      const v = map.getView()
      if (v) places.fetchPlaces(v)
    }, SEARCH_LOAD_FALLBACK_MS)
  }

  onBeforeUnmount(() => clearTimeout(searchFallback))

  function searchHere() {
    if (view.value) places.fetchPlaces(view.value)
  }

  watch(() => sheet.selected.value?.id, (id, prev) => {
    if (id && sheet.selected.value) {
      nextTick(() => sheet.selected.value && revealPlace(sheet.selected.value))
    }
    else if (prev) {
      // Fiche fermée : focus rendu au marqueur, sauf si l'utilisateur est déjà ailleurs.
      nextTick(() => {
        const active = document.activeElement
        if (!active || active === document.body) mapRef.value?.focusMarker(prev)
      })
    }
  })

  return {
    ...places,
    ...filters,
    sheet,
    startView,
    localized,
    locating,
    userPosition,
    latitude,
    longitude,
    filteredPlaces,
    mapPlaces,
    showSearchHere,
    locationMessage,
    onViewChange,
    onMapReady,
    locateMe,
    goToResult,
    searchHere,
  }
}
