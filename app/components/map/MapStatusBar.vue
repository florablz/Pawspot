<script setup lang="ts">
/**
 * Barre d'état sous la carte : nombre de lieux affichés (toujours visible),
 * chargement, erreur + « Réessayer », et bandeaux d'information. Le tout est
 * dans une seule région `role="status"` permanente : seul son contenu change,
 * ce qui garantit l'annonce par les lecteurs d'écran.
 */
const props = defineProps<{
  /** Lieux affichés après filtres. */
  count: number
  /** Lieux chargés pour la zone (avant filtres). */
  loadedCount: number
  /** Une zone a déjà été chargée. */
  loaded: boolean
  filtersActive: boolean
  /** Filtre « Chiens acceptés confirmés uniquement » actif. */
  confirmedOnly?: boolean
  fetching: boolean
  error: string | null
  stale: boolean
  zoomTooLow: boolean
  /** La zone ne touche aucun territoire français (hors couverture de PawSpot). */
  outsideCoverage?: boolean
  truncated: boolean
  incomplete: boolean
  /** Message quand la géolocalisation a échoué et que rien n'est chargé. */
  locationMessage: string | null
  /** Géolocalisation en cours (rien à annoncer tant qu'elle n'a pas abouti). */
  locating?: boolean
}>()

defineEmits<{
  'retry': []
  'clear-filters': []
  'disable-confirmed': []
  /** « Chercher une ville » (géolocalisation refusée). */
  'focus-search': []
}>()

/**
 * OpenStreetMap ne répond pas et notre sauvegarde n'a rien pour cette zone :
 * un seul message (pas de « 0 lieu affiché », « Aucun lieu trouvé » ni « Compléter »).
 */
const unavailable = computed(() =>
  props.stale && props.loaded && props.loadedCount === 0 && !props.outsideCoverage && !props.error,
)

const countText = computed(() => {
  if (unavailable.value) return null
  // Rien de chargé : pas de « 0 lieu affiché » trompeur.
  if (!props.loaded) {
    if (props.fetching || props.locating || props.locationMessage) return null
    return 'Zoomez pour afficher les lieux'
  }
  const n = props.count
  const base = `${n} lieu${n > 1 ? 'x' : ''} affiché${n > 1 ? 's' : ''}`
  return props.filtersActive && props.loadedCount !== n ? `${base} sur ${props.loadedCount}` : base
})

/** Le filtre « confirmés » vide la carte alors que des lieux sont chargés. */
const confirmedEmpty = computed(() =>
  !!props.confirmedOnly && props.loaded && !props.fetching && !props.error && props.count === 0 && props.loadedCount > 0,
)

const emptyText = computed(() => {
  if (!props.loaded || props.fetching || props.error || props.count > 0 || unavailable.value) return null
  if (confirmedEmpty.value) return null
  if (props.filtersActive && props.loadedCount > 0) return 'Aucun lieu ne correspond à vos filtres.'
  if (props.zoomTooLow || props.outsideCoverage) return null
  return 'Aucun lieu trouvé dans cette zone.'
})

/** La barre principale a quelque chose à montrer (sinon on ne garde que les bandeaux). */
const showMain = computed(() =>
  !!countText.value || (props.filtersActive && !unavailable.value) || props.fetching || !!props.error || !!emptyText.value || confirmedEmpty.value,
)

const actionBtn = 'min-h-[44px] shrink-0 rounded-full px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
const notice = 'pointer-events-auto rounded-xl border border-white/10 bg-paw-brown-900/90 px-4 py-2.5 text-xs text-white/90 backdrop-blur'
const orangeBtn = 'bg-paw-orange-500/20 text-paw-orange-300 hover:bg-paw-orange-500/40'
</script>

