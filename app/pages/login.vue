<script setup lang="ts">
const { login } = useAuth()

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMsg.value = ''
  submitting.value = true
  try {
    await login(email.value, password.value)
    navigateTo('/')
  } catch (err: unknown) {
    errorMsg.value = getApiErrorMessage(err, 'Email ou mot de passe incorrect')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[100dvh] items-center justify-center bg-paw-brown-900 px-4">
    <div class="glass w-full max-w-sm rounded-3xl p-8">
      <div class="mb-8 text-center">
        <img src="/logo/patte-de-chien.png" alt="PawSpot" class="mx-auto mb-4 h-12 w-12">
        <h1 class="text-2xl font-bold text-white">Connexion</h1>
        <p class="mt-1 text-sm text-white/50">Connecte-toi pour accéder à ton compte</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">Email</label>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full rounded-xl bg-paw-brown-800/80 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
            placeholder="ton@email.com"
          >
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">Mot de passe</label>
          <input
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            class="w-full rounded-xl bg-paw-brown-800/80 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
            placeholder="••••••••"
          >
        </div>

        <div v-if="errorMsg" class="rounded-xl bg-paw-red-700/20 px-4 py-2.5 text-sm text-paw-red-200">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          :disabled="submitting"
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-paw-brown-900 shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98] disabled:opacity-50"
        >
          <div v-if="submitting" class="h-4 w-4 animate-spin rounded-full border-2 border-paw-brown-900 border-t-transparent" />
          {{ submitting ? 'Connexion…' : 'Se connecter' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-white/40">
        Pas encore de compte ?
        <NuxtLink to="/register" class="text-paw-orange-400 hover:text-paw-orange-300 transition">
          Créer un compte
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
