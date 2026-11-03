<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Contenu d'une fiche lieu (fiche de la carte et « Mes favoris »), dans l'ordre
 * du §3.5 : en-tête + statut chien, (retours chien : Phase 3), alertes, photo,
 * infos pratiques, actions, avis.
 * `embedded` : l'en-tête, « Itinéraire » et « Partager » sont affichés par le parent (partie
 * fixe de la fiche sur la carte). Le slot par défaut ajoute des actions.
 */
const props = defineProps<{
  place: Place
  embedded?: boolean
}>()

const emit = defineEmits<{ 'favorite-change': [favorited: boolean] }>()

const imageFailed = ref(false)
watch(() => props.place.id, () => { imageFailed.value = false })
</script>

<template>
  <div class="mx-auto max-w-lg space-y-6 px-5 pb-10">
    <PlaceHeader v-if="!embedded" :place="place" class="pt-6" @favorite-change="emit('favorite-change', $event)" />

    <PlaceStatusNotice :place="place" />

    <!-- §3.5 point 2 : « J'y suis allé avec mon chien » + résumé des retours (Phase 3). -->

    <div class="rounded-2xl bg-paw-brown-800/30 p-4">
      <PlaceAlerts :place-id="place.id" />
    </div>

    <div v-if="place.image && !imageFailed" class="relative h-48 w-full overflow-hidden rounded-2xl">
      <img
        :src="place.image"
        :alt="`Photo du lieu « ${place.name} »`"
        loading="lazy"
        referrerpolicy="no-referrer"
        class="h-full w-full object-cover"
        style="object-position: center 70%"
        @error="imageFailed = true"
      >
    </div>

    <p v-if="place.description" class="text-sm leading-relaxed text-white/80">
      {{ place.description }}
    </p>

    <PlaceInfoList :place="place" />

    <div v-if="!embedded || $slots.default" class="space-y-3">
      <div v-if="!embedded" class="flex gap-2">
        <PlaceItineraryLink :place="place" class="min-w-0 flex-1" />
        <PlaceShareButton :place="place" />
      </div>
      <slot />
    </div>

    <div class="rounded-2xl bg-paw-brown-800/30 p-4">
      <PlaceReviews :place-id="place.id" />
    </div>

    <p v-if="place.source === 'osm'" class="text-center text-xs text-white/60">
      Données ©
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        class="underline hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300"
      >les contributeurs d'OpenStreetMap</a>
    </p>
  </div>
</template>
