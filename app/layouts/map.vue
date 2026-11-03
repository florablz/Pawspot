<script setup lang="ts">
import type { PawspotMapApi } from '~/types/map'

/**
 * Écran carte, commun à `/` et `/lieu/[id]` : le layout reste monté quand on
 * ouvre ou ferme une fiche, la carte Leaflet n'est donc jamais recréée.
 * La page (slot) n'affiche que la fiche.
 */
const mapRef = ref<PawspotMapApi | null>(null)
const s = useMapScreen(mapRef)
const { selected, snap, peekHeight, open } = s.sheet

const sheetOpen = computed(() => !!selected.value)
/** Sur desktop, les barres se décalent à gauche du panneau latéral. */
const besidePanel = computed(() => (sheetOpen.value ? 'lg:pr-[416px]' : ''))
</script>

<template>
  <div class="relative h-[100dvh] w-full overflow-hidden">
    <h1 class="sr-only">PawSpot, la carte des lieux où votre chien est le bienvenu</h1>
    <section class="absolute inset-0" aria-label="Carte">
      <!-- Contrôles avant la carte dans l'ordre du DOM : la tabulation les atteint en premier. -->
      <div class="pointer-events-none absolute inset-x-0 top-0 z-[1001] p-3" :class="besidePanel">
        <SearchTopBar
          v-model:query="s.nameQuery.value"
          :localized="s.localized.value"
          class="pointer-events-auto mx-auto max-w-2xl"
          @locate="s.locateMe()"
        />
      </div>

      <div class="pointer-events-none absolute inset-x-0 top-[68px] z-[1000] px-3" :class="besidePanel">
        <SearchCategoryFilters
          v-model:categories="s.categories.value"
          v-model:confirmed-only="s.confirmedOnly.value"
          class="pointer-events-auto mx-auto max-w-2xl"
        />
      </div>

      <MapSearchHereButton :show="s.showSearchHere.value" :class="besidePanel" @search="s.searchHere" />

      <!-- Conteneur dimensionné dès le SSR ; `isolate` garde les contrôles Leaflet sous les barres. -->
      <div class="absolute inset-0 isolate">
        <MapPawspotMap
          ref="mapRef"
          :latitude="s.latitude.value"
          :longitude="s.longitude.value"
          :places="s.mapPlaces.value"
          :selected-place-id="selected?.id ?? null"
          :start-view="s.startView"
          @update:view="s.onViewChange"
          @select-place="open"
          @ready="s.onMapReady"
        />
      </div>

      <div v-if="s.locating.value" class="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
        <div class="glass-strong rounded-2xl px-6 py-4 text-center" role="status">
          <div class="mb-2 inline-block h-6 w-6 rounded-full border-2 border-paw-orange-400 border-t-transparent motion-safe:animate-spin" aria-hidden="true" />
          <p class="text-sm text-white">Localisation…</p>
        </div>
      </div>

      <!-- Bas de carte : état + nombre de résultats, remonté au-dessus de l'aperçu de la fiche. -->
      <div
        class="pointer-events-none absolute inset-x-0 z-[1000] px-3 pb-6 pt-3 lg:bottom-0"
        :class="[besidePanel, sheetOpen && snap === 'peek' ? 'bottom-[var(--sheet-peek,40dvh)]' : 'bottom-0']"
        :style="peekHeight ? { '--sheet-peek': `clamp(30dvh, ${peekHeight}px, 60dvh)` } : undefined"
      >
        <MapStatusBar
          class="w-full"
          :count="s.filteredPlaces.value.length"
          :loaded-count="s.places.value.length"
          :loaded="!!s.loadedView.value"
          :filters-active="s.filtersActive.value"
          :confirmed-only="s.confirmedOnly.value"
          :fetching="s.fetching.value"
          :error="s.searchError.value"
          :stale="s.stale.value"
          :zoom-too-low="s.zoomTooLow.value"
          :outside-coverage="s.outsideCoverage.value"
          :truncated="s.truncated.value"
          :incomplete="s.incomplete.value"
          :location-message="s.locationMessage.value"
          :locating="s.locating.value"
          @retry="s.retry"
          @clear-filters="s.clearFilters"
          @disable-confirmed="s.confirmedOnly.value = false"
        />
      </div>
    </section>

    <slot />
  </div>
</template>
