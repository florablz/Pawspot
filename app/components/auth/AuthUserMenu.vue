<script setup lang="ts">
const { user, loggedIn, logout } = useAuth()
const open = ref(false)

async function onLogout() {
  await logout()
  open.value = false
}
</script>

<template>
  <div class="relative">
    <!-- Logged in: avatar button -->
    <button
      v-if="loggedIn"
      type="button"
      class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paw-orange-500/20 text-sm font-bold text-paw-orange-400 uppercase transition hover:bg-paw-orange-500/40"
      :aria-label="`Menu du compte ${user?.username ?? ''}`"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ user?.username?.charAt(0) || '?' }}
    </button>

    <!-- Logged out: login link -->
    <NuxtLink
      v-else
      to="/login"
      class="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-paw-orange-500/20 px-3 text-xs font-medium text-paw-orange-400 transition hover:bg-paw-orange-500/40"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
      </svg>
      Connexion
    </NuxtLink>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open && loggedIn"
        class="absolute right-0 top-full mt-2 w-48 origin-top-right rounded-xl glass p-2 shadow-xl"
      >
        <div class="border-b border-white/10 px-3 py-2 mb-1">
          <p class="text-sm font-medium text-white truncate">{{ user?.username }}</p>
          <p class="text-xs text-white/40 truncate">{{ user?.email }}</p>
        </div>
        <NuxtLink
          to="/favorites"
          class="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          @click="open = false"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Mes favoris
        </NuxtLink>
        <button
          class="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          @click="onLogout"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" />
          </svg>
          Déconnexion
        </button>
      </div>
    </Transition>

    <!-- Click outside to close -->
    <div v-if="open" class="fixed inset-0 z-[-1]" @click="open = false" />
  </div>
</template>
