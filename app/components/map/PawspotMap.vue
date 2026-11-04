<script setup lang="ts">
import type * as Leaflet from 'leaflet'
import type { Place } from '#shared/types'
import type { MapStartView, MapView, PawspotMapApi } from '~/types/map'

const props = defineProps<{
  /** Position de l'utilisateur (repère orange), ou `null`. */
  latitude: number | null
  longitude: number | null
  places: Place[]
  selectedPlaceId?: string | null
  /** Vue de départ ; sinon position de l'utilisateur si déjà connue, sinon France entière. */
  startView?: MapStartView | null
}>()

const emit = defineEmits<{
  'update:view': [view: MapView]
  'select-place': [place: Place]
  /** L'utilisateur a déplacé ou zoomé la carte lui-même (glisser, molette, boutons, clavier, bulle). */
  'user-move': []
  /** La carte Leaflet est créée (les méthodes exposées fonctionnent). */
  'ready': []
}>()

/** Vue « France entière » (géolocalisation refusée ou en attente). */
const FRANCE_VIEW = { lat: 46.6, lng: 2.4, zoom: 6 }
const USER_ZOOM = 14
/** À partir de ce zoom, chaque lieu a son marqueur (plus de groupes). */
const CLUSTER_OFF_ZOOM = 17
/** Rayon de regroupement (px) : bulles espacées en vue large, plus fines près des rues. */
const clusterRadius = (zoom: number) => (zoom <= 14 ? 80 : 50)
/** Mesure de l'ajout des marqueurs (`performance.getEntriesByName`). */
const MARKERS_MEASURE = 'pawspot:markers'

const config = useRuntimeConfig().public

const mapEl = ref<HTMLElement | null>(null)
let map: Leaflet.Map | null = null
/** Lieux regroupés en bulles ; le lieu sélectionné vit à part (`selectedLayer`), jamais caché. */
let clusterLayer: Leaflet.MarkerClusterGroup | null = null
let selectedLayer: Leaflet.LayerGroup | null = null
/** Marqueurs par id de lieu (focus au clavier, mise à jour du marqueur sélectionné). */
const markers = new Map<string, { marker: Leaflet.Marker, place: Place }>()
let renderedSelectedId: string | null = null
let userMarker: Leaflet.Marker | null = null
let L: typeof Leaflet | null = null
let resizeObserver: ResizeObserver | null = null
let stopWatchingMoves: (() => void) | null = null
const navigation = createMapNavigation(() => map, () => L)

function reducedMotion(): boolean {
  return matchesMedia(REDUCED_MOTION_QUERY)
}

/**
 * Nom + statut chien pour les lecteurs d'écran (le marqueur est focusable au
 * clavier). L'élément n'existe que si le marqueur est affiché (hors bulle) :
 * appelé à chaque ajout sur la carte et après chaque changement d'icône.
 */
function labelMarker(marker: Leaflet.Marker, place: Place) {
  const el = marker.getElement()
  if (!el) return
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `${place.name}. ${dogStatusAccessibleText(place.dogStatus, place.dogStatusSource)}`)
}

function createMarker(lib: typeof Leaflet, place: Place, selected: boolean): Leaflet.Marker {
  const marker = lib.marker([place.lat, place.lon], {
    icon: placeIcon(lib, place, selected),
    title: place.name,
    zIndexOffset: selected ? 500 : 0,
  })
  marker.on('click', () => emit('select-place', place))
  // Leaflet n'active pas un marqueur au clavier : Entrée / Espace ouvrent la fiche.
  marker.on('keydown', (e) => {
    const key = (e as Leaflet.LeafletKeyboardEvent).originalEvent
    if (key.key !== 'Enter' && key.key !== ' ') return
    key.preventDefault()
    emit('select-place', place)
  })
  marker.on('add', () => labelMarker(marker, place))
  return marker
}

/** Sort le marqueur de son groupe quand il est sélectionné, l'y remet ensuite. */
function setSelected(id: string, selected: boolean) {
  const entry = markers.get(id)
  if (!entry || !L || !clusterLayer || !selectedLayer) return
  const { marker, place } = entry
  if (selected) clusterLayer.removeLayer(marker)
  else selectedLayer.removeLayer(marker)
  marker.setIcon(placeIcon(L, place, selected))
  marker.setZIndexOffset(selected ? 500 : 0)
  if (selected) selectedLayer.addLayer(marker)
  else clusterLayer.addLayer(marker)
  labelMarker(marker, place)
}

