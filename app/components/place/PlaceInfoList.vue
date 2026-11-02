<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Horaires, téléphone, site web et coordonnées d'un lieu.
 * `place.website` est déjà filtré côté serveur (http(s) uniquement) : on
 * l'utilise tel quel et on ne construit jamais d'`href` à partir d'une autre donnée.
 */
defineProps<{
  place: Pick<Place, 'openingHours' | 'phone' | 'website' | 'lat' | 'lon'>
}>()

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}
</script>

<template>
  <div class="space-y-2.5">
    <div v-if="place.openingHours" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
      <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
      <div>
        <p class="text-[11px] font-medium uppercase tracking-wider text-white/60">Horaires</p>
        <p class="whitespace-pre-line text-sm text-white">{{ place.openingHours.replace(/;\s*/g, '\n') }}</p>
      </div>
    </div>

    <div v-if="place.phone" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
      <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      <div>
        <p class="text-[11px] font-medium uppercase tracking-wider text-white/60">Téléphone</p>
        <a :href="telHref(place.phone)" class="inline-flex min-h-[44px] items-center text-sm text-paw-orange-400 transition hover:text-paw-orange-300">
          {{ place.phone }}
        </a>
      </div>
    </div>

    <div v-if="place.website" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
      <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <div class="min-w-0">
        <p class="text-[11px] font-medium uppercase tracking-wider text-white/60">Site web</p>
        <a
          :href="place.website"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-h-[44px] items-center truncate text-sm text-paw-orange-400 transition hover:text-paw-orange-300"
        >
          {{ place.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') }}
          <span class="sr-only">(nouvel onglet)</span>
        </a>
      </div>
    </div>

    <div class="flex items-start gap-3 rounded-xl bg-paw-brown-800/40 p-3">
      <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-4 w-4 shrink-0 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
      </svg>
      <p class="text-xs text-white/60">
        <span class="sr-only">Coordonnées : </span>{{ place.lat.toFixed(5) }}, {{ place.lon.toFixed(5) }}
      </p>
    </div>
  </div>
</template>
