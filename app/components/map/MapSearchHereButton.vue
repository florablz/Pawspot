<script setup lang="ts">
/** « Rechercher dans cette zone », sous les filtres, quand la carte sort de la zone chargée. */
defineProps<{ show: boolean }>()
defineEmits<{ search: [] }>()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 -translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-2"
  >
    <div v-if="show" class="pointer-events-none absolute inset-x-0 top-[132px] z-[1000] flex justify-center">
      <button
        type="button"
        data-map-overlay
        class="pointer-events-auto glass-strong flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-medium text-white shadow-lg transition hover:bg-paw-brown-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300 active:scale-95"
        @click="$emit('search')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-paw-orange-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        Rechercher dans cette zone
      </button>
    </div>
  </Transition>
</template>
