<script setup lang="ts">
import type { PawspotPlace } from '~/types/places'

const { loggedIn } = useAuth()
const favorites = ref<any[]>([])
const loading = ref(true)
const selectedFav = ref<any | null>(null)
const placeDetail = ref<PawspotPlace | null>(null)
const loadingDetail = ref(false)

const categoryIcons: Record<string, string> = {
  park: '\u{1F333}',
  dog_park: '\u{1F43E}',
  beach: '\u{1F30A}',
  restaurant: '\u{1F37D}\uFE0F',
  bar: '\u{1F37A}',
  cafe: '\u2615',
  vet: '\u{1FA7A}',
}

async function loadFavorites() {
  loading.value = true
  try {
    favorites.value = await $fetch<any[]>('/api/favorites')
  } catch { /* ignore */ } finally {
    loading.value = false
  }
}

async function selectFav(fav: any) {
  selectedFav.value = fav
  loadingDetail.value = true
  try {
    const data = await $fetch<{ places: PawspotPlace[] }>('/api/places', {
      query: { lat: fav.placeLat, lon: fav.placeLon, radius: 200 },
    })
    placeDetail.value = data.places.find(p => p.id === fav.placeId) || {
      id: fav.placeId,
      name: fav.placeName,
      lat: fav.placeLat,
      lon: fav.placeLon,
      category: fav.placeCategory,
    } as PawspotPlace
  } catch {
    placeDetail.value = {
      id: fav.placeId,
      name: fav.placeName,
      lat: fav.placeLat,
      lon: fav.placeLon,
      category: fav.placeCategory,
    } as PawspotPlace
  } finally {
    loadingDetail.value = false
  }
}

async function removeFavorite(fav: any) {
  try {
    await $fetch('/api/favorites', {
      method: 'POST',
      body: {
        placeId: fav.placeId,
        placeName: fav.placeName,
        placeLat: fav.placeLat,
        placeLon: fav.placeLon,
        placeCategory: fav.placeCategory,
      },
    })
    favorites.value = favorites.value.filter(f => f.id !== fav.id)
    if (selectedFav.value?.id === fav.id) {
      selectedFav.value = null
      placeDetail.value = null
    }
  } catch { /* ignore */ }
}

function closeDetail() {
  selectedFav.value = null
  placeDetail.value = null
}

function googleMapsUrl(place: PawspotPlace) {
  return `https://www.google.com/maps/dir//${place.lat},${place.lon}`
}

