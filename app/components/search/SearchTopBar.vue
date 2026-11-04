<script setup lang="ts">
import type { GeocodeResult, Place } from '#shared/types'

/** Barre du haut de la carte : logo, recherche unifiée, « Me localiser », compte. */
defineProps<{
  /** La position a déjà été obtenue (libellé « Recentrer sur ma position »). */
  localized: boolean
  /** Lieux chargés, proposés dans les suggestions. */
  places: readonly Place[]
  /** Mettre la barre en évidence (géolocalisation refusée : « cherchez une ville »). */
  highlight?: boolean
}>()

defineEmits<{
  'locate': []
  'select-place': [place: Place]
  'select-address': [result: GeocodeResult]
  /** Lien d'évitement : aller directement aux marqueurs de la carte. */
  'skip-to-map': []
}>()

const box = ref<{ focus: () => void } | null>(null)
defineExpose({ focus: () => box.value?.focus() })

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
</script>

<template>
  <div
    role="search"
    class="glass-strong relative flex items-center gap-2 rounded-2xl py-1 pl-3 pr-1 transition-shadow"
    :class="highlight ? 'ring-2 ring-paw-orange-400' : ''"
    data-testid="search-bar"
    data-map-overlay
  >
    <!-- Lien d'évitement, visible au focus : saute la recherche et les filtres (marron 900 sur orange 500 = 5,97:1). -->
    <a
      href="#carte-lieux"
      class="sr-only left-3 top-full z-10 mt-2 rounded-full bg-paw-orange-500 text-sm font-semibold text-paw-brown-900 shadow-lg focus:not-sr-only focus:absolute focus:flex focus:min-h-[44px] focus:items-center focus:whitespace-nowrap focus:px-4 focus:outline-none focus:ring-2 focus:ring-white"
      data-testid="skip-to-map"
      @click.prevent="$emit('skip-to-map')"
    >
      Aller aux lieux de la carte
    </a>
    <img src="/logo/patte-de-chien.png" alt="PawSpot" class="h-7 w-7 shrink-0 object-contain">
    <SearchBox
      ref="box"
      :places="places"
      @select-place="$emit('select-place', $event)"
      @select-address="$emit('select-address', $event)"
    />
    <button
      type="button"
      :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-paw-orange-300 transition hover:bg-paw-orange-500/40', focusRing]"
      :aria-label="localized ? 'Recentrer sur ma position' : 'Me localiser'"
      @click="$emit('locate')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
      </svg>
    </button>
    <AuthUserMenu />
  </div>
</template>
