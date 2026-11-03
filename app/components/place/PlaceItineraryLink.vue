<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Bouton « Itinéraire » (Google Maps pour l'instant ; le choix Google Maps /
 * Apple Plans / Waze viendra avec l'étape « itinéraire multi-apps »).
 */
const props = defineProps<{
  place: Pick<Place, 'name' | 'lat' | 'lon'>
  /** Position de l'utilisateur (jamais envoyée à PawSpot, seulement dans le lien). */
  origin?: { lat: number, lng: number } | null
}>()

const href = computed(() => {
  const o = props.origin ? `${props.origin.lat},${props.origin.lng}` : ''
  return `https://www.google.com/maps/dir/${o}/${props.place.lat},${props.place.lon}`
})
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="`Itinéraire vers ${place.name} dans Google Maps (nouvel onglet)`"
    class="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 text-sm font-semibold text-paw-brown-900 shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-200 focus-visible:ring-offset-2 focus-visible:ring-offset-paw-brown-900 motion-safe:active:scale-[0.98]"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
    </svg>
    Itinéraire
  </a>
</template>
