<script setup lang="ts">
import type { PawspotPlace, MapCenter } from '~/types/places'

const props = defineProps<{
  latitude: number | null
  longitude: number | null
  places: PawspotPlace[]
  selectedPlace?: PawspotPlace | null
}>()

const emit = defineEmits<{
  'update:center': [center: MapCenter]
  'update:zoom': [zoom: number]
  'select-place': [place: PawspotPlace]
}>()

const mapEl = ref<HTMLElement | null>(null)
let map: any = null
let markersLayer: any = null
let userMarker: any = null
let L: any = null

const categoryColors: Record<string, string> = {
  park: '#66BB6A',
  dog_park: '#43A047',
  restaurant: '#FF9100',
  bar: '#FF6D00',
  cafe: '#FFB74D',
  vet: '#E65100',
}

const categoryIcons: Record<string, string> = {
  park: '\u{1F333}',
  dog_park: '\u{1F43E}',
  restaurant: '\u{1F37D}\uFE0F',
  bar: '\u{1F37A}',
  cafe: '\u2615',
  vet: '\u{1FA7A}',
}

function createCircleIcon(color: string, emoji: string, selected = false) {
  const size = selected ? 44 : 36
  const border = selected ? '3px solid #ffffff' : '2px solid rgba(255,255,255,0.3)'
  const shadow = selected
    ? '0 0 16px rgba(255,255,255,0.3), 0 2px 8px rgba(0,0,0,0.4)'
    : '0 2px 8px rgba(0,0,0,0.4)'
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:${border};
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 20 : 16}px;
      box-shadow:${shadow};
      cursor:pointer;
      transition:all 0.2s;
    ">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

function createUserIcon() {
  return L.divIcon({
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
    const color = categoryColors[place.category] || '#8D6E63'
    const emoji = categoryIcons[place.category] || '\u{1F4CD}'
    const isSelected = props.selectedPlace?.id === place.id
    const icon = createCircleIcon(color, emoji, isSelected)

    L.marker([place.lat, place.lon], { icon })
      .on('click', () => emit('select-place', place))
      .addTo(markersLayer)
  }
}

const updateUserMarker = () => {
  if (!map || !L) return
  if (props.latitude == null || props.longitude == null) return
  if (userMarker) {
    userMarker.setLatLng([props.latitude, props.longitude])
  } else {
    userMarker = L.marker([props.latitude, props.longitude], {
      icon: createUserIcon(),
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

  const startLat = props.latitude ?? 46.6
  const startLng = props.longitude ?? 2.3
  const startZoom = props.latitude != null ? 14 : 6

  map = L.map(mapEl.value, { zoomControl: true })
    .setView([startLat, startLng], startZoom)

  // Dark base (roads, buildings = dark)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    maxZoom: 19,
  }).addTo(map)

  // Color overlay from OSM (parks green, water blue — blended on top)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'color-overlay',
  }).addTo(map)

  // Labels on top
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(map)

  map.on('moveend', () => {
    const c = map.getCenter()
    emit('update:center', { lat: c.lat, lng: c.lng })
    emit('update:zoom', map.getZoom())
  })

  // ResizeObserver for layout shifts
  const ro = new ResizeObserver(() => map?.invalidateSize())
  ro.observe(mapEl.value)
  onBeforeUnmount(() => ro.disconnect())

  updateUserMarker()
  renderMarkers()
})

watch(() => props.places, () => renderMarkers(), { deep: true })
watch(() => props.selectedPlace, () => renderMarkers())

watch(
  () => [props.latitude, props.longitude],
  () => {
    if (!map || props.latitude == null || props.longitude == null) return
    updateUserMarker()
    map.flyTo([props.latitude, props.longitude], 14, { duration: 1 })
  },
)

onBeforeUnmount(() => {
  map?.remove()
})

defineExpose({
  flyTo(lat: number, lng: number, zoom?: number) {
    map?.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.8 })
  },
  getZoom(): number {
    return map?.getZoom() ?? 14
  },
})
</script>

<template>
  <div ref="mapEl" style="width:100%;height:100%" />
</template>
