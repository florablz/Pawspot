<script setup lang="ts">
import { CATEGORY_LIST, type CategoryKey } from '#shared/categories'

/**
 * Puces de filtre : catégories (multi-sélection, aucune = toutes) puis
 * « Confirmés » (chiens acceptés confirmés par la communauté uniquement).
 * Un dégradé en bout de rangée indique qu'il reste des puces à faire défiler.
 */
const categories = defineModel<CategoryKey[]>('categories', { required: true })
const confirmedOnly = defineModel<boolean>('confirmedOnly', { required: true })

function toggle(key: CategoryKey) {
  categories.value = categories.value.includes(key)
    ? categories.value.filter(k => k !== key)
    : [...categories.value, key]
}

const row = ref<HTMLElement | null>(null)
const moreLeft = ref(false)
const moreRight = ref(false)
let resizeObserver: ResizeObserver | null = null

function updateScrollHints() {
  const el = row.value
  if (!el) return
  moreLeft.value = el.scrollLeft > 8
  moreRight.value = Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 8
}

/** Fait défiler d'environ une demi-largeur (souris / clavier ; au doigt on glisse). */
function scrollBy(direction: 1 | -1) {
  const el = row.value
  if (!el) return
  el.scrollBy({ left: direction * el.clientWidth * 0.6, behavior: 'smooth' })
}

onMounted(() => {
  updateScrollHints()
  if (row.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateScrollHints)
    resizeObserver.observe(row.value)
  }
})

onBeforeUnmount(() => resizeObserver?.disconnect())

const chipBase = 'flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-paw-brown-900'
// Contrastes (AA) : marron 900 sur orange 500 = 5,97:1 ; blanc sur le fond 90 % opaque ≥ 12:1, même sur une tuile blanche.
const chipOn = 'bg-paw-orange-500 text-paw-brown-900 shadow-lg shadow-paw-orange-500/25'
const chipOff = 'glass-strong text-white hover:bg-paw-brown-700'
const arrowBtn = 'pointer-events-auto absolute top-0 hidden h-11 w-11 items-center justify-center rounded-full glass-strong text-white transition hover:bg-paw-brown-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300 sm:flex'
</script>

<template>
  <div class="relative">
    <div
      ref="row"
      role="group"
      aria-label="Filtres"
      class="flex gap-2 overflow-x-auto scroll-px-12 px-1 pb-2 pt-1 scrollbar-none"
      @scroll.passive="updateScrollHints"
    >
      <button
        v-for="cat in CATEGORY_LIST"
        :key="cat.key"
        type="button"
        :class="[chipBase, categories.includes(cat.key) ? chipOn : chipOff]"
        :aria-pressed="categories.includes(cat.key)"
        @click="toggle(cat.key)"
      >
        <span aria-hidden="true">{{ cat.icon }}</span>
        <span>{{ cat.label }}</span>
      </button>
      <span class="my-2 w-px shrink-0 bg-white/30" aria-hidden="true" />
      <button
        type="button"
        :class="[chipBase, confirmedOnly ? 'bg-paw-green-700 text-white shadow-lg shadow-paw-green-700/25' : chipOff]"
        :aria-pressed="confirmedOnly"
        aria-label="Chiens acceptés confirmés uniquement"
        data-testid="filter-confirmed"
        @click="confirmedOnly = !confirmedOnly"
      >
        <span aria-hidden="true">✅</span>
        <span aria-hidden="true">Confirmés</span>
      </button>
    </div>

    <!-- Indices de défilement : dégradé (toujours) + flèches (écrans larges, souris). -->
    <div
      v-show="moreLeft"
      class="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-l-full bg-gradient-to-r from-paw-brown-900/90 to-transparent"
      aria-hidden="true"
    />
    <div
      v-show="moreRight"
      class="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-full bg-gradient-to-l from-paw-brown-900/90 to-transparent"
      data-testid="filters-more"
      aria-hidden="true"
    />
    <button
      v-show="moreLeft"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      :class="[arrowBtn, 'left-0 mt-1']"
      @click="scrollBy(-1)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
    <button
      v-show="moreRight"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      :class="[arrowBtn, 'right-0 mt-1']"
      @click="scrollBy(1)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  </div>
</template>
