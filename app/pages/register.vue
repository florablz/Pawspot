<script setup lang="ts">
const { register } = useAuth()

const email = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMsg.value = ''

  if (password.value !== confirmPassword.value) {
    errorMsg.value = 'Les mots de passe ne correspondent pas'
    return
  }

  submitting.value = true
  try {
    await register(email.value, username.value, password.value)
    navigateTo('/')
  } catch (err: any) {
    errorMsg.value = err?.data?.message || err?.statusMessage || 'Erreur lors de la creation du compte'
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
        <h1 class="text-2xl font-bold text-white">Creer un compte</h1>
        <p class="mt-1 text-sm text-white/50">Rejoins la communaute Pawspot</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">Pseudo</label>
          <input
            v-model="username"
            type="text"
            required
            minlength="3"
            maxlength="20"
            autocomplete="username"
            class="w-full rounded-xl bg-paw-brown-800/80 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
            placeholder="MonChien42"
          >
        </div>

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
            minlength="8"
            autocomplete="new-password"
            class="w-full rounded-xl bg-paw-brown-800/80 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
            placeholder="8 caracteres minimum"
          >
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/40">Confirmer le mot de passe</label>
          <input
            v-model="confirmPassword"
            type="password"
            required
            autocomplete="new-password"
            class="w-full rounded-xl bg-paw-brown-800/80 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
            placeholder="••••••••"
          >
        </div>

        <div v-if="errorMsg" class="rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          :disabled="submitting"
          class="flex w-full items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98] disabled:opacity-50"
        >
          <div v-if="submitting" class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          {{ submitting ? 'Creation...' : 'Creer mon compte' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-white/40">
        Deja inscrit ?
        <NuxtLink to="/login" class="text-paw-orange-400 hover:text-paw-orange-300 transition">
          Se connecter
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
