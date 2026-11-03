<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Bouton « Partager » (§3.5, point 7) : feuille de partage du système (Web Share
 * API) si elle existe, sinon copie du lien dans le presse-papier avec « Lien
 * copié » annoncé. Lien partagé : `${appUrl}/lieu/<id>`, sans la position de
 * l'utilisateur ni la vue de la carte. Dernier recours : le lien à copier à la main.
 */
const props = defineProps<{
  place: Pick<Place, 'id' | 'name'>
}>()

/** Durée d'affichage de « Lien copié » (ms). */
const FEEDBACK_MS = 4000

const appUrl = useRuntimeConfig().public.appUrl
const url = computed(() => `${appUrl}${placePath(props.place.id)}`)

const feedback = ref<'copied' | 'manual' | null>(null)
const manualInput = ref<HTMLInputElement | null>(null)
const inputId = useId()
let timer: ReturnType<typeof setTimeout> | undefined

function showFeedback(kind: 'copied' | 'manual') {
  clearTimeout(timer)
  feedback.value = kind
  if (kind === 'copied') timer = setTimeout(() => { feedback.value = null }, FEEDBACK_MS)
  else nextTick(() => manualInput.value?.select())
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(url.value)
    showFeedback('copied')
  }
  catch {
    showFeedback('manual')
  }
}

async function share() {
  const data: ShareData = {
    title: `${props.place.name} — PawSpot`,
    text: `${props.place.name}, sur PawSpot : la carte des lieux où votre chien est le bienvenu.`,
    url: url.value,
  }
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data)
      return
    }
    catch (err: unknown) {
      // Partage annulé par l'utilisateur : rien à faire.
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }
  await copyLink()
}

watch(() => props.place.id, () => {
  clearTimeout(timer)
  feedback.value = null
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex min-h-[44px] w-full items-center justify-center min-w-[44px] gap-1.5 rounded-xl border border-white/15 px-3 text-sm font-medium text-white transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300 motion-safe:active:scale-[0.98]"
      data-testid="share-button"
      @click="share"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
        <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
      </svg>
      <!-- Très petits écrans : icône seule, le nom accessible reste « Partager ». -->
      <span class="max-[399px]:sr-only">Partager</span>
    </button>

    <!-- Toujours présent : les lecteurs d'écran annoncent « Lien copié ». -->
    <p
      class="pointer-events-none absolute bottom-full right-0 z-20 mb-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-white"
      :class="feedback === 'copied' ? 'glass-strong' : 'sr-only'"
      role="status"
      aria-live="polite"
      data-testid="share-feedback"
    >
      {{ feedback === 'copied' ? 'Lien copié' : '' }}
    </p>

    <div
      v-if="feedback === 'manual'"
      class="glass-strong absolute bottom-full right-0 z-20 mb-2 w-64 rounded-xl p-3 shadow-xl"
      role="group"
      aria-label="Copier le lien"
    >
      <label :for="inputId" class="mb-1 block text-xs text-white/80">Copie impossible : copiez ce lien.</label>
      <input
        :id="inputId"
        ref="manualInput"
        :value="url"
        readonly
        class="min-h-[44px] w-full rounded-lg bg-paw-brown-800 px-2 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300"
        @keydown.escape.prevent="feedback = null"
        @blur="feedback = null"
      >
    </div>
  </div>
</template>
