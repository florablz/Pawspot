<script setup lang="ts">
import { DOG_STATUS_LABELS, isDogStatusConfirmed } from '#shared/dogStatus'
import type { Place } from '#shared/types'

/**
 * Badge du statut chien (information n° 1) : emoji + texte + source, jamais la
 * couleur seule. `compact` : une ligne, pour les listes (la source reste lue
 * par les lecteurs d'écran).
 */
const props = defineProps<{
  place: Pick<Place, 'dogStatus' | 'dogStatusSource' | 'osmDogDetail'>
  compact?: boolean
}>()

const display = computed(() => DOG_STATUS_LABELS[props.place.dogStatus])
const tone = computed(() => DOG_STATUS_TONE[props.place.dogStatus])
const detail = computed(() => props.place.dogStatus === 'osm_conditional' ? props.place.osmDogDetail : undefined)
const confirmed = computed(() => isDogStatusConfirmed(props.place.dogStatus))

const TONE_CLASSES: Record<DogStatusTone, string> = {
  green: 'bg-paw-green-700/30 text-paw-green-300 ring-1 ring-paw-green-400/50',
  orange: 'bg-paw-orange-700/30 text-paw-orange-200 ring-1 ring-paw-orange-400/50',
  // Bordure en pointillés : « probablement », visuellement distinct d'un statut confirmé.
  yellow: 'bg-paw-yellow-400/10 text-paw-yellow-300 border border-dashed border-paw-yellow-400/70',
  gray: 'bg-paw-white/10 text-paw-gray-300 ring-1 ring-paw-gray-400/40',
  red: 'bg-paw-red-700/30 text-paw-red-300 ring-1 ring-paw-red-300/50',
}
</script>

<template>
  <div
    class="inline-flex max-w-full rounded-2xl"
    :class="[TONE_CLASSES[tone], compact ? 'items-center gap-1 px-2 py-1' : 'flex-col gap-0.5 px-3 py-2']"
    data-testid="dog-status-badge"
    :data-status="place.dogStatus"
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <span :class="compact ? 'text-xs' : 'text-sm'" aria-hidden="true">{{ display.emoji }}</span>
      <span class="sr-only">Statut chien : </span>
      <span class="font-semibold" :class="compact ? 'text-[11px] leading-tight' : 'text-sm'">{{ display.label }}</span>
      <span
        v-if="confirmed && !compact"
        class="shrink-0 rounded-full bg-paw-green-500/30 px-1.5 text-[10px] font-bold uppercase tracking-wide"
      >Confirmé</span>
    </span>
    <span v-if="detail" :class="compact ? 'sr-only' : 'text-xs opacity-90'">{{ detail }}</span>
    <span v-if="place.dogStatusSource" :class="compact ? 'sr-only' : 'text-xs opacity-80'">Source : {{ place.dogStatusSource }}</span>
  </div>
</template>
