<script setup lang="ts">
import type * as Leaflet from 'leaflet'
import { CATEGORIES, DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { Place } from '#shared/types'
import type { MapInsets, MapStartView, MapView, PawspotMapApi } from '~/types/map'

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
  /** La carte Leaflet est créée (les méthodes exposées fonctionnent). */
  'ready': []
}>()

/** Vue « France entière » (géolocalisation refusée ou en attente). */
const FRANCE_VIEW = { lat: 46.6, lng: 2.4, zoom: 6 }
const USER_ZOOM = 14
/** Taille minimale de la zone cliquable d'un marqueur (px). */
const MARKER_HIT_SIZE = 44

const mapEl = ref<HTMLElement | null>(null)
let map: Leaflet.Map | null = null
let markersLayer: Leaflet.LayerGroup | null = null
/** Marqueurs par id de lieu (focus au clavier, mise à jour du marqueur sélectionné). */
const markers = new Map<string, { marker: Leaflet.Marker, place: Place }>()
let renderedSelectedId: string | null = null
let userMarker: Leaflet.Marker | null = null
let L: typeof Leaflet | null = null
let resizeObserver: ResizeObserver | null = null

function createPlaceIcon(lib: typeof Leaflet, place: Place, selected: boolean): Leaflet.DivIcon {
  const category = CATEGORIES[place.category]
  const color = category?.color ?? DEFAULT_CATEGORY_COLOR
  const emoji = category?.icon ?? DEFAULT_CATEGORY_ICON
  const dot = DOG_STATUS_MARKER[place.dogStatus] ?? DOG_STATUS_MARKER.unknown
  const size = selected ? 44 : 36
  /** Zone tactile : 44 px au moins, le disque visible est centré dedans. */
  const hit = Math.max(MARKER_HIT_SIZE, size)
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
      width:${hit}px;height:${hit}px;
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
    "><div style="
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
    ">${dot.glyph}</span></div></div>`,
    iconSize: [hit, hit],
    iconAnchor: [hit / 2, hit / 2],
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

function reducedMotion(): boolean {
  return matchesMedia(REDUCED_MOTION_QUERY)
}

/** Nom + statut chien pour les lecteurs d'écran (le marqueur est focusable au clavier). */
function labelMarker(marker: Leaflet.Marker, place: Place) {
  marker.getElement()?.setAttribute('aria-label', `${place.name}. ${dogStatusAccessibleText(place.dogStatus, place.dogStatusSource)}`)
}

function styleMarker(id: string, selected: boolean) {
  const entry = markers.get(id)
  if (!entry || !L) return
  entry.marker.setIcon(createPlaceIcon(L, entry.place, selected))
  entry.marker.setZIndexOffset(selected ? 500 : 0)
  labelMarker(entry.marker, entry.place)
}

const renderMarkers = () => {
  if (!map || !L) return

  if (markersLayer) {
    markersLayer.clearLayers()
  } else {
    markersLayer = L.layerGroup().addTo(map)
  }
  markers.clear()

  const selectedId = props.selectedPlaceId ?? null
  for (const place of props.places) {
    const isSelected = selectedId === place.id
    const marker = L.marker([place.lat, place.lon], {
      icon: createPlaceIcon(L, place, isSelected),
      title: place.name,
      zIndexOffset: isSelected ? 500 : 0,
    })
      .on('click', () => emit('select-place', place))
      .addTo(markersLayer)
    labelMarker(marker, place)
    markers.set(place.id, { marker, place })
  }
  renderedSelectedId = selectedId
}

/** Changement de sélection : seuls l'ancien et le nouveau marqueur sont redessinés. */
function updateSelection() {
  const next = props.selectedPlaceId ?? null
  if (next === renderedSelectedId) return
  if (renderedSelectedId) styleMarker(renderedSelectedId, false)
  if (next) styleMarker(next, true)
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
      icon: createUserIcon(L),
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false,
    }).addTo(map)
    userMarker.getElement()?.setAttribute('aria-hidden', 'true')
  }
}

onMounted(async () => {
  if (!mapEl.value) return

  // Import leaflet + CSS only on client
  await import('leaflet/dist/leaflet.css')
  const leaflet = await import('leaflet')
  L = leaflet.default

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
  emit('ready')
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
watch(() => props.selectedPlaceId, () => updateSelection())

// Le déplacement vers la position est piloté par l'écran carte (`flyTo`).
watch(() => [props.latitude, props.longitude], () => updateUserMarker())

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  map?.remove()
  map = null
})

/** Zone visible hors marges, en pixels du conteneur. */
function visibleBounds(insets: MapInsets): Leaflet.Bounds | null {
  if (!map || !L) return null
  const size = map.getSize()
  return L.bounds([0, 0], [Math.max(0, size.x - insets.right), Math.max(0, size.y - insets.bottom)])
}

const api: PawspotMapApi = {
  flyTo(lat, lng, zoom) {
    if (!map) return false
    if (reducedMotion()) map.setView([lat, lng], zoom ?? map.getZoom(), { animate: false })
    else map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.8 })
    return true
  },
  getView: currentView,
  isVisible(lat, lng, insets) {
    const bounds = visibleBounds(insets)
    if (!map || !bounds) return false
    return bounds.contains(map.latLngToContainerPoint([lat, lng]))
  },
  reveal(lat, lng, insets, zoom) {
    if (!map || !L) return false
    const animate = !reducedMotion()
    if (zoom == null) {
      map.panInside([lat, lng], {
        paddingTopLeft: [24, 140],
        paddingBottomRight: [insets.right + 24, insets.bottom + 24],
        animate,
      })
      return true
    }
    // Centre décalé : le lieu apparaît au milieu de la zone non couverte par la fiche.
    const point = map.project([lat, lng], zoom).add([insets.right / 2, insets.bottom / 2])
    map.setView(map.unproject(point, zoom), zoom, { animate })
    return true
  },
  showArea(area, insets) {
    if (!map || !L) return false
    const animate = !reducedMotion()
    // Barres du haut (recherche + filtres) ≈ 140 px, barre d'état en bas ≈ 80 px.
    const topLeft = L.point(16, 140)
    const bottomRight = L.point(insets.right + 16, insets.bottom + 80)
    let zoom = area.maxZoom
    let center = L.latLng(area.lat, area.lng)
    if (area.bbox) {
      const bounds = L.latLngBounds([area.bbox.minLat, area.bbox.minLon], [area.bbox.maxLat, area.bbox.maxLon])
      zoom = Math.min(map.getBoundsZoom(bounds, false, topLeft.add(bottomRight)), area.maxZoom)
      if (zoom >= area.minZoom) center = bounds.getCenter()
    }
    zoom = Math.max(Math.min(zoom, map.getMaxZoom()), area.minZoom)
    // Centre décalé : la zone apparaît au milieu de la partie non couverte.
    const offset = topLeft.subtract(bottomRight).divideBy(2)
    const target = map.unproject(map.project(center, zoom).subtract(offset), zoom)
    if (animate) map.flyTo(target, zoom, { duration: 0.8 })
    else map.setView(target, zoom, { animate: false })
    return true
  },
  focusMarker(placeId) {
    const el = markers.get(placeId)?.marker.getElement()
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