function timeAgo(date: string | Date) {
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days}j`
  return d.toLocaleDateString('fr-FR')
}

onMounted(() => {
  if (!loggedIn.value) {
    navigateTo('/login')
  } else {
    loadFavorites()
  }
})
</script>

<template>
  <div class="flex h-[100dvh] bg-paw-brown-900">
    <!-- Left: favorites list -->
    <div class="flex w-full flex-col overflow-hidden md:w-96 md:shrink-0 md:border-r md:border-white/5" :class="{ 'hidden md:flex': selectedFav }">
      <!-- Header -->
      <div class="shrink-0 border-b border-white/5 bg-paw-brown-900/95 backdrop-blur">
        <div class="flex items-center gap-3 px-5 py-4">
          <NuxtLink
            to="/"
            class="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </NuxtLink>
          <h1 class="text-lg font-bold text-white">Mes favoris</h1>
          <span v-if="favorites.length" class="rounded-full bg-paw-orange-500/15 px-2.5 py-0.5 text-xs text-paw-orange-400">
            {{ favorites.length }}
          </span>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex flex-1 items-center justify-center">
        <div class="h-6 w-6 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" />
      </div>

      <!-- List -->
      <div v-else-if="favorites.length" class="flex-1 overflow-y-auto px-3 py-3">
        <div class="space-y-2">
          <button
            v-for="fav in favorites"
            :key="fav.id"
            class="flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition active:scale-[0.98]"
            :class="selectedFav?.id === fav.id
              ? 'bg-paw-orange-500/10 ring-1 ring-paw-orange-500/30'
              : 'bg-paw-brown-800/40 hover:bg-paw-brown-800/60'"
            @click="selectFav(fav)"
          >
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-paw-brown-800 text-xl">
              {{ categoryIcons[fav.placeCategory] || '\u{1F4CD}' }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-white">{{ fav.placeName }}</p>
              <p class="text-xs text-white/40">
                <span class="capitalize">{{ fav.placeCategory.replace('_', ' ') }}</span>
                <span class="mx-1">&middot;</span>
                {{ timeAgo(fav.createdAt) }}
              </p>
            </div>
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-paw-orange-400 transition hover:bg-red-500/20 hover:text-red-400"
              title="Retirer des favoris"
              @click.stop="removeFavorite(fav)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-1 flex-col items-center justify-center px-5 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="mb-4 h-12 w-12 text-white/10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        <p class="text-sm text-white/40">Aucun favori pour le moment</p>
        <p class="mt-1 text-xs text-white/25">Explore la carte et ajoute des lieux en favoris</p>
        <NuxtLink to="/" class="mt-4 rounded-full bg-paw-orange-500/20 px-4 py-2 text-sm font-medium text-paw-orange-400 transition hover:bg-paw-orange-500/40">
          Explorer la carte
        </NuxtLink>
      </div>
    </div>

    <!-- Right: detail panel -->
    <div
      v-if="selectedFav"
      class="flex w-full flex-1 flex-col overflow-hidden"
    >
      <!-- Detail header -->
      <div class="shrink-0 border-b border-white/5 bg-paw-brown-900/95 backdrop-blur">
        <div class="flex items-center gap-3 px-5 py-4">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white md:hidden"
            @click="closeDetail"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-paw-brown-800 text-lg">
            {{ categoryIcons[selectedFav.placeCategory] || '\u{1F4CD}' }}
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-base font-bold text-white">{{ selectedFav.placeName }}</h2>
            <span class="text-xs capitalize text-white/40">{{ selectedFav.placeCategory.replace('_', ' ') }}</span>
          </div>
          <button
            class="hidden h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white md:flex"
            @click="closeDetail"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <!-- Detail content -->
      <div class="flex-1 overflow-y-auto">
        <!-- Loading -->
        <div v-if="loadingDetail" class="flex items-center justify-center py-20">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" />
        </div>

        <div v-else-if="placeDetail" class="mx-auto max-w-lg px-5 py-6">
          <!-- Photo -->
          <div v-if="placeDetail.image" class="mb-6 overflow-hidden rounded-2xl">
            <img
              :src="placeDetail.image"
              :alt="placeDetail.name"
              class="h-48 w-full object-cover"
              @error="($event.target as HTMLImageElement).parentElement!.style.display = 'none'"
            >
          </div>

          <!-- Dog friendly badge -->
          <div v-if="placeDetail.dog && placeDetail.dog !== 'no'" class="mb-4 inline-flex items-center gap-1.5 rounded-full bg-paw-green-700/30 px-3 py-1">
            <span class="text-sm">{{'🐕'}}</span>
            <span class="text-xs font-medium text-paw-green-400 capitalize">{{ placeDetail.dog }}</span>
          </div>

          <!-- Cuisine -->
          <div v-if="placeDetail.cuisine" class="mb-4 inline-flex items-center gap-1.5 rounded-full bg-paw-orange-500/15 px-3 py-1">
            <span class="text-sm">{{'🍽️'}}</span>
            <span class="text-xs font-medium text-paw-orange-400">{{ placeDetail.cuisine.replace(/;/g, ', ') }}</span>
          </div>

          <!-- Description -->
          <p v-if="placeDetail.description" class="mb-5 text-sm leading-relaxed text-white/70">{{ placeDetail.description }}</p>

          <!-- Info cards -->
          <div class="mb-5 space-y-2.5">
            <div v-if="placeDetail.openingHours" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
              </svg>
              <div>
                <p class="text-[11px] font-medium uppercase tracking-wider text-white/40">Horaires</p>
                <p class="text-sm text-white whitespace-pre-line">{{ placeDetail.openingHours.replace(/;/g, '\n') }}</p>
              </div>
            </div>

            <div v-if="placeDetail.phone" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <div>
                <p class="text-[11px] font-medium uppercase tracking-wider text-white/40">Telephone</p>
                <a :href="'tel:' + placeDetail.phone" class="text-sm text-paw-orange-400 hover:text-paw-orange-300 transition">{{ placeDetail.phone }}</a>
              </div>
            </div>

            <div v-if="placeDetail.website" class="flex items-start gap-3 rounded-xl bg-paw-brown-800/60 p-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-5 w-5 shrink-0 text-paw-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <div class="min-w-0">
                <p class="text-[11px] font-medium uppercase tracking-wider text-white/40">Site web</p>
                <a :href="placeDetail.website" target="_blank" rel="noopener noreferrer" class="block truncate text-sm text-paw-orange-400 hover:text-paw-orange-300 transition">
                  {{ placeDetail.website.replace(/^https?:\/\/(www\.)?/, '') }}
                </a>
              </div>
            </div>

            <div class="flex items-start gap-3 rounded-xl bg-paw-brown-800/40 p-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-4 w-4 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
              </svg>
              <p class="text-xs text-white/40">{{ placeDetail.lat.toFixed(5) }}, {{ placeDetail.lon.toFixed(5) }}</p>
            </div>
          </div>

          <!-- Alerts -->
          <div class="mb-5 rounded-2xl bg-paw-brown-800/30 p-4">
            <PlaceAlerts :place-id="placeDetail.id" />
          </div>

          <!-- Reviews -->
          <div class="mb-5 rounded-2xl bg-paw-brown-800/30 p-4">
            <PlaceReviews :place-id="placeDetail.id" />
          </div>

          <!-- Actions -->
          <div class="space-y-3 pb-6">
            <a
              :href="googleMapsUrl(placeDetail)"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
              </svg>
              Voir l'adresse
            </a>

            <button
              class="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 px-5 py-3 text-sm font-medium text-red-400 transition hover:bg-red-500/10 active:scale-[0.98]"
              @click="removeFavorite(selectedFav)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              Retirer des favoris
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- No selection placeholder (desktop only) -->
    <div v-else class="hidden flex-1 items-center justify-center md:flex">
      <div class="text-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto mb-3 h-10 w-10 text-white/10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="m15 18-6-6 6-6" />
        </svg>
        <p class="text-sm text-white/30">Selectionne un favori pour voir ses infos</p>
      </div>
    </div>
  </div>
</template>
