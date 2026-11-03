<script setup lang="ts">
import type { CategoryKey } from '#shared/categories'
import type { Place } from '#shared/types'
import type { MapView } from '~/types/map'

const { latitude, longitude, loading, error: locationError, getLocation } = useUserLocation()
const {
  places, fetching, searchError, stale, zoomTooLow, truncated, incomplete, loadedView,
  fetchPlaces, retry, shouldShowSearchHere,
} = usePlacesSearch()

const mapView = ref<MapView | null>(null)
const searchQuery = ref('')
const selectedCategories = ref<CategoryKey[]>([])
const confirmedOnly = ref(false)
const selectedPlace = ref<Place | null>(null)
const mapRef = ref<{ flyTo: (lat: number, lng: number, zoom?: number) => boolean, getView: () => MapView | null } | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
const detailSection = ref<HTMLElement | null>(null)
const localized = ref(false)
/** Charger les lieux à la prochaine fin de déplacement (après « Me localiser »). */
let loadOnNextView = false

const userPosition = computed(() =>
  latitude.value != null && longitude.value != null ? { lat: latitude.value, lng: longitude.value } : null,
)

const filtersActive = computed(() => !!searchQuery.value.trim() || selectedCategories.value.length > 0 || confirmedOnly.value)

const filteredPlaces = computed(() => filterPlaces(places.value, {
  query: searchQuery.value,
  categories: selectedCategories.value,
  confirmedOnly: confirmedOnly.value,
}))

const showSearchHere = computed(() => !fetching.value && shouldShowSearchHere(mapView.value))

/** Géolocalisation impossible et rien de chargé : inviter à zoomer (vue France entière). */
const locationMessage = computed(() => {
  if (!locationError.value || loadedView.value || fetching.value) return null
  return `${locationError.value} Zoomez sur la carte jusqu'à votre ville pour voir les lieux autour.`
})

function onViewChange(view: MapView) {
  mapView.value = view
  // Premier chargement automatique : après la localisation, ou dès que
  // l'utilisateur a zoomé suffisamment quand rien n'est encore chargé.
  if (loadOnNextView || (!loadedView.value && !fetching.value && view.zoom >= MIN_PLACES_ZOOM)) {
    loadOnNextView = false
    fetchPlaces(view)
  }
}

async function locateMe() {
  try {
    await getLocation()
    localized.value = true
    if (latitude.value == null || longitude.value == null) return
    loadOnNextView = true
    if (!mapRef.value?.flyTo(latitude.value, longitude.value, 14)) {
      // Carte pas encore prête : elle démarrera sur la position et émettra sa vue.
      const view = mapRef.value?.getView()
      if (view) onViewChange(view)
    }
  }
  catch {
    localized.value = false
  }
}

function searchHere() {
  if (mapView.value) fetchPlaces(mapView.value)
}

