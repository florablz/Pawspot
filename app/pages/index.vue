<script setup lang="ts">
import type { PawspotPlace, MapCenter, CategoryFilter, CategoryKey } from '~/types/places'

const { latitude, longitude, loading, getLocation } = useUserLocation()
const { places, fetching, searchError, fetchPlaces, searchByName, retry, shouldShowSearchHere } = usePlacesSearch()
const { loggedIn } = useAuth()
const { checkFavorite, toggleFavorite, isFavorited } = useFavorites()

const mapCenter = ref<MapCenter | null>(null)
const mapZoom = ref(14)
const searchQuery = ref('')
const activeCategory = ref<CategoryKey | ''>('')
const selectedPlace = ref<PawspotPlace | null>(null)
const mapRef = ref<{ flyTo: (lat: number, lng: number, zoom?: number) => void; getZoom: () => number } | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const detailSection = ref<HTMLElement | null>(null)
const localized = ref(false)

let searchDebounce: ReturnType<typeof setTimeout> | null = null

const categories: CategoryFilter[] = [
  { key: 'park', label: 'Parcs', icon: '\u{1F333}', color: 'bg-paw-green-500' },
  { key: 'dog_park', label: 'Parcs à chiens', icon: '\u{1F43E}', color: 'bg-paw-green-700' },
  { key: 'beach', label: 'Plages', icon: '\u{1F30A}', color: 'bg-paw-blue-500' },
  { key: 'restaurant', label: 'Restos', icon: '\u{1F37D}\uFE0F', color: 'bg-paw-orange-400' },
  { key: 'bar', label: 'Bars', icon: '\u{1F37A}', color: 'bg-paw-orange-500' },
  { key: 'cafe', label: 'Cafes', icon: '\u{2615}', color: 'bg-paw-orange-300' },
  { key: 'vet', label: 'Vetos', icon: '\u{1FA7A}', color: 'bg-paw-orange-600' },
]

const categoryIcons: Record<string, string> = {
  park: '\u{1F333}',
  dog_park: '\u{1F43E}',
  beach: '\u{1F30A}',
  restaurant: '\u{1F37D}\uFE0F',
  bar: '\u{1F37A}',
  cafe: '\u2615',
  vet: '\u{1FA7A}',
}

const showSearchHere = computed(() => !fetching.value && shouldShowSearchHere(mapCenter.value))

const filteredPlaces = computed<PawspotPlace[]>(() => {
  const result = places.value
  if (!activeCategory.value) return result
  return result.filter(p => p.category === activeCategory.value)
})

function zoomToRadius(zoom: number): number {
  if (zoom >= 16) return 1000
  if (zoom >= 14) return 3000
  if (zoom >= 12) return 8000
  if (zoom >= 10) return 20000
  return 40000
}

async function locateMe() {
  try {
    await getLocation()
    localized.value = true
    if (latitude.value && longitude.value) {
      mapRef.value?.flyTo(latitude.value, longitude.value, 14)
      await fetchPlaces(latitude.value, longitude.value)
    }
  } catch {
    localized.value = false
  }
}

async function searchHere() {
  if (!mapCenter.value) return
  const radius = zoomToRadius(mapZoom.value)
  await fetchPlaces(mapCenter.value.lat, mapCenter.value.lng, radius)
}

function recenter() {
  if (latitude.value && longitude.value && mapRef.value) {
    mapRef.value.flyTo(latitude.value, longitude.value)
  } else {
    locateMe()
  }
}

function onSelectPlace(place: PawspotPlace) {
  selectedPlace.value = place
  if (loggedIn.value) checkFavorite(place.id)
  nextTick(() => {
    detailSection.value?.scrollIntoView({ behavior: 'smooth' })
  })
}

function backToMap() {
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function closeDetail() {
  backToMap()
  setTimeout(() => {
    selectedPlace.value = null
  }, 300)
}

function googleMapsUrl(place: PawspotPlace): string {
  const origin = latitude.value && longitude.value
    ? `${latitude.value},${longitude.value}`
    : ''
  const dest = `${place.lat},${place.lon}`
  return `https://www.google.com/maps/dir/${origin}/${dest}`
}

function dogPolicyText(place: PawspotPlace | null): string {
  if (!place) return ''
  switch (place.dogPolicy) {
    case 'all_day':
      return 'Chiens autorisés toute la journée'
    case 'night_only':
      return 'Chiens autorisés uniquement la nuit'
    case 'restricted':
      return 'Chiens autorisés sous conditions'
    case 'no':
      return 'Chiens interdits'
    case 'unknown':
    default:
      return place.category === 'beach' ? 'Politique chiens à vérifier' : 'Information chiens non disponible'
  }
}

function cancelPendingSearch() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = null
}

