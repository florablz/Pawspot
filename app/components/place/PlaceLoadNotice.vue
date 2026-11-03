<script setup lang="ts">
/**
 * Carte posée sous les filtres quand la fiche d'une URL `/lieu/…` ne peut pas
 * s'afficher : chargement, lieu introuvable (404) ou erreur (avec « Réessayer »).
 * La carte reste utilisable derrière.
 */
defineProps<{
  state: 'loading' | 'not-found' | 'error'
  message?: string | null
}>()

defineEmits<{ retry: [], close: [] }>()

const btn = 'min-h-[44px] rounded-full px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-[124px] z-[1100] px-3 lg:inset-x-auto lg:right-4 lg:top-4 lg:w-[380px]">
    <div
      class="pointer-events-auto glass-strong mx-auto max-w-md rounded-2xl px-5 py-4"
      :role="state === 'loading' ? 'status' : 'alert'"
      data-testid="place-load-notice"
      :data-state="state"
    >
      <div v-if="state === 'loading'" class="flex items-center gap-3 text-sm text-white">
        <span class="h-5 w-5 shrink-0 rounded-full border-2 border-paw-orange-400 border-t-transparent motion-safe:animate-spin" aria-hidden="true" />
        Chargement du lieu…
      </div>
      <template v-else>
        <p class="text-sm text-white">
          <span aria-hidden="true">{{ state === 'not-found' ? '🔍' : '⚠️' }}</span>
          {{ state === 'not-found' ? 'Ce lieu n\'existe plus ou est introuvable.' : (message || 'Impossible de charger ce lieu.') }}
        </p>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <button v-if="state === 'error'" type="button" :class="[btn, 'bg-paw-orange-500/20 text-paw-orange-300 hover:bg-paw-orange-500/40']" @click="$emit('retry')">
            Réessayer
          </button>
          <button type="button" :class="[btn, 'bg-white/10 text-white hover:bg-white/15']" @click="$emit('close')">
            Retour à la carte
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
