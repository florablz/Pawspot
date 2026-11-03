<script setup lang="ts">
/** Barre du haut de la carte : logo, filtre par nom, « Me localiser », compte. */
defineProps<{
  /** La position a déjà été obtenue (libellé « Recentrer sur ma position »). */
  localized: boolean
}>()

const query = defineModel<string>('query', { required: true })

defineEmits<{ locate: [] }>()

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
</script>

<template>
  <div class="glass-strong flex items-center gap-2 rounded-2xl py-1 pl-3 pr-1">
    <img src="/logo/patte-de-chien.png" alt="PawSpot" class="h-7 w-7 shrink-0 object-contain">
    <div class="relative min-w-0 flex-1">
      <label for="place-name-filter" class="sr-only">Filtrer les lieux de la zone par nom</label>
      <input
        id="place-name-filter"
        v-model="query"
        type="search"
        enterkeyhint="search"
        placeholder="Filtrer par nom…"
        :class="['min-h-[44px] w-full rounded-lg bg-transparent pl-2 pr-11 text-sm text-white placeholder-white/70 outline-none [&::-webkit-search-cancel-button]:hidden', focusRing]"
      >
      <button
        v-if="query"
        type="button"
        aria-label="Effacer la recherche"
        :class="['absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-white/80 hover:text-white', focusRing]"
        @click="query = ''"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <button
      type="button"
      :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-paw-orange-300 transition hover:bg-paw-orange-500/40', focusRing]"
      :aria-label="localized ? 'Recentrer sur ma position' : 'Me localiser'"
      @click="$emit('locate')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" /><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" />
      </svg>
    </button>
    <AuthUserMenu />
  </div>
</template>
