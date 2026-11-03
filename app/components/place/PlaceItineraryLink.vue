<script setup lang="ts">
import type { Place } from '#shared/types'

/**
 * Bouton « Itinéraire » (§3.5, point 7) : ouvre un petit menu Google Maps /
 * Apple Plans / Waze, l'application de l'appareil en premier (Apple → Apple
 * Plans, sinon Google Maps). Seule la destination est dans les liens, jamais la
 * position de l'utilisateur. Clavier : ↓ / ↑ / Début / Fin dans le menu, Échap
 * referme et rend le focus au bouton ; Tab hors du menu le referme.
 */
const props = defineProps<{
  place: Pick<Place, 'name' | 'lat' | 'lon'>
}>()

/** Hauteur approximative du menu (px) : ouverture vers le haut si la place manque en bas. */
const MENU_HEIGHT = 180

const menuId = useId()
const root = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const openUp = ref(false)
const platform = ref<ItineraryPlatform>('other')

onMounted(() => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  platform.value = detectItineraryPlatform(nav.userAgent, nav.userAgentData?.platform ?? nav.platform)
})

const options = computed(() => itineraryApps(platform.value).map(app => ({
  app,
  label: ITINERARY_APP_LABELS[app],
  href: itineraryUrl(app, props.place),
})))

/** Liens du menu dans l'ordre affiché. */
function links(): HTMLAnchorElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLAnchorElement>('a[data-app]') ?? [])
}

function focusLink(index: number) {
  const list = links()
  if (!list.length) return
  list[(index + list.length) % list.length]?.focus()
}

async function show(focusIndex = 0) {
  const rect = button.value?.getBoundingClientRect()
  openUp.value = !!rect && window.innerHeight - rect.bottom < MENU_HEIGHT && rect.top > MENU_HEIGHT
  open.value = true
  await nextTick()
  focusLink(focusIndex)
}

function hide(returnFocus: boolean) {
  open.value = false
  if (returnFocus) button.value?.focus()
}

function toggle() {
  if (open.value) hide(false)
  else show()
}

function onButtonKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  show(e.key === 'ArrowUp' ? -1 : 0)
}

function onMenuKeydown(e: KeyboardEvent) {
  const current = links().indexOf(document.activeElement as HTMLAnchorElement)
  const moves: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: -1 }
  if (e.key in moves) {
    e.preventDefault()
    focusLink(moves[e.key]!)
  }
}

function onKeydown(e: KeyboardEvent) {
  // Échap ferme d'abord le menu (et pas la fiche).
  if (e.key !== 'Escape' || !open.value) return
  e.preventDefault()
  hide(true)
}

function onFocusout(e: FocusEvent) {
  const next = e.relatedTarget as Node | null
  if (open.value && next && !root.value?.contains(next)) hide(false)
}

function onDocumentPointerdown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) hide(false)
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onDocumentPointerdown, true)
  else document.removeEventListener('pointerdown', onDocumentPointerdown, true)
})
watch(() => props.place, () => hide(false))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerdown, true))
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown" @focusout="onFocusout">
    <button
      ref="button"
      type="button"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-label="`Itinéraire vers ${place.name}`"
      class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-3 text-sm font-semibold text-paw-brown-900 shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-200 focus-visible:ring-offset-2 focus-visible:ring-offset-paw-brown-900 motion-safe:active:scale-[0.98]"
      data-testid="itinerary-button"
      @click="toggle"
      @keydown="onButtonKeydown"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
      </svg>
      Itinéraire
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 transition-transform" :class="{ 'rotate-180': open }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <div
      v-show="open"
      :id="menuId"
      class="glass-strong absolute left-0 z-20 w-full min-w-[14rem] rounded-xl p-1.5 shadow-xl"
      :class="openUp ? 'bottom-full mb-2' : 'top-full mt-2'"
      data-testid="itinerary-menu"
      @keydown="onMenuKeydown"
    >
      <p class="px-3 pb-1 pt-1.5 text-xs font-medium text-white/70">Ouvrir l'itinéraire dans :</p>
      <ul>
        <li v-for="option in options" :key="option.app">
          <a
            :href="option.href"
            target="_blank"
            rel="noopener noreferrer"
            class="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-paw-orange-300"
            :data-app="option.app"
            @click="hide(true)"
          >
            {{ option.label }}<span class="sr-only">, nouvel onglet</span>
          </a>
        </li>
      </ul>
    </div>
  </div>
</template>
