<script setup lang="ts">
import { CATEGORY_LIST, type CategoryKey } from '#shared/categories'

/** Puces de filtre : catégories (multi-sélection, aucune = toutes) + « Confirmés uniquement ». */
const categories = defineModel<CategoryKey[]>('categories', { required: true })
const confirmedOnly = defineModel<boolean>('confirmedOnly', { required: true })

function toggle(key: CategoryKey) {
  categories.value = categories.value.includes(key)
    ? categories.value.filter(k => k !== key)
    : [...categories.value, key]
}

const chipBase = 'flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-paw-brown-900'
// Contrastes (AA) : marron 900 sur orange 500 = 5,97:1 ; blanc sur le fond 90 % opaque ≥ 12:1, même sur une tuile blanche.
const chipOn = 'bg-paw-orange-500 text-paw-brown-900 shadow-lg shadow-paw-orange-500/25'
const chipOff = 'glass-strong text-white hover:bg-paw-brown-700'
</script>

<template>
  <div role="group" aria-label="Filtres" class="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
    <button
      type="button"
      :class="[chipBase, confirmedOnly ? 'bg-paw-green-700 text-white shadow-lg shadow-paw-green-700/25' : chipOff]"
      :aria-pressed="confirmedOnly"
      @click="confirmedOnly = !confirmedOnly"
    >
      <span aria-hidden="true">✅</span>
      <span>Chiens acceptés confirmés uniquement</span>
    </button>
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
  </div>
</template>
