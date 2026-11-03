<script setup lang="ts">
import type * as Leaflet from 'leaflet'
import { CATEGORIES, DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { Place } from '#shared/types'
import type { MapView } from '~/types/map'

const props = defineProps<{
  latitude: number | null
  longitude: number | null
  places: Place[]
  selectedPlace?: Place | null
}>()

const emit = defineEmits<{
  'update:view': [view: MapView]
  'select-place': [place: Place]
}>()

/** Vue « France entière » (géolocalisation refusée ou en attente). */
const FRANCE_VIEW = { lat: 46.6, lng: 2.4, zoom: 6 }
const USER_ZOOM = 14

const mapEl = ref<HTMLElement | null>(null)
let map: Leaflet.Map | null = null
let markersLayer: Leaflet.LayerGroup | null = null
let userMarker: Leaflet.Marker | null = null
let L: typeof Leaflet | null = null
let resizeObserver: ResizeObserver | null = null

function createPlaceIcon(lib: typeof Leaflet, place: Place, selected: boolean): Leaflet.DivIcon {
  const category = CATEGORIES[place.category]
  const color = category?.color ?? DEFAULT_CATEGORY_COLOR
  const emoji = category?.icon ?? DEFAULT_CATEGORY_ICON
  const dot = DOG_STATUS_MARKER[place.dogStatus] ?? DOG_STATUS_MARKER.unknown
  const size = selected ? 44 : 36
  const dotSize = selected ? 20 : 18
  // Symbole de deux caractères (✓✓) : police plus petite et lettres resserrées.
  const glyphSize = dot.glyph.length > 1 ? dotSize - 10 : dotSize - 7
  const border = selected ? '3px solid #ffffff' : '2px solid rgba(255,255,255,0.3)'
  const shadow = selected
    ? '0 0 16px rgba(255,255,255,0.3), 0 2px 8px rgba(0,0,0,0.4)'
    : '0 2px 8px rgba(0,0,0,0.4)'
  // Uniquement des valeurs de configuration dans ce HTML (aucune donnée du lieu).
  return lib.divIcon({
    className: '',
    html: `<div style="
      position:relative;
      width:${size}px;height:${size}px;
      background:${color};
      border:${border};
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 20 : 16}px;
      box-shadow:${shadow};
      cursor:pointer;
      transition:all 0.2s;
    "><span aria-hidden="true">${emoji}</span><span aria-hidden="true" style="
      position:absolute;top:-4px;right:-4px;
      width:${dotSize}px;height:${dotSize}px;
      border-radius:50%;
      background:${dot.color};
      color:${dot.glyphColor};
      border:2px ${dot.dashed ? 'dashed' : 'solid'} #2C1810;
      font:700 ${glyphSize}px/1 system-ui,sans-serif;
      letter-spacing:${dot.glyph.length > 1 ? '-1px' : '0'};
      display:flex;align-items:center;justify-content:center;
    ">${dot.glyph}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

function createUserIcon(lib: typeof Leaflet): Leaflet.DivIcon {
  return lib.divIcon({
    className: '',
    html: `<div style="position:relative;width:18px;height:18px;">
      <div style="
        position:absolute;inset:-8px;
        border-radius:50%;
        background:rgba(255,109,0,0.25);
        animation:pulse-ring 2s ease-out infinite;
      "></div>
      <div style="
        width:18px;height:18px;
        background:#FF6D00;
        border:3px solid #ffffff;
        border-radius:50%;
        box-shadow:0 0 12px rgba(255,109,0,0.6);
      "></div>
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

const renderMarkers = () => {
  if (!map || !L) return

  if (markersLayer) {
    markersLayer.clearLayers()
  } else {
    markersLayer = L.layerGroup().addTo(map)
  }

  for (const place of props.places) {
    const isSelected = props.selectedPlace?.id === place.id
    const marker = L.marker([place.lat, place.lon], {
      icon: createPlaceIcon(L, place, isSelected),
      title: place.name,
      zIndexOffset: isSelected ? 500 : 0,
    })
      .on('click', () => emit('select-place', place))
      .addTo(markersLayer)
    // Nom + statut chien pour les lecteurs d'écran (le marqueur est focusable au clavier).
    marker.getElement()?.setAttribute('aria-label', `${place.name}. ${dogStatusAccessibleText(place.dogStatus, place.dogStatusSource)}`)
  }
}

const updateUserMarker = () => {
  if (!map || !L) return
  if (props.latitude == null || props.longitude == null) return
  if (userMarker) {
    userMarker.setLatLng([props.latitude, props.longitude])
  } else {
    userMarker = L.marker([props.latitude, props.longitude], {
      icon: createUserIcon(L),
      zIndexOffset: 1000,
    }).addTo(map)
  }
}

onMounted(async () => {
  if (!mapEl.value) return

  // Import leaflet + CSS only on client
  await import('leaflet/dist/leaflet.css')
  const leaflet = await import('leaflet')
  L = leaflet.default

  const located = props.latitude != null && props.longitude != null
  const startLat = located ? props.latitude! : FRANCE_VIEW.lat
  const startLng = located ? props.longitude! : FRANCE_VIEW.lng
  const startZoom = located ? USER_ZOOM : FRANCE_VIEW.zoom

  const leafletMap = L.map(mapEl.value, { zoomControl: true })
    .setView([startLat, startLng], startZoom)
  map = leafletMap

  // Standard light map (OpenStreetMap default)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(leafletMap)

  leafletMap.on('moveend', emitView)

  // Recalcule la taille de la carte quand la mise en page change.
  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)

  updateUserMarker()
  renderMarkers()
  emitView()
})

function currentView(): MapView | null {
  if (!map) return null
  const c = map.getCenter()
  return {
    center: { lat: c.lat, lng: c.lng },
    zoom: Math.round(map.getZoom()),
    bbox: map.getBounds().toBBoxString(),
  }
}

function emitView() {
  const view = currentView()
  if (view) emit('update:view', view)
}

watch(() => props.places, () => renderMarkers())
watch(() => props.selectedPlace, () => renderMarkers())

// Le déplacement vers la position est piloté par la page (`flyTo`).
watch(() => [props.latitude, props.longitude], () => updateUserMarker())

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  map?.remove()
  map = null
})

defineExpose({
  /** `false` si la carte n'est pas encore prête. */
  flyTo(lat: number, lng: number, zoom?: number): boolean {
    if (!map) return false
    map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.8 })
    return true
  },
  getView: currentView,
})
</script>

<template>
  <div ref="mapEl" style="width:100%;height:100%" role="region" aria-label="Carte des lieux" />
</template>
