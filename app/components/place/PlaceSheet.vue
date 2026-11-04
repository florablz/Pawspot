<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Fiche lieu posée sur la carte (§3.5). Mobile : panneau glissant depuis le bas,
 * aperçu (en-tête + statut chien + actions) ou déplié ; poignée, glisser vers le
 * bas pour réduire puis fermer. Desktop (≥ 1024 px) : panneau latéral droit.
 * Région nommée par le titre (non modale : la carte reste utilisable). Échap ferme.
 */
const props = defineProps<{
  place: Place
}>()

const emit = defineEmits<{ close: [] }>()

const { snap, peekHeight } = usePlaceSheet()
const isDesktop = useMediaQuery(DESKTOP_QUERY)
const titleId = useId()

const root = ref<HTMLElement | null>(null)
const header = ref<HTMLElement | null>(null)

/** Glisser franc (px) ou geste rapide (px/ms) pour changer de hauteur. */
const SNAP_DISTANCE = 80
const FLICK_VELOCITY = 0.5

const { dragY, dragging, onPointerDown } = useSheetDrag({
  enabled: () => !isDesktop.value,
  onRelease(dy, velocity) {
    const down = dy > SNAP_DISTANCE || velocity > FLICK_VELOCITY
    const up = dy < -SNAP_DISTANCE || velocity < -FLICK_VELOCITY
    if (snap.value === 'full') {
      if (down) snap.value = 'peek'
    }
    else if (up) snap.value = 'full'
    else if (down) emit('close')
  },
})

/** Décalage vertical (mobile) : 0 = déplié ; en aperçu, seule la partie haute dépasse. */
const sheetY = computed(() => {
  const peek = peekHeight.value ? `${peekHeight.value}px` : '40dvh'
  const base = snap.value === 'full' ? '0px' : `calc(88dvh - clamp(30dvh, ${peek}, 60dvh))`
  return `max(0px, calc(${base} + ${dragY.value}px))`
})

function toggle() {
  snap.value = snap.value === 'full' ? 'peek' : 'full'
}

/** Au clavier, entrer dans le contenu caché de l'aperçu déplie la fiche. */
function onContentFocus() {
  if (!isDesktop.value && snap.value === 'peek') snap.value = 'full'
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  e.preventDefault()
  emit('close')
}

function focusTitle() {
  nextTick(() => root.value?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }))
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  focusTitle()
  if (header.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      peekHeight.value = header.value?.offsetHeight ?? null
    })
    resizeObserver.observe(header.value)
  }
})
watch(() => props.place.id, () => {
  snap.value = 'peek'
  focusTitle()
})
onBeforeUnmount(() => resizeObserver?.disconnect())

const iconBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
</script>

<template>
  <section
    ref="root"
    :aria-labelledby="titleId"
    class="fixed inset-x-0 bottom-0 z-[1100] flex h-[88dvh] translate-y-[var(--sheet-y)] flex-col rounded-t-3xl border-t border-white/10 bg-paw-brown-900 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] lg:inset-x-auto lg:right-0 lg:top-0 lg:h-full lg:w-[400px] lg:translate-y-0 lg:rounded-none lg:border-l lg:border-t-0"
    :class="[dragging ? '' : 'motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out', snap === 'peek' ? 'max-lg:touch-none' : '']"
    :style="{ '--sheet-y': sheetY }"
    data-testid="place-sheet"
    data-map-overlay
    :data-snap="snap"
    @keydown="onKeydown"
    @pointerdown="snap === 'peek' ? onPointerDown($event) : undefined"
  >
    <div
      ref="header"
      class="shrink-0 border-b border-white/5 pb-3 max-lg:touch-none lg:pt-5"
      @pointerdown="snap === 'full' ? onPointerDown($event) : undefined"
    >
      <button
        type="button"
        class="flex h-11 w-full items-center justify-center rounded-t-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-paw-orange-300 lg:hidden"
        :aria-label="snap === 'full' ? 'Réduire la fiche' : 'Agrandir la fiche'"
        :aria-expanded="snap === 'full'"
        data-testid="sheet-handle"
        @click="toggle"
      >
        <span class="h-1.5 w-10 rounded-full bg-white/40" aria-hidden="true" />
      </button>

      <div class="space-y-3 px-5">
        <PlaceHeader :place="place" :title-id="titleId">
          <template #actions>
            <button type="button" :class="iconBtn" aria-label="Fermer la fiche" data-testid="sheet-close" @click="emit('close')">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </template>
        </PlaceHeader>

        <div class="flex gap-2">
          <PlaceItineraryLink :place="place" class="min-w-0 flex-1" />
          <PlaceShareButton :place="place" />
          <button
            type="button"
            class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/15 px-4 text-sm font-medium text-white transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300 lg:hidden"
            :aria-expanded="snap === 'full'"
            @click="toggle"
          >
            {{ snap === 'full' ? 'Réduire' : 'Plus d\'infos' }}
          </button>
        </div>
      </div>
    </div>

    <div
      class="min-h-0 flex-1 overscroll-contain lg:overflow-y-auto"
      :class="snap === 'full' ? 'overflow-y-auto' : 'overflow-hidden'"
      @focusin="onContentFocus"
    >
      <PlaceDetails :place="place" embedded class="pt-4" />
    </div>
  </section>
</template>
