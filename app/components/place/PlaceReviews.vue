<script setup lang="ts">
const props = defineProps<{ placeId: string }>()

const { user, loggedIn } = useAuth()

const reviews = ref<any[]>([])
const loadingReviews = ref(false)
const showForm = ref(false)
const rating = ref(0)
const hoverRating = ref(0)
const comment = ref('')
const photos = ref<string[]>([])
const submitting = ref(false)
const errorMsg = ref('')

const averageRating = computed(() => {
  if (!reviews.value.length) return 0
  const sum = reviews.value.reduce((acc, r) => acc + r.rating, 0)
  return Math.round((sum / reviews.value.length) * 10) / 10
})

async function loadReviews() {
  loadingReviews.value = true
  try {
    reviews.value = await $fetch<any[]>(`/api/reviews/${props.placeId}`)
  } catch { /* ignore */ } finally {
    loadingReviews.value = false
  }
}

function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of Array.from(files)) {
    if (photos.value.length >= 5) break
    const reader = new FileReader()
    reader.onload = () => {
      photos.value.push(reader.result as string)
    }
    reader.readAsDataURL(file)
  }
}

function removePhoto(index: number) {
  photos.value.splice(index, 1)
}

async function submit() {
  if (rating.value < 1) {
    errorMsg.value = 'Choisis une note'
    return
  }
  errorMsg.value = ''
  submitting.value = true
  try {
    const review = await $fetch<any>('/api/reviews', {
      method: 'POST',
      body: {
        placeId: props.placeId,
        rating: rating.value,
        comment: comment.value,
        photos: photos.value,
      },
    })
    reviews.value.unshift(review)
    showForm.value = false
    rating.value = 0
    comment.value = ''
    photos.value = []
  } catch (err: any) {
    errorMsg.value = err?.data?.message || err?.statusMessage || 'Erreur'
  } finally {
    submitting.value = false
  }
}

function timeAgo(date: string | Date) {
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "a l'instant"
  if (mins < 60) return `il y a ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days}j`
  return d.toLocaleDateString('fr-FR')
}

watch(() => props.placeId, () => loadReviews(), { immediate: true })
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-white">Avis</h3>
        <div v-if="reviews.length" class="flex items-center gap-1 rounded-full bg-paw-orange-500/15 px-2.5 py-0.5">
          <span class="text-xs text-paw-orange-400">{{ averageRating }}</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-paw-orange-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span class="text-xs text-white/40">({{ reviews.length }})</span>
        </div>
      </div>
      <button
        v-if="loggedIn && !showForm"
        class="rounded-full bg-paw-orange-500/20 px-3 py-1.5 text-xs font-medium text-paw-orange-400 transition hover:bg-paw-orange-500/40"
        @click="showForm = true"
      >
        + Donner un avis
      </button>
      <NuxtLink
        v-else-if="!loggedIn"
        to="/login"
        class="rounded-full bg-paw-orange-500/20 px-3 py-1.5 text-xs font-medium text-paw-orange-400 transition hover:bg-paw-orange-500/40"
      >
        Connecte-toi pour donner un avis
      </NuxtLink>
    </div>

    <!-- Review form -->
    <div v-if="showForm" class="mb-5 rounded-2xl bg-paw-brown-800/60 p-4">
      <!-- Stars -->
      <div class="mb-3 flex items-center gap-1">
        <button
          v-for="i in 5"
          :key="i"
          class="transition"
          @click="rating = i"
          @mouseenter="hoverRating = i"
          @mouseleave="hoverRating = 0"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-7 w-7 transition"
            :class="i <= (hoverRating || rating) ? 'text-paw-orange-400' : 'text-white/15'"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      </div>

      <!-- Comment -->
      <textarea
        v-model="comment"
        class="mb-3 w-full resize-none rounded-xl bg-paw-brown-900/60 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
        rows="3"
        placeholder="Ton avis (optionnel)..."
      />

      <!-- Photos -->
      <div class="mb-3">
        <div v-if="photos.length" class="mb-2 flex gap-2 overflow-x-auto pb-1">
          <div v-for="(photo, i) in photos" :key="i" class="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
            <img :src="photo" class="h-full w-full object-cover">
            <button
              class="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white"
              @click="removePhoto(i)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <label v-if="photos.length < 5" class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/50 transition hover:bg-white/10 hover:text-white/70">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          Ajouter des photos
          <input type="file" accept="image/*" multiple class="hidden" @change="onFileChange">
        </label>
      </div>

      <div v-if="errorMsg" class="mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{{ errorMsg }}</div>

      <div class="flex gap-2">
        <button
          :disabled="submitting"
          class="flex-1 rounded-xl bg-paw-orange-500 py-2.5 text-sm font-semibold text-white transition hover:bg-paw-orange-400 active:scale-[0.98] disabled:opacity-50"
          @click="submit"
        >
          {{ submitting ? 'Envoi...' : 'Publier' }}
        </button>
        <button
          class="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/50 transition hover:text-white"
          @click="showForm = false; rating = 0; comment = ''; photos = []"
        >
          Annuler
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loadingReviews" class="flex justify-center py-4">
      <div class="h-5 w-5 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" />
    </div>

    <!-- Reviews list -->
    <div v-else-if="reviews.length" class="space-y-3">
      <div v-for="review in reviews" :key="review.id" class="rounded-xl bg-paw-brown-800/40 p-4">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-full bg-paw-orange-500/20 text-xs font-bold uppercase text-paw-orange-400">
              {{ review.username?.charAt(0) || '?' }}
            </div>
            <span class="text-sm font-medium text-white">{{ review.username }}</span>
          </div>
          <span class="text-xs text-white/30">{{ timeAgo(review.createdAt) }}</span>
        </div>

        <!-- Stars -->
        <div class="mb-2 flex gap-0.5">
          <svg
            v-for="i in 5"
            :key="i"
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            :class="i <= review.rating ? 'text-paw-orange-400' : 'text-white/10'"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>

        <p v-if="review.comment" class="text-sm leading-relaxed text-white/70">{{ review.comment }}</p>

        <!-- Photos -->
        <div v-if="review.photos?.length" class="mt-3 flex gap-2 overflow-x-auto">
          <img
            v-for="(photo, i) in review.photos"
            :key="i"
            :src="photo"
            class="h-20 w-20 shrink-0 rounded-lg object-cover"
          >
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <p v-else class="py-4 text-center text-sm text-white/30">Aucun avis pour le moment</p>
  </div>
</template>