<template>
  <div class="mx-auto flex max-w-md flex-col gap-2" role="status" aria-live="polite" data-testid="map-status">
    <!-- Bandeaux d'information (discrets) -->
    <div v-if="locationMessage" :class="[notice, 'flex flex-col gap-2']" data-testid="notice-location">
      <p><span aria-hidden="true">📍</span> {{ locationMessage }}</p>
      <button type="button" :class="[actionBtn, orangeBtn, 'self-start']" @click="$emit('focus-search')">
        Chercher une ville
      </button>
    </div>
    <p v-if="outsideCoverage && loaded" :class="notice" data-testid="notice-outside-coverage">
      <span aria-hidden="true">🗺️</span> PawSpot couvre la France et les territoires d'outre-mer : revenez sur une zone française pour voir les lieux.
    </p>
    <p v-if="zoomTooLow && loaded && !outsideCoverage" :class="notice" data-testid="notice-zoom">
      <span aria-hidden="true">🔍</span> Zoomez sur une ville pour voir tous les lieux.
    </p>
    <p v-if="truncated" :class="notice" data-testid="notice-truncated">
      <span aria-hidden="true">🔍</span> Trop de lieux dans cette zone : zoomez pour tous les afficher.
    </p>
    <div v-if="unavailable" :class="[notice, 'flex items-center justify-between gap-3 py-1.5 text-paw-orange-200']" data-testid="notice-unavailable">
      <span>
        <span aria-hidden="true">⚠️</span> Impossible de charger les lieux de cette zone : OpenStreetMap ne répond pas pour l'instant.
      </span>
      <button v-if="!fetching" type="button" :class="[actionBtn, orangeBtn]" @click="$emit('retry')">
        Réessayer
      </button>
    </div>
    <div v-else-if="stale" :class="[notice, 'flex items-center justify-between gap-3 py-1.5 text-paw-orange-200']" data-testid="notice-stale">
      <span>
        <span aria-hidden="true">⚠️</span> Lieux affichés depuis notre sauvegarde : OpenStreetMap ne répond pas pour l'instant, certaines infos peuvent dater.
      </span>
      <button v-if="!fetching" type="button" :class="[actionBtn, orangeBtn]" @click="$emit('retry')">
        Réessayer
      </button>
    </div>
    <div v-if="incomplete && !fetching && !error && !unavailable" :class="[notice, 'flex items-center justify-between gap-3 py-1.5']" data-testid="notice-incomplete">
      <span>Une partie de la zone n'a pas encore été chargée.</span>
      <button type="button" :class="[actionBtn, orangeBtn]" @click="$emit('retry')">
        Compléter
      </button>
    </div>

    <!-- Barre principale -->
    <div v-if="showMain" class="pointer-events-auto flex flex-col gap-1 rounded-2xl border border-white/10 bg-paw-brown-900/90 px-5 py-2.5 backdrop-blur">
      <div v-if="countText || (filtersActive && !unavailable)" class="flex min-h-[44px] items-center justify-between gap-3">
        <p class="text-sm font-semibold text-white" data-testid="places-count">{{ countText }}</p>
        <button
          v-if="filtersActive"
          type="button"
          :class="[actionBtn, 'bg-paw-green-700/30 text-paw-green-300 hover:bg-paw-green-700/50']"
          @click="$emit('clear-filters')"
        >
          Effacer les filtres
        </button>
      </div>

      <div v-if="fetching" class="flex min-h-[28px] items-center gap-2 text-sm text-paw-orange-300" data-testid="loading">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" aria-hidden="true" />
        Chargement des lieux…
      </div>

      <div v-if="error && !fetching" class="flex items-center justify-between gap-3 text-sm text-white/90" role="alert">
        <span>{{ error }}</span>
        <button type="button" :class="[actionBtn, orangeBtn]" @click="$emit('retry')">
          Réessayer
        </button>
      </div>

      <p v-if="emptyText" class="pb-1 text-xs text-white/70">{{ emptyText }}</p>

      <div v-if="confirmedEmpty" class="flex flex-col gap-2 pb-1" data-testid="notice-confirmed-empty">
        <p class="text-xs text-white/90">
          Aucun lieu n'est encore confirmé par la communauté ici. Désactivez ce filtre pour voir les lieux probables.
        </p>
        <button
          type="button"
          :class="[actionBtn, 'self-start bg-paw-green-700/30 text-paw-green-300 hover:bg-paw-green-700/50']"
          @click="$emit('disable-confirmed')"
        >
          Désactiver le filtre « Confirmés »
        </button>
      </div>
    </div>
  </div>
</template>
