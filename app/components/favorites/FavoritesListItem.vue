<script setup lang="ts">
import { CATEGORIES, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { FavoritePlace } from '#shared/types'

/**
 * Ligne de « Mes favoris » : ouvrir la fiche (bouton principal), voir le lieu
 * sur la carte (`/lieu/<id>`), retirer des favoris.
 */
const props = defineProps<{
  favorite: FavoritePlace
  current: boolean
}>()

const emit = defineEmits<{ select: [], remove: [] }>()

const category = computed(() => CATEGORIES[props.favorite.category])

const iconBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
</script>

<template>
  <li
    class="flex items-center gap-1.5 rounded-2xl p-2 transition"
    :class="current ? 'bg-paw-orange-500/10 ring-1 ring-paw-orange-500/30' : 'bg-paw-brown-800/40 hover:bg-paw-brown-800/60'"
  >
    <button
      type="button"
      class="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300"
      :aria-current="current ? 'true' : undefined"
      @click="emit('select')"
    >
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paw-brown-800 text-xl" aria-hidden="true">
        {{ category?.icon ?? DEFAULT_CATEGORY_ICON }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-white">{{ favorite.name }}</span>
        <span class="block text-xs text-white/60">
          {{ category?.singular ?? 'Lieu' }}
          <span aria-hidden="true">&middot;</span>
          ajouté {{ formatTimeAgo(favorite.favoritedAt) }}
        </span>
        <PlaceDogStatusBadge :place="favorite" compact class="mt-1" />
      </span>
    </button>
    <NuxtLink
      :to="placePath(favorite.id)"
      :class="[iconBtn, 'bg-white/5 text-white/80 hover:bg-white/10 hover:text-white']"
      :aria-label="`Voir ${favorite.name} sur la carte`"
      title="Voir sur la carte"
      data-testid="favorite-map-link"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
        <path d="M15 5.764v15M9 3.236v15" />
      </svg>
    </NuxtLink>
    <button
      type="button"
      :class="[iconBtn, 'bg-paw-orange-500/20 text-paw-orange-400 hover:bg-paw-red-700/30 hover:text-paw-red-200']"
      :aria-label="`Retirer ${favorite.name} des favoris`"
      @click="emit('remove')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
  </li>
</template>
