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

const chipBase = 'flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paw-orange-300'
const chipOn = 'bg-paw-orange-500 text-white shadow-lg shadow-paw-orange-500/25'
const chipOff = 'glass text-white/90 hover:text-white'
</script>

<template>
  <div role="group" aria-label="Filtres" class="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
    <button
      type="button"
      :class="[chipBase, confirmedOnly ? 'bg-paw-green-600 text-white shadow-lg shadow-paw-green-600/25' : chipOff]"
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
