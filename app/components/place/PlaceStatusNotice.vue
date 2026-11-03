<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Bandeaux d'état d'un lieu (§3.5, point 4) : fermé, disparu d'OpenStreetMap,
 * ajouté par la communauté. Rien pour un lieu OSM actif.
 */
const props = defineProps<{ place: Pick<Place, 'status' | 'source'> }>()

const notice = computed(() => {
  if (props.place.status === 'closed') {
    return { icon: '⛔', text: 'Ce lieu est signalé fermé.', tone: 'border-paw-red-300/40 bg-paw-red-700/20 text-paw-red-200' }
  }
  if (props.place.status === 'removed') {
    return { icon: '⚠️', text: 'Ce lieu n\'apparaît plus sur OpenStreetMap : il a peut-être fermé ou n\'accepte plus les chiens.', tone: 'border-paw-orange-400/40 bg-paw-orange-700/20 text-paw-orange-200' }
  }
  if (props.place.source === 'user') {
    return { icon: '🐾', text: 'Ajouté par la communauté.', tone: 'border-white/10 bg-paw-brown-800/60 text-white/90' }
  }
  return null
})
</script>

<template>
  <p
    v-if="notice"
    class="flex items-start gap-2 rounded-xl border px-4 py-3 text-sm"
    :class="notice.tone"
    data-testid="place-status-notice"
    :data-status="place.status"
  >
    <span aria-hidden="true">{{ notice.icon }}</span>
    <span>{{ notice.text }}</span>
  </p>
</template>