function runNameSearch(q: string) {
  const lat = mapCenter.value?.lat ?? latitude.value
  const lng = mapCenter.value?.lng ?? longitude.value
  if (lat && lng) searchByName(q, lat, lng)
}

function onSearchInput() {
  cancelPendingSearch()
  const q = searchQuery.value.trim()
  if (!q) {
    // Empty query: reload places at current position
    const lat = mapCenter.value?.lat ?? latitude.value
    const lng = mapCenter.value?.lng ?? longitude.value
    if (lat && lng) fetchPlaces(lat, lng)
    return
  }
  searchDebounce = setTimeout(() => runNameSearch(q), 500)
}

function onSearchEnter() {
  cancelPendingSearch()
  const q = searchQuery.value.trim()
  if (q) runNameSearch(q)
}

onMounted(() => {
  locateMe()
})

function clearSearch() {
  cancelPendingSearch()
  searchQuery.value = ''
  const lat = mapCenter.value?.lat ?? latitude.value
  const lng = mapCenter.value?.lng ?? longitude.value
  if (lat && lng) {
    fetchPlaces(lat, lng)
  }
}
</script>

<template>
  <div
    ref="scrollContainer"
    class="h-[100dvh] w-full overflow-y-auto scroll-smooth snap-y snap-mandatory"
  >
    <!-- Map section (full viewport height, snap) -->
    <section class="relative h-[100dvh] w-full shrink-0 snap-start">
      <!-- Map wrapper — ensures a sized container exists during SSR before .client.vue hydrates -->
      <div class="absolute inset-0">
        <MapPawspotMap
          ref="mapRef"
          :latitude="latitude"
          :longitude="longitude"
          :places="filteredPlaces"
          :selected-place="selectedPlace"
          @update:center="mapCenter = $event"
          @update:zoom="mapZoom = $event"
          @select-place="onSelectPlace"
        />
      </div>

      <!-- Loading overlay -->
      <div v-if="loading" class="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
        <div class="glass rounded-2xl px-6 py-4 text-center">
          <div class="mb-2 inline-block h-6 w-6 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" />
          <p class="text-sm text-white/70">Localisation...</p>
        </div>
      </div>

      <!-- Top bar -->
      <div class="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-3">
        <div class="pointer-events-auto glass mx-auto flex max-w-2xl items-center gap-3 rounded-2xl px-4 py-2.5">
          <img src="/logo/patte-de-chien.png" alt="PawSpot" class="h-7 w-7 object-contain">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Rechercher un lieu par nom..."
              class="w-full bg-transparent text-sm text-white placeholder-white/40 outline-none"
              @input="onSearchInput"
              @keydown.enter="onSearchEnter"
            >
            <button
              v-if="searchQuery"
              aria-label="Effacer la recherche"
              class="absolute right-0 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              @click="clearSearch"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-paw-orange-400 transition hover:bg-paw-orange-500/40"
            :title="localized ? 'Recentrer' : 'Me localiser'"
            @click="recenter"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
            </svg>
          </button>
          <AuthUserMenu />
        </div>
      </div>

      <!-- Category pills -->
      <div class="pointer-events-none absolute inset-x-0 top-[68px] z-[1000] px-3">
        <div class="pointer-events-auto mx-auto flex max-w-2xl gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            v-for="cat in categories"
            :key="cat.key"
            class="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition active:scale-95"
            :class="activeCategory === cat.key
              ? 'bg-paw-orange-500 text-white shadow-lg shadow-paw-orange-500/25'
              : 'glass text-white/80 hover:text-white'"
            @click="activeCategory = activeCategory === cat.key ? '' : cat.key"
          >
            <span>{{ cat.icon }}</span>
            <span>{{ cat.label }}</span>
          </button>
        </div>
      </div>

      <!-- Search here button -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div v-if="showSearchHere" class="pointer-events-none absolute inset-x-0 top-[120px] z-[1000] flex justify-center">
          <button
            class="pointer-events-auto glass flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-paw-brown-700/60 active:scale-95"
            @click="searchHere"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-paw-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            Rechercher ici
          </button>
        </div>
      </Transition>

      <!-- Bottom info bar -->
      <div v-if="!selectedPlace" class="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] p-3">
        <div class="pointer-events-auto glass mx-auto flex max-w-md items-center justify-between rounded-2xl px-5 py-3">
          <div v-if="fetching" class="flex items-center gap-2 text-sm text-paw-orange-400">
            <div class="h-4 w-4 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" />
            Recherche...
          </div>
          <div v-else-if="searchError" class="flex items-center gap-2 text-sm text-white/70" role="alert">
            <span>Impossible de charger les lieux.</span>
            <button
              class="rounded-full bg-paw-orange-500/20 px-3 py-1 text-xs text-paw-orange-400 transition hover:bg-paw-orange-500/40"
              @click="retry"
            >
              Réessayer
            </button>
          </div>
          <div v-else class="text-sm text-white/70">
            <span class="font-semibold text-white">{{ filteredPlaces.length }}</span>
            lieu{{ filteredPlaces.length > 1 ? 'x' : '' }}
            <span v-if="activeCategory" class="text-paw-orange-400">
              &middot; {{ categories.find(c => c.key === activeCategory)?.label }}
            </span>
            <span v-if="searchQuery.trim()" class="text-paw-green-400">
              &middot; "{{ searchQuery.trim() }}"
            </span>
          </div>
          <button
            class="rounded-full bg-paw-green-700/30 px-3 py-1 text-xs text-paw-green-400 transition hover:bg-paw-green-700/50"
            @click="searchQuery = ''; activeCategory = ''; clearSearch()"
          >
            Reset
          </button>
        </div>
      </div>

      <!-- Scroll hint when place selected -->
      <div v-if="selectedPlace" class="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex justify-center p-4">
        <button
          class="pointer-events-auto glass flex animate-bounce items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white"
          @click="detailSection?.scrollIntoView({ behavior: 'smooth' })"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
          Voir les infos
        </button>
      </div>
    </section>

    <!-- Place detail section (below the map, scrolls into view) -->
    <section
      v-if="selectedPlace"
      ref="detailSection"
      class="min-h-full shrink-0 snap-start bg-paw-brown-900"
    >
      <!-- Handle / back to map -->
      <div class="sticky top-0 z-10 bg-paw-brown-900 border-b border-white/5">
        <button
          class="flex w-full items-center justify-center gap-2 py-3 text-sm text-white/50 transition hover:text-white"
          @click="backToMap"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m18 15-6-6-6 6" />
          </svg>
          Retour a la carte
        </button>
      </div>

      <!-- Place photo -->
      <div v-if="selectedPlace.image" class="relative h-72 w-full overflow-hidden">
        <img
          :src="selectedPlace.image"
          :alt="selectedPlace.name"
          class="h-full w-full object-cover object-center"
          style="object-position: center 70%"
          @error="($event.target as HTMLImageElement).parentElement!.style.display = 'none'"
        >
        <div class="absolute inset-0 bg-gradient-to-t from-paw-brown-900 via-transparent to-transparent" />
      </div>

      <div class="mx-auto max-w-lg px-5 pb-12 pt-6">
        <!-- Header -->
        <div class="mb-6">
          <div class="mb-3 flex items-center gap-2.5">
            <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-paw-brown-800 text-2xl">
              {{ categoryIcons[selectedPlace.category] || '\u{1F4CD}' }}
            </span>
            <div class="flex-1">
              <h2 class="text-xl font-bold text-white leading-tight">{{ selectedPlace.name }}</h2>
              <span class="text-xs font-medium capitalize text-white/50">
                {{ selectedPlace.category.replace('_', ' ') }}
              </span>
            </div>
            <button
              v-if="loggedIn"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-90"
              :class="isFavorited(selectedPlace.id) ? 'bg-paw-orange-500/20' : 'bg-white/5 hover:bg-white/10'"
              @click="toggleFavorite(selectedPlace!)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 transition"
                :class="isFavorited(selectedPlace.id) ? 'text-paw-orange-400 fill-paw-orange-400' : 'text-white/30'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          </div>

          <!-- Dog policy badge -->
          <div
            v-if="selectedPlace"
            class="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
            :class="{
              'bg-paw-green-700/30 text-paw-green-400': selectedPlace.dogPolicy === 'all_day',
              'bg-paw-blue-700/30 text-paw-blue-300': selectedPlace.dogPolicy === 'night_only',
              'bg-paw-orange-700/30 text-paw-orange-300': selectedPlace.dogPolicy === 'restricted',
              'bg-paw-red-700/30 text-paw-red-300': selectedPlace.dogPolicy === 'no',
              'bg-paw-white/10 text-white/70': selectedPlace.dogPolicy === 'unknown',
            }">
            <span class="text-sm">{{ selectedPlace.dogPolicy === 'night_only' ? '🌙' : '🐕' }}</span>
            <span
              class="text-xs font-medium"
              :class="selectedPlace.dogPolicy === 'all_day' ? 'capitalize' : ''">
              {{ dogPolicyText(selectedPlace) }}
            </span>
          </div>

          <!-- Cuisine badge -->
          <div v-if="selectedPlace.cuisine" class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-paw-orange-500/15 px-3 py-1">
            <span class="text-sm">{{'🍽️'}}</span>
            <span class="text-xs font-medium text-paw-orange-400">{{ selectedPlace.cuisine.replace(/;/g, ', ') }}</span>
          </div>
        </div>

        <!-- Description -->
        <p v-if="selectedPlace.description" class="mb-6 text-sm leading-relaxed text-white/70">
          {{ selectedPlace.description }}
        </p>

        <!-- Info cards -->
        <div class="mb-6 space-y-2.5">
          <!-- Opening hours -->
          <div v-if="selectedPlace.openingHours" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            <div>
              <p class="text-[11px] font-medium uppercase tracking-wider text-white/40">Horaires</p>
              <p class="text-sm text-white whitespace-pre-line">{{ selectedPlace.openingHours.replace(/;/g, '\n') }}</p>
            </div>
          </div>

          <!-- Phone -->
          <div v-if="selectedPlace.phone" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <div>
              <p class="text-[11px] font-medium uppercase tracking-wider text-white/40">Telephone</p>
              <a :href="'tel:' + selectedPlace.phone" class="text-sm text-paw-orange-400 hover:text-paw-orange-300 transition">
                {{ selectedPlace.phone }}
              </a>
            </div>
          </div>

          <!-- Website -->
          <div v-if="selectedPlace.website" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <div class="min-w-0">
              <p class="text-[11px] font-medium uppercase tracking-wider text-white/40">Site web</p>
              <a :href="selectedPlace.website" target="_blank" rel="noopener noreferrer" class="block truncate text-sm text-paw-orange-400 hover:text-paw-orange-300 transition">
                {{ selectedPlace.website.replace(/^https?:\/\/(www\.)?/, '') }}
              </a>
            </div>
          </div>

          <!-- Coordinates (always shown, smaller) -->
          <div class="flex items-start gap-3 rounded-xl bg-paw-brown-800/40 p-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-4 w-4 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
            </svg>
            <p class="text-xs text-white/40">{{ selectedPlace.lat.toFixed(5) }}, {{ selectedPlace.lon.toFixed(5) }}</p>
          </div>
        </div>

        <!-- Alerts -->
        <div class="mb-6 rounded-2xl bg-paw-brown-800/30 p-4">
          <PlaceAlerts :place-id="selectedPlace.id" />
        </div>

        <!-- Reviews -->
        <div class="mb-6 rounded-2xl bg-paw-brown-800/30 p-4">
          <PlaceReviews :place-id="selectedPlace.id" />
        </div>

        <!-- Actions -->
        <div class="space-y-3">
          <a
            :href="googleMapsUrl(selectedPlace)"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="`Itinéraire vers ${selectedPlace.name} dans Google Maps (nouvel onglet)`"
            class="flex items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
            </svg>
            Itinéraire
          </a>

          <div v-if="selectedPlace.phone" class="flex gap-3">
            <a
              :href="'tel:' + selectedPlace.phone"
              class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-white/70 transition hover:border-paw-orange-500/30 hover:text-white active:scale-[0.98]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              Appeler
            </a>
            <a
              v-if="selectedPlace.website"
              :href="selectedPlace.website"
              target="_blank"
              rel="noopener noreferrer"
              class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-white/70 transition hover:border-paw-green-500/30 hover:text-white active:scale-[0.98]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" x2="21" y1="14" y2="3" />
              </svg>
              Site web
            </a>
          </div>

          <button
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-white/50 transition hover:border-white/20 hover:text-white active:scale-[0.98]"
            @click="closeDetail"
          >
            Fermer
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
