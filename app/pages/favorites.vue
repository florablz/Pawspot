<script setup lang="ts">
import { CATEGORIES, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { FavoritePlace } from '~/types/api'

const { loggedIn } = useAuth()
const { setFavorite } = useFavorites()

const favorites = ref<FavoritePlace[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const selectedId = ref<string | null>(null)

const selected = computed(() => favorites.value.find(f => f.id === selectedId.value) ?? null)

async function loadFavorites() {
  loading.value = true
  loadError.value = null
  try {
    favorites.value = await $fetch<FavoritePlace[]>('/api/favorites')
  }
  catch (err: unknown) {
    loadError.value = getApiErrorMessage(err, 'Impossible de charger tes favoris.')
  }
  finally {
    loading.value = false
  }
}

function dropFromList(placeId: string) {
  favorites.value = favorites.value.filter(f => f.id !== placeId)
  if (selectedId.value === placeId) selectedId.value = null
}

async function removeFavorite(fav: FavoritePlace) {
  actionError.value = null
  try {
    await setFavorite(fav.id, false)
    dropFromList(fav.id)
  }
  catch (err: unknown) {
    actionError.value = getApiErrorMessage(err, 'Impossible de retirer ce favori.')
  }
}

function onFavoriteChange(placeId: string, favorited: boolean) {
  if (!favorited) dropFromList(placeId)
}

function categoryOf(fav: FavoritePlace) {
  return CATEGORIES[fav.category]
}

onMounted(() => {
  if (!loggedIn.value) navigateTo('/login')
  else loadFavorites()
})
</script>

<template>
  <div class="flex h-[100dvh] bg-paw-brown-900">
    <!-- Liste des favoris -->
    <div class="flex w-full flex-col overflow-hidden md:w-96 md:shrink-0 md:border-r md:border-white/5" :class="{ 'hidden md:flex': selected }">
      <div class="shrink-0 border-b border-white/5 bg-paw-brown-900/95 backdrop-blur">
        <div class="flex items-center gap-3 px-3 py-2">
          <NuxtLink
            to="/"
            aria-label="Retour à la carte"
            class="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </NuxtLink>
          <h1 class="text-lg font-bold text-white">Mes favoris</h1>
          <span v-if="favorites.length" class="rounded-full bg-paw-orange-500/15 px-2.5 py-0.5 text-xs text-paw-orange-300">
            {{ favorites.length }}<span class="sr-only"> favori{{ favorites.length > 1 ? 's' : '' }}</span>
          </span>
        </div>
      </div>

      <p v-if="actionError" class="mx-3 mt-3 rounded-xl bg-paw-red-700/20 px-3 py-2 text-xs text-paw-red-300" role="alert">{{ actionError }}</p>

      <div v-if="loading" class="flex flex-1 items-center justify-center" role="status">
        <span class="h-6 w-6 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" aria-hidden="true" />
        <span class="sr-only">Chargement des favoris…</span>
      </div>

      <div v-else-if="loadError" class="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center" role="alert">
        <p class="text-sm text-white/80">{{ loadError }}</p>
        <button type="button" class="min-h-[44px] rounded-full bg-paw-orange-500/20 px-5 text-sm font-medium text-paw-orange-300 hover:bg-paw-orange-500/40" @click="loadFavorites">
          Réessayer
        </button>
      </div>

      <ul v-else-if="favorites.length" class="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <li
          v-for="fav in favorites"
          :key="fav.id"
          class="flex items-center gap-2 rounded-2xl p-2 transition"
          :class="selectedId === fav.id ? 'bg-paw-orange-500/10 ring-1 ring-paw-orange-500/30' : 'bg-paw-brown-800/40 hover:bg-paw-brown-800/60'"
        >
          <button
            type="button"
            class="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left"
            :aria-current="selectedId === fav.id ? 'true' : undefined"
            @click="selectedId = fav.id"
          >
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paw-brown-800 text-xl" aria-hidden="true">
              {{ categoryOf(fav)?.icon ?? DEFAULT_CATEGORY_ICON }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-white">{{ fav.name }}</span>
              <span class="block text-xs text-white/60">
                {{ categoryOf(fav)?.singular ?? 'Lieu' }}
                <span aria-hidden="true">&middot;</span>
                ajouté {{ formatTimeAgo(fav.favoritedAt) }}
              </span>
              <PlaceDogStatusBadge :place="fav" compact class="mt-1" />
            </span>
          </button>
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-paw-orange-400 transition hover:bg-paw-red-700/30 hover:text-paw-red-300"
            :aria-label="`Retirer ${fav.name} des favoris`"
            @click="removeFavorite(fav)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        </li>
      </ul>

      <div v-else class="flex flex-1 flex-col items-center justify-center px-5 text-center">
        <p class="text-sm text-white/70">Aucun favori pour le moment</p>
        <p class="mt-1 text-xs text-white/50">Explore la carte et ajoute des lieux en favoris</p>
        <NuxtLink to="/" class="mt-4 flex min-h-[44px] items-center rounded-full bg-paw-orange-500/20 px-5 text-sm font-medium text-paw-orange-300 transition hover:bg-paw-orange-500/40">
          Explorer la carte
        </NuxtLink>
      </div>
    </div>

    <!-- Fiche du favori sélectionné -->
    <div v-if="selected" class="flex w-full flex-1 flex-col overflow-hidden">
      <div class="shrink-0 border-b border-white/5 bg-paw-brown-900/95 backdrop-blur">
        <div class="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            aria-label="Retour à la liste des favoris"
            class="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white md:hidden"
            @click="selectedId = null"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <p class="min-w-0 flex-1 truncate text-sm text-white/70">Fiche du lieu</p>
          <button
            type="button"
            aria-label="Fermer la fiche"
            class="hidden h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 transition hover:bg-white/10 hover:text-white md:flex"
            @click="selectedId = null"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <PlaceDetails :place="selected" @favorite-change="onFavoriteChange(selected.id, $event)">
          <button
            type="button"
            class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-paw-red-300/30 px-5 text-sm font-medium text-paw-red-300 transition hover:bg-paw-red-700/20 active:scale-[0.98]"
            @click="removeFavorite(selected)"
          >
            Retirer des favoris
          </button>
        </PlaceDetails>
      </div>
    </div>

    <div v-else class="hidden flex-1 items-center justify-center md:flex">
      <p class="text-sm text-white/50">Sélectionne un favori pour voir ses infos</p>
    </div>
  </div>
</template>
