<script setup lang="ts">
import { REVIEW_COMMENT_MAX_LENGTH, REVIEW_MAX_PHOTOS, REVIEW_PHOTO_MAX_LENGTH } from '#shared/schemas'
import type { PlaceReview } from '~/types/api'

const props = defineProps<{ placeId: string }>()

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const { loggedIn } = useAuth()
const { loginLink } = useLoginLink()

const reviews = ref<PlaceReview[]>([])
const loadingReviews = ref(false)
const showForm = ref(false)
const rating = ref(0)
const hoverRating = ref(0)
const comment = ref('')
const photos = ref<string[]>([])
const submitting = ref(false)
const errorMsg = ref('')
const loadError = ref<string | null>(null)

const averageRating = computed(() => {
  if (!reviews.value.length) return 0
  const sum = reviews.value.reduce((acc, r) => acc + r.rating, 0)
  return Math.round((sum / reviews.value.length) * 10) / 10
})

async function loadReviews() {
  loadingReviews.value = true
  loadError.value = null
  try {
    reviews.value = await $fetch<PlaceReview[]>(`/api/reviews/${encodeURIComponent(props.placeId)}`)
  }
  catch (err: unknown) {
    loadError.value = getApiErrorMessage(err, 'Impossible de charger les avis.')
  }
  finally {
    loadingReviews.value = false
  }
}

function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  errorMsg.value = ''
  for (const file of Array.from(files)) {
    if (photos.value.length >= REVIEW_MAX_PHOTOS) {
      errorMsg.value = `${REVIEW_MAX_PHOTOS} photos maximum.`
      break
    }
    if (!PHOTO_TYPES.includes(file.type)) {
      errorMsg.value = 'Photo refusée : image JPEG, PNG ou WebP attendue.'
      continue
    }
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result as string
      if (data.length > REVIEW_PHOTO_MAX_LENGTH) {
        errorMsg.value = 'Photo trop lourde (2 Mo maximum).'
        return
      }
      if (photos.value.length < REVIEW_MAX_PHOTOS) photos.value.push(data)
    }
    reader.readAsDataURL(file)
  }
  ;(e.target as HTMLInputElement).value = ''
}

function removePhoto(index: number) {
  photos.value.splice(index, 1)
}

async function submit() {
  if (rating.value < 1) {
    errorMsg.value = 'Choisis une note de 1 à 5 étoiles.'
    return
  }
  errorMsg.value = ''
  submitting.value = true
  try {
    const review = await $fetch<PlaceReview>('/api/reviews', {
      method: 'POST',
      body: {
        placeId: props.placeId,
        rating: rating.value,
        comment: comment.value.trim() || undefined,
        photos: photos.value,
      },
    })
    reviews.value.unshift(review)
    showForm.value = false
    rating.value = 0
    comment.value = ''
    photos.value = []
  } catch (err: unknown) {
    errorMsg.value = getApiErrorMessage(err, 'Impossible de publier l\'avis.')
  } finally {
    submitting.value = false
  }
}

