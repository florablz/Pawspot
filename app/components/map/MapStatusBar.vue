<script setup lang="ts">
/**
 * Barre d'état sous la carte : nombre de lieux affichés (toujours visible),
 * chargement, erreur + « Réessayer », et bandeaux d'information.
 */
const props = defineProps<{
  /** Lieux affichés après filtres. */
  count: number
  /** Lieux chargés pour la zone (avant filtres). */
  loadedCount: number
  /** Une zone a déjà été chargée. */
  loaded: boolean
  filtersActive: boolean
  fetching: boolean
  error: string | null
  stale: boolean
  zoomTooLow: boolean
  truncated: boolean
  incomplete: boolean
  /** Message quand la géolocalisation a échoué et que rien n'est chargé. */
  locationMessage: string | null
}>()

defineEmits<{
  'retry': []
  'clear-filters': []
}>()

const countText = computed(() => {
  const n = props.count
  const base = `${n} lieu${n > 1 ? 'x' : ''} affiché${n > 1 ? 's' : ''}`
  return props.filtersActive && props.loadedCount !== n ? `${base} sur ${props.loadedCount}` : base
})

const emptyText = computed(() => {
  if (!props.loaded || props.fetching || props.error || props.count > 0) return null
  if (props.filtersActive && props.loadedCount > 0) return 'Aucun lieu ne correspond à vos filtres.'
  if (props.zoomTooLow) return null
  return 'Aucun lieu trouvé dans cette zone.'
})

const actionBtn = 'min-h-[44px] shrink-0 rounded-full px-4 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paw-orange-300'
</script>

<template>
  <div class="mx-auto flex max-w-md flex-col gap-2">
    <!-- Bandeaux d'information (discrets) -->
    <p
      v-if="locationMessage"
      class="pointer-events-auto bg-paw-brown-900/90 backdrop-blur border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white/90"
      data-testid="notice-location"
    >
      <span aria-hidden="true">📍</span> {{ locationMessage }}
    </p>
    <p
      v-if="zoomTooLow && loaded"
      class="pointer-events-auto bg-paw-brown-900/90 backdrop-blur border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white/90"
      data-testid="notice-zoom"
    >
      <span aria-hidden="true">🔍</span> Zoomez pour voir les lieux : seuls les lieux déjà connus de PawSpot sont affichés à ce niveau.
    </p>
    <p
      v-if="truncated"
      class="pointer-events-auto bg-paw-brown-900/90 backdrop-blur border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white/90"
      data-testid="notice-truncated"
    >
      <span aria-hidden="true">🔍</span> Trop de lieux dans cette zone : zoomez pour tous les afficher.
    </p>
    <p
      v-if="stale"
      class="pointer-events-auto bg-paw-brown-900/90 backdrop-blur border border-white/10 rounded-xl px-4 py-2.5 text-xs text-paw-orange-200"
      data-testid="notice-stale"
    >
      <span aria-hidden="true">⚠️</span> Données en cache : le service de cartes ne répond pas
    </p>
    <div
      v-if="incomplete && !fetching && !error"
      class="pointer-events-auto bg-paw-brown-900/90 backdrop-blur border border-white/10 flex items-center justify-between gap-3 rounded-xl px-4 py-1.5 text-xs text-white/90"
      data-testid="notice-incomplete"
    >
      <span>Une partie de la zone n'a pas encore été chargée.</span>
      <button type="button" :class="[actionBtn, 'bg-paw-orange-500/20 text-paw-orange-300 hover:bg-paw-orange-500/40']" @click="$emit('retry')">
        Compléter
      </button>
    </div>

    <!-- Barre principale -->
    <div class="pointer-events-auto bg-paw-brown-900/90 backdrop-blur border border-white/10 flex flex-col gap-1 rounded-2xl px-5 py-2.5">
      <div class="flex min-h-[44px] items-center justify-between gap-3">
        <p class="text-sm text-white/80" aria-live="polite" data-testid="places-count">
          <span class="font-semibold text-white">{{ countText }}</span>
        </p>
        <button
          v-if="filtersActive"
          type="button"
          :class="[actionBtn, 'bg-paw-green-700/30 text-paw-green-300 hover:bg-paw-green-700/50']"
          @click="$emit('clear-filters')"
        >
          Effacer les filtres
        </button>
      </div>

      <div v-if="fetching" class="flex min-h-[28px] items-center gap-2 text-sm text-paw-orange-300" role="status">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" aria-hidden="true" />
        Chargement des lieux…
      </div>

      <div v-if="error && !fetching" class="flex items-center justify-between gap-3 text-sm text-white/90" role="alert">
        <span>{{ error }}</span>
        <button type="button" :class="[actionBtn, 'bg-paw-orange-500/20 text-paw-orange-300 hover:bg-paw-orange-500/40']" @click="$emit('retry')">
          Réessayer
        </button>
      </div>

      <p v-if="emptyText" class="pb-1 text-xs text-white/70">{{ emptyText }}</p>
    </div>
  </div>
</template>