function onSelectPlace(place: Place) {
  selectedPlace.value = place
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

function clearFilters() {
  searchQuery.value = ''
  selectedCategories.value = []
  confirmedOnly.value = false
}

onMounted(() => {
  locateMe()
})
</script>

<template>
  <div
    ref="scrollContainer"
    class="h-[100dvh] w-full overflow-y-auto scroll-smooth snap-y snap-mandatory"
  >
    <section class="relative h-[100dvh] w-full shrink-0 snap-start" aria-label="Carte">
      <!-- Conteneur dimensionné dès le SSR, avant l'hydratation de la carte -->
      <div class="absolute inset-0">
        <MapPawspotMap
          ref="mapRef"
          :latitude="latitude"
          :longitude="longitude"
          :places="filteredPlaces"
          :selected-place="selectedPlace"
          @update:view="onViewChange"
          @select-place="onSelectPlace"
        />
      </div>

      <div v-if="loading" class="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
        <div class="glass-strong rounded-2xl px-6 py-4 text-center" role="status">
          <div class="mb-2 inline-block h-6 w-6 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" aria-hidden="true" />
          <p class="text-sm text-white">Localisation…</p>
        </div>
      </div>

      <!-- Barre du haut -->
      <div class="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-3">
        <div class="pointer-events-auto glass-strong mx-auto flex max-w-2xl items-center gap-2 rounded-2xl py-1 pl-4 pr-1">
          <img src="/logo/patte-de-chien.png" alt="PawSpot" class="h-7 w-7 object-contain">
          <div class="relative min-w-0 flex-1">
            <label for="place-name-filter" class="sr-only">Filtrer les lieux de la zone par nom</label>
            <input
              id="place-name-filter"
              v-model="searchQuery"
              type="search"
              enterkeyhint="search"
              placeholder="Filtrer les lieux par nom…"
              class="min-h-[44px] w-full bg-transparent pr-11 text-sm text-white placeholder-white/70 outline-none [&::-webkit-search-cancel-button]:hidden"
            >
            <button
              v-if="searchQuery"
              type="button"
              aria-label="Effacer la recherche"
              class="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white/80 hover:text-white"
              @click="searchQuery = ''"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-paw-orange-300 transition hover:bg-paw-orange-500/40"
            :aria-label="localized ? 'Recentrer sur ma position' : 'Me localiser'"
            @click="locateMe"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
            </svg>
          </button>
          <AuthUserMenu />
        </div>
      </div>

      <!-- Filtres -->
      <div class="pointer-events-none absolute inset-x-0 top-[68px] z-[1000] px-3">
        <SearchCategoryFilters
          v-model:categories="selectedCategories"
          v-model:confirmed-only="confirmedOnly"
          class="pointer-events-auto mx-auto max-w-2xl"
        />
      </div>

      <!-- Rechercher dans cette zone -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div v-if="showSearchHere" class="pointer-events-none absolute inset-x-0 top-[128px] z-[1000] flex justify-center">
          <button
            type="button"
            class="pointer-events-auto glass-strong flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-medium text-white shadow-lg transition hover:bg-paw-brown-700 active:scale-95"
            @click="searchHere"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-paw-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            Rechercher dans cette zone
          </button>
        </div>
      </Transition>

      <!-- Bas de carte : état + nombre de résultats (toujours visible) -->
      <div class="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex flex-col gap-2 px-3 pb-6 pt-3">
        <div v-if="selectedPlace" class="flex justify-center">
          <button
            type="button"
            class="pointer-events-auto glass-strong flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-medium text-white"
            @click="detailSection?.scrollIntoView({ behavior: 'smooth' })"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
            Voir les infos de {{ selectedPlace.name }}
          </button>
        </div>
        <MapStatusBar
          class="w-full"
          :count="filteredPlaces.length"
          :loaded-count="places.length"
          :loaded="!!loadedView"
          :filters-active="filtersActive"
          :fetching="fetching"
          :error="searchError"
          :stale="stale"
          :zoom-too-low="zoomTooLow"
          :truncated="truncated"
          :incomplete="incomplete"
          :location-message="locationMessage"
          @retry="retry"
          @clear-filters="clearFilters"
        />
      </div>
    </section>

    <!-- Fiche du lieu (sous la carte) -->
    <section
      v-if="selectedPlace"
      ref="detailSection"
      class="min-h-full shrink-0 snap-start bg-paw-brown-900"
      :aria-label="`Fiche : ${selectedPlace.name}`"
    >
      <div class="sticky top-0 z-10 border-b border-white/5 bg-paw-brown-900">
        <button
          type="button"
          class="flex min-h-[44px] w-full items-center justify-center gap-2 text-sm text-white/70 transition hover:text-white"
          @click="backToMap"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m18 15-6-6-6 6" />
          </svg>
          Retour à la carte
        </button>
      </div>

      <PlaceDetails :place="selectedPlace" :origin="userPosition">
        <button
          type="button"
          class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 text-sm font-medium text-white/70 transition hover:border-white/20 hover:text-white active:scale-[0.98]"
          @click="closeDetail"
        >
          Fermer
        </button>
      </PlaceDetails>
    </section>
  </div>
</template>
