<script setup lang="ts">
import { CATEGORIES, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { Place } from '#shared/types'

/**
 * Contenu d'une fiche lieu (carte et « Mes favoris ») : statut chien en premier,
 * infos pratiques, alertes, avis, itinéraire. Le slot par défaut ajoute des actions.
 */
const props = defineProps<{
  place: Place
  /** Position de l'utilisateur, pour l'itinéraire. */
  origin?: { lat: number, lng: number } | null
}>()

const emit = defineEmits<{ 'favorite-change': [favorited: boolean] }>()

const imageFailed = ref(false)
watch(() => props.place.id, () => { imageFailed.value = false })

const category = computed(() => CATEGORIES[props.place.category])

const itineraryUrl = computed(() => {
  const o = props.origin ? `${props.origin.lat},${props.origin.lng}` : ''
  return `https://www.google.com/maps/dir/${o}/${props.place.lat},${props.place.lon}`
})
</script>

<template>
  <div>
    <div v-if="place.image && !imageFailed" class="relative h-72 w-full overflow-hidden">
      <img
        :src="place.image"
        :alt="`Photo de ${place.name}`"
        class="h-full w-full object-cover"
        style="object-position: center 70%"
        @error="imageFailed = true"
      >
      <div class="absolute inset-0 bg-gradient-to-t from-paw-brown-900 via-transparent to-transparent" />
    </div>

    <div class="mx-auto max-w-lg px-5 pb-12 pt-6">
      <div class="mb-6">
        <div class="mb-3 flex items-center gap-2.5">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-paw-brown-800 text-2xl" aria-hidden="true">
            {{ category?.icon ?? DEFAULT_CATEGORY_ICON }}
          </span>
          <div class="min-w-0 flex-1">
            <h2 tabindex="-1" class="text-xl font-bold leading-tight text-white focus:outline-none">{{ place.name }}</h2>
            <span class="text-xs font-medium text-white/60">{{ category?.singular ?? 'Lieu' }}</span>
          </div>
          <PlaceFavoriteButton :place-id="place.id" :place-name="place.name" @change="emit('favorite-change', $event)" />
        </div>

        <PlaceDogStatusBadge :place="place" />

        <div v-if="place.cuisine" class="mt-2 flex">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-paw-orange-500/15 px-3 py-1">
            <span class="text-sm" aria-hidden="true">🍽️</span>
            <span class="text-xs font-medium text-paw-orange-300">{{ place.cuisine.replace(/;/g, ', ') }}</span>
          </span>
        </div>
      </div>

      <p v-if="place.description" class="mb-6 text-sm leading-relaxed text-white/80">
        {{ place.description }}
      </p>

      <PlaceInfoList :place="place" class="mb-6" />

      <div class="mb-6 rounded-2xl bg-paw-brown-800/30 p-4">
        <PlaceAlerts :place-id="place.id" />
      </div>

      <div class="mb-6 rounded-2xl bg-paw-brown-800/30 p-4">
        <PlaceReviews :place-id="place.id" />
      </div>

      <div class="space-y-3">
        <a
          :href="itineraryUrl"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="`Itinéraire vers ${place.name} dans Google Maps (nouvel onglet)`"
          class="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-paw-brown-900 shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
          </svg>
          Itinéraire
        </a>
        <slot />
      </div>
    </div>
  </div>
</template>
