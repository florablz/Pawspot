<script setup lang="ts">
import { CATEGORIES, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { Place } from '#shared/types'

/**
 * En-tête d'une fiche (§3.5, point 1) : icône, nom, catégorie, favori, puis le
 * badge du statut chien avec sa source. Le titre reçoit le focus à l'ouverture
 * (`tabindex="-1"`). Le slot `actions` ajoute des boutons à droite (« Fermer »).
 */
const props = defineProps<{
  place: Place
  /** `id` du titre (cible d'`aria-labelledby`). */
  titleId?: string
}>()

const emit = defineEmits<{ 'favorite-change': [favorited: boolean] }>()

const category = computed(() => CATEGORIES[props.place.category])
</script>

<template>
  <div>
    <div class="flex items-start gap-3">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-paw-brown-800 text-2xl" aria-hidden="true">
        {{ category?.icon ?? DEFAULT_CATEGORY_ICON }}
      </span>
      <div class="min-w-0 flex-1 pt-0.5">
        <h2
          :id="titleId"
          tabindex="-1"
          class="line-clamp-2 rounded text-lg font-bold leading-tight text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300"
        >
          {{ place.name }}
        </h2>
        <span class="text-xs font-medium text-white/70">{{ category?.singular ?? 'Lieu' }}</span>
      </div>
      <PlaceFavoriteButton :place-id="place.id" :place-name="place.name" @change="emit('favorite-change', $event)" />
      <slot name="actions" />
    </div>

    <PlaceDogStatusBadge :place="place" class="mt-3" />

    <div v-if="place.cuisine" class="mt-2 flex">
      <span class="inline-flex items-center gap-1.5 rounded-full bg-paw-orange-500/15 px-3 py-1">
        <span class="text-sm" aria-hidden="true">🍽️</span>
        <span class="text-xs font-medium text-paw-orange-300">{{ place.cuisine.replace(/;/g, ', ') }}</span>
      </span>
    </div>
  </div>
</template>
