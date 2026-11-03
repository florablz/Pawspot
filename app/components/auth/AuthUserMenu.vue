<script setup lang="ts">
/**
 * Compte dans la barre du haut : lien « Connexion » (icône seule sous 640 px)
 * ou avatar ouvrant un menu (Mes favoris, Déconnexion). Échap ou un clic
 * à l'extérieur ferment le menu ; Échap rend le focus à l'avatar.
 */
const { user, loggedIn, logout } = useAuth()
const { loginLink } = useLoginLink()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const root = ref<HTMLElement | null>(null)

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close(true)
  }
}

/** Clic / toucher en dehors du menu : on le ferme (un calque `fixed` serait piégé par le flou de la barre). */
function onPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close()
}

function listen(on: boolean) {
  if (!import.meta.client) return
  if (on) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('pointerdown', onPointerDown)
  }
  else {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('pointerdown', onPointerDown)
  }
}

watch(open, isOpen => listen(isOpen))
onBeforeUnmount(() => listen(false))

async function onLogout() {
  await logout()
  close()
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
const menuItem = `flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-sm text-white/90 transition hover:bg-white/5 hover:text-white ${focusRing}`
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      v-if="loggedIn"
      ref="trigger"
      type="button"
      :class="['flex h-11 w-11 items-center justify-center rounded-full bg-paw-orange-500/20 text-sm font-bold uppercase text-paw-orange-300 transition hover:bg-paw-orange-500/40', focusRing]"
      :aria-label="`Menu du compte ${user?.username ?? ''}`"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="account-menu"
      @click="open = !open"
    >
      <span aria-hidden="true">{{ user?.username?.charAt(0) || '?' }}</span>
    </button>

    <!-- Non connecté : icône seule sur mobile (le champ de recherche garde sa place), texte à partir de sm. -->
    <NuxtLink
      v-else
      :to="loginLink"
      aria-label="Connexion"
      :class="['flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-full bg-paw-orange-500/20 text-xs font-medium text-paw-orange-300 transition hover:bg-paw-orange-500/40 sm:px-3', focusRing]"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
      </svg>
      <span class="hidden sm:inline" aria-hidden="true">Connexion</span>
    </NuxtLink>

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
        id="account-menu"
        class="absolute right-0 top-full z-10 mt-2 w-56 origin-top-right rounded-xl glass-strong p-2 shadow-xl"
      >
        <div class="mb-1 border-b border-white/10 px-3 py-2">
          <p class="truncate text-sm font-medium text-white">{{ user?.username }}</p>
          <p class="truncate text-xs text-white/70">{{ user?.email }}</p>
        </div>
        <NuxtLink to="/favorites" :class="menuItem" @click="close()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          Mes favoris
        </NuxtLink>
        <button type="button" :class="menuItem" @click="onLogout">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" />
          </svg>
          Déconnexion
        </button>
      </div>
    </Transition>
  </div>
</template>