const renderMarkers = () => {
  if (!map || !L || !clusterLayer || !selectedLayer) return
  performance.mark(`${MARKERS_MEASURE}:start`)

  clusterLayer.clearLayers()
  selectedLayer.clearLayers()
  markers.clear()

  const selectedId = props.selectedPlaceId ?? null
  const grouped: Leaflet.Marker[] = []
  for (const place of props.places) {
    const isSelected = selectedId === place.id
    const marker = createMarker(L, place, isSelected)
    markers.set(place.id, { marker, place })
    if (isSelected) selectedLayer.addLayer(marker)
    else grouped.push(marker)
  }
  // Ajout groupé et synchrone (un `chunkedLoading` en cours ne s'annule pas
  // si les lieux changent entre-temps).
  clusterLayer.addLayers(grouped)
  renderedSelectedId = selectedId
  performance.measure(MARKERS_MEASURE, `${MARKERS_MEASURE}:start`)
}

/** Changement de sélection : seuls l'ancien et le nouveau marqueur bougent. */
function updateSelection() {
  const next = props.selectedPlaceId ?? null
  if (next === renderedSelectedId) return
  if (renderedSelectedId) setSelected(renderedSelectedId, false)
  if (next) setSelected(next, true)
  renderedSelectedId = next
}

const updateUserMarker = () => {
  if (!map || !L) return
  if (props.latitude == null || props.longitude == null) return
  if (userMarker) {
    userMarker.setLatLng([props.latitude, props.longitude])
  } else {
    // Repère décoratif : ni cliquable ni focusable (« Recentrer sur ma position » suffit).
    userMarker = L.marker([props.latitude, props.longitude], {
      icon: userIcon(L),
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false,
    }).addTo(map)
    userMarker.getElement()?.setAttribute('aria-hidden', 'true')
  }
}

onMounted(async () => {
  if (!mapEl.value) return

  // Leaflet et le regroupement uniquement côté client. Le greffon s'accroche
  // au `L` global : il est importé après Leaflet.
  await Promise.all([
    import('leaflet/dist/leaflet.css'),
    import('leaflet.markercluster/dist/MarkerCluster.css'),
  ])
  const leaflet = await import('leaflet')
  L = leaflet.default
  ;(window as unknown as { L: typeof Leaflet }).L = L
  await import('leaflet.markercluster')

  const located = props.latitude != null && props.longitude != null
  const start = props.startView
    ?? (located ? { lat: props.latitude!, lng: props.longitude!, zoom: USER_ZOOM } : FRANCE_VIEW)

  const animate = !reducedMotion()
  const leafletMap = L.map(mapEl.value, {
    zoomControl: false,
    zoomAnimation: animate,
    fadeAnimation: animate,
    markerZoomAnimation: animate,
  }).setView([start.lat, start.lng], start.zoom)
  map = leafletMap
  // Boutons de zoom en français (taille 44 px dans main.css).
  L.control.zoom({ zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(leafletMap)

  // Fournisseur de tuiles configurable (TILE_URL / TILE_ATTRIBUTION) ; attribution
  // toujours affichée. Le contrôle reprend le texte de la config (pas de donnée utilisateur).
  L.tileLayer(config.tileUrl, {
    attribution: config.tileAttribution,
    maxZoom: 19,
  }).addTo(leafletMap)

  selectedLayer = L.layerGroup().addTo(leafletMap)
  clusterLayer = L.markerClusterGroup({
    maxClusterRadius: clusterRadius,
    disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
    animate,
    animateAddingMarkers: false,
    iconCreateFunction: cluster => clusterIcon(L!, cluster.getChildCount()),
  }).addTo(leafletMap)

  leafletMap.on('moveend', emitView)
  stopWatchingMoves = watchUserMoves(leafletMap, mapEl.value, clusterLayer, () => emit('user-move'))

  // Recalcule la taille de la carte quand la mise en page change.
  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)

  updateUserMarker()
  renderMarkers()
  emit('ready')
  emitView()
})

function emitView() {
  const view = navigation.getView()
  if (view) emit('update:view', view)
}

watch(() => props.places, () => renderMarkers())
watch(() => props.selectedPlaceId, () => updateSelection())

// Le déplacement vers la position est piloté par l'écran carte (`flyTo`).
watch(() => [props.latitude, props.longitude], () => updateUserMarker())

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  stopWatchingMoves?.()
  map?.remove()
  map = null
  clusterLayer = null
  selectedLayer = null
})

const api: PawspotMapApi = {
  ...navigation,
  focusMarker(placeId) {
    const marker = markers.get(placeId)?.marker
    if (!marker) return false
    // Marqueur rentré dans une bulle : le focus va à la bulle qui le contient.
    const shown = marker.getElement() ? marker : clusterLayer?.getVisibleParent(marker)
    const el = shown?.getElement()
    if (!el) return false
    el.focus({ preventScroll: true })
    return true
  },
}

defineExpose(api)
</script>

<template>
  <div ref="mapEl" style="width:100%;height:100%" role="region" aria-label="Carte des lieux" />
</template>
