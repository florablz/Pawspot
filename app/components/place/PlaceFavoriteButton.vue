<script setup lang="ts">
/** Étoile « favori » : POST pour ajouter, DELETE pour retirer. Invite à se connecter sinon. */
const props = defineProps<{
  placeId: string
  placeName: string
}>()

const emit = defineEmits<{ change: [favorited: boolean] }>()

const { loggedIn } = useAuth()
const { checkFavorite, toggleFavorite, isFavorited } = useFavorites()

const pending = ref(false)
const error = ref<string | null>(null)
const favorited = computed(() => isFavorited(props.placeId))

watch(
  () => [props.placeId, loggedIn.value] as const,
  ([id, logged]) => {
    error.value = null
    if (logged) checkFavorite(id)
  },
  { immediate: true },
)

async function onClick() {
  if (pending.value) return
  pending.value = true
  error.value = null
  try {
    emit('change', await toggleFavorite(props.placeId))
  }
  catch (err: unknown) {
    error.value = getApiErrorMessage(err, 'Impossible de modifier le favori.')
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="flex shrink-0 flex-col items-end">
    <button
      v-if="loggedIn"
      type="button"
      class="flex h-11 w-11 items-center justify-center rounded-full transition active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-paw-orange-300 disabled:opacity-60"
      :class="favorited ? 'bg-paw-orange-500/20' : 'bg-white/5 hover:bg-white/10'"
      :aria-pressed="favorited"
      :aria-label="favorited ? `Retirer ${placeName} des favoris` : `Ajouter ${placeName} aux favoris`"
      :disabled="pending"
      @click="onClick"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5 transition"
        :class="favorited ? 'fill-paw-orange-400 text-paw-orange-400' : 'text-white/60'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
    <NuxtLink
      v-else
      to="/login"
      class="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10"
      aria-label="Se connecter pour ajouter aux favoris"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </NuxtLink>
    <p v-if="error" class="mt-1 max-w-[12rem] text-right text-xs text-paw-red-200" role="alert">{{ error }}</p>
  </div>
</template>