watch(() => props.placeId, () => loadReviews(), { immediate: true })
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-white">Avis</h3>
        <p v-if="reviews.length" class="flex items-center gap-1 rounded-full bg-paw-orange-500/15 px-2.5 py-0.5">
          <span class="sr-only">Note moyenne :</span>
          <span class="text-xs text-paw-orange-300">{{ averageRating.toLocaleString('fr-FR') }}</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-paw-orange-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span class="sr-only">sur 5,</span>
          <span class="text-xs text-white/60">({{ reviews.length }}<span class="sr-only"> avis</span>)</span>
        </p>
      </div>
      <button
        v-if="loggedIn && !showForm"
        type="button"
        class="min-h-[44px] rounded-full bg-paw-orange-500/20 px-4 text-xs font-medium text-paw-orange-300 transition hover:bg-paw-orange-500/40"
        @click="showForm = true"
      >
        + Donner un avis
      </button>
      <NuxtLink
        v-else-if="!loggedIn"
        :to="loginLink"
        class="flex min-h-[44px] items-center rounded-full bg-paw-orange-500/20 px-4 text-xs font-medium text-paw-orange-300 transition hover:bg-paw-orange-500/40"
      >
        Connecte-toi pour donner un avis
      </NuxtLink>
    </div>

    <form v-if="showForm" class="mb-5 rounded-2xl bg-paw-brown-800/60 p-4" @submit.prevent="submit">
      <fieldset class="mb-3">
        <legend class="mb-1 text-xs text-white/70">Ta note</legend>
        <div class="flex items-center">
          <button
            v-for="i in 5"
            :key="i"
            type="button"
            class="flex h-11 w-11 items-center justify-center transition"
            :aria-label="`${i} étoile${i > 1 ? 's' : ''} sur 5`"
            :aria-pressed="rating === i"
            @click="rating = i"
            @mouseenter="hoverRating = i"
            @mouseleave="hoverRating = 0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-7 w-7 transition"
              :class="i <= (hoverRating || rating) ? 'text-paw-orange-400' : 'text-white/20'"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        </div>
      </fieldset>

      <label for="review-comment" class="mb-1.5 block text-xs text-white/70">Commentaire (optionnel)</label>
      <textarea
        id="review-comment"
        v-model="comment"
        class="mb-1 w-full resize-none rounded-xl bg-paw-brown-900/60 px-4 py-3 text-sm text-white placeholder-white/60 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
        rows="3"
        :maxlength="REVIEW_COMMENT_MAX_LENGTH"
        placeholder="Ton avis…"
      />
      <p class="mb-3 text-right text-[11px] text-white/50">{{ comment.length }} / {{ REVIEW_COMMENT_MAX_LENGTH }}</p>

      <div class="mb-3">
        <ul v-if="photos.length" class="mb-2 flex gap-2 overflow-x-auto pb-1">
          <li v-for="(photo, i) in photos" :key="i" class="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
            <img :src="photo" :alt="`Photo ${i + 1} à publier`" class="h-full w-full object-cover">
            <button
              type="button"
              class="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/90 hover:text-white"
              :aria-label="`Retirer la photo ${i + 1}`"
              @click="removePhoto(i)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </li>
        </ul>
        <label
          v-if="photos.length < REVIEW_MAX_PHOTOS"
          class="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-3 text-xs text-white/70 transition focus-within:ring-2 focus-within:ring-paw-orange-300 hover:bg-white/10 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          Ajouter des photos ({{ photos.length }} / {{ REVIEW_MAX_PHOTOS }})
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" @change="onFileChange">
        </label>
      </div>

      <div v-if="errorMsg" class="mb-3 rounded-xl bg-paw-red-700/20 px-3 py-2 text-xs text-paw-red-200" role="alert">{{ errorMsg }}</div>

      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="min-h-[44px] flex-1 rounded-xl bg-paw-orange-500 text-sm font-semibold text-paw-brown-900 transition hover:bg-paw-orange-400 active:scale-[0.98] disabled:opacity-50"
        >
          {{ submitting ? 'Envoi…' : 'Publier' }}
        </button>
        <button
          type="button"
          class="min-h-[44px] rounded-xl border border-white/10 px-4 text-sm text-white/70 transition hover:text-white"
          @click="showForm = false; rating = 0; comment = ''; photos = []; errorMsg = ''"
        >
          Annuler
        </button>
      </div>
    </form>

    <div v-if="loadingReviews" class="flex justify-center py-4" role="status">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-paw-orange-400 border-t-transparent" aria-hidden="true" />
      <span class="sr-only">Chargement des avis…</span>
    </div>

    <div v-else-if="loadError" class="flex items-center justify-between gap-3 py-2 text-sm text-white/80" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" class="min-h-[44px] rounded-full bg-paw-orange-500/20 px-4 text-xs text-paw-orange-300" @click="loadReviews">
        Réessayer
      </button>
    </div>

    <ul v-else-if="reviews.length" class="space-y-3">
      <li v-for="review in reviews" :key="review.id" class="rounded-xl bg-paw-brown-800/40 p-4">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="flex h-7 w-7 items-center justify-center rounded-full bg-paw-orange-500/20 text-xs font-bold uppercase text-paw-orange-300" aria-hidden="true">
              {{ review.username?.charAt(0) || '?' }}
            </span>
            <span class="text-sm font-medium text-white">{{ review.username }}</span>
          </div>
          <time class="text-xs text-white/50" :datetime="review.createdAt">{{ formatTimeAgo(review.createdAt) }}</time>
        </div>

        <p class="mb-2 flex gap-0.5">
          <span class="sr-only">{{ review.rating }} sur 5</span>
          <svg
            v-for="i in 5"
            :key="i"
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            :class="i <= review.rating ? 'text-paw-orange-400' : 'text-white/15'"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </p>

        <p v-if="review.comment" class="text-sm leading-relaxed text-white/80">{{ review.comment }}</p>

        <div v-if="review.photos?.length" class="mt-3 flex gap-2 overflow-x-auto">
          <img
            v-for="(photo, i) in review.photos"
            :key="i"
            :src="photo"
            :alt="`Photo ${i + 1} de l'avis de ${review.username}`"
            class="h-20 w-20 shrink-0 rounded-lg object-cover"
          >
        </div>
      </li>
    </ul>

    <p v-else class="py-4 text-center text-sm text-white/50">Aucun avis pour le moment</p>
  </div>
</template>
