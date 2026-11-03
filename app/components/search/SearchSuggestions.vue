<script setup lang="ts">
import { CATEGORIES, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { GeocodeResult, Place } from '#shared/types'
import type { GeocodeStatus } from '~/composables/useGeocode'
import type { SearchOption } from '~/types/search'

/**
 * Liste des suggestions (popup du combobox) en deux groupes : lieux PawSpot,
 * puis adresses / villes. Les options ne prennent jamais le focus (le focus
 * reste dans le champ, `aria-activedescendant`) ; le clic garde le focus.
 * Fond opaque (pas `glass-strong`) : un flou imbriqué dans celui de la barre
 * n'est pas appliqué par Chrome et les puces de filtre transparaissaient.
 * États hors liste : chargement, « Aucun résultat », erreur + « Réessayer », hors ligne.
 */
const props = defineProps<{
  listboxId: string
  optionId: (index: number) => string
  places: readonly Place[]
  addresses: readonly GeocodeResult[]
  /** Index actif dans la liste à plat (lieux puis adresses), -1 si aucun. */
  active: number
  status: GeocodeStatus
  error: string | null
  empty: boolean
}>()

defineEmits<{
  choose: [option: SearchOption]
  hover: [index: number]
  retry: []
}>()

const placesHeadingId = computed(() => `${props.listboxId}-places`)
const addressesHeadingId = computed(() => `${props.listboxId}-addresses`)
const offset = computed(() => props.places.length)
const loadingAddresses = computed(() => props.status === 'pending' && props.addresses.length === 0)

const optionClass = (selected: boolean) => [
  'flex min-h-[48px] cursor-pointer items-center gap-3 px-3 py-2 text-left',
  selected ? 'bg-paw-orange-500/25 ring-2 ring-inset ring-paw-orange-300' : 'hover:bg-white/10',
]
const heading = 'px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-paw-orange-200'
</script>

<template>
  <div
    class="absolute inset-x-0 top-full z-10 mt-2 max-h-[min(55dvh,28rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-paw-brown-900 py-1 shadow-xl"
    data-testid="search-suggestions"
  >
    <ul :id="listboxId" role="listbox" aria-label="Suggestions de recherche" class="flex flex-col">
      <li v-if="places.length" role="presentation">
        <ul role="group" :aria-labelledby="placesHeadingId">
          <li :id="placesHeadingId" role="presentation" :class="heading">Lieux PawSpot</li>
          <li
            v-for="(place, i) in places"
            :id="optionId(i)"
            :key="place.id"
            role="option"
            :aria-selected="active === i"
            :class="optionClass(active === i)"
            data-testid="search-option-place"
            @mousedown.prevent
            @pointermove="$emit('hover', i)"
            @click="$emit('choose', { kind: 'place', place })"
          >
            <span class="shrink-0 text-lg" aria-hidden="true">{{ CATEGORIES[place.category]?.icon ?? DEFAULT_CATEGORY_ICON }}</span>
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="truncate text-sm font-semibold text-white">{{ place.name }}</span>
              <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <PlaceDogStatusBadge :place="place" compact />
                <span class="text-xs text-white/75">{{ CATEGORIES[place.category]?.singular ?? 'Lieu' }}</span>
              </span>
            </span>
          </li>
        </ul>
      </li>
      <li v-if="addresses.length" role="presentation">
        <ul role="group" :aria-labelledby="addressesHeadingId">
          <li :id="addressesHeadingId" role="presentation" :class="heading">Adresses et villes</li>
          <li
            v-for="(result, i) in addresses"
            :id="optionId(offset + i)"
            :key="`${result.lat},${result.lon},${result.label}`"
            role="option"
            :aria-selected="active === offset + i"
            :class="optionClass(active === offset + i)"
            data-testid="search-option-address"
            @mousedown.prevent
            @pointermove="$emit('hover', offset + i)"
            @click="$emit('choose', { kind: 'address', result })"
          >
            <span class="shrink-0 text-lg" aria-hidden="true">{{ GEOCODE_TYPE_DISPLAY[result.type].icon }}</span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-semibold text-white">{{ splitGeocodeLabel(result).title }}</span>
              <span class="truncate text-xs text-white/75">
                {{ GEOCODE_TYPE_DISPLAY[result.type].label }}<template v-if="splitGeocodeLabel(result).detail"> · {{ splitGeocodeLabel(result).detail }}</template>
              </span>
            </span>
          </li>
        </ul>
      </li>
    </ul>

    <p v-if="loadingAddresses" class="flex min-h-[44px] items-center gap-2 px-3 text-sm text-white/80" data-testid="search-status-loading">
      <span class="h-4 w-4 rounded-full border-2 border-paw-orange-400 border-t-transparent motion-safe:animate-spin" aria-hidden="true" />
      Recherche des adresses…
    </p>
    <p v-else-if="empty" class="flex min-h-[44px] items-center px-3 text-sm text-white/90" data-testid="search-status-empty">
      Aucun résultat. Vérifiez l'orthographe ou essayez une ville proche.
    </p>
    <div v-else-if="status === 'error'" class="flex flex-col gap-2 px-3 py-2 text-sm text-white/90" data-testid="search-status-error">
      <p>{{ error }}</p>
      <button
        type="button"
        class="min-h-[44px] self-start rounded-full bg-paw-orange-500/20 px-4 text-xs font-semibold text-paw-orange-300 transition hover:bg-paw-orange-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300"
        @click="$emit('retry')"
      >
        Réessayer
      </button>
    </div>
    <p v-else-if="status === 'offline'" class="px-3 py-2 text-sm text-white/90" data-testid="search-status-offline">
      <span aria-hidden="true">📡</span> {{ GEOCODE_OFFLINE_MESSAGE }}
    </p>
  </div>
</template>
