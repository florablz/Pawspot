<script setup lang="ts">
const { login } = useAuth()
const route = useRoute()
const { registerLink } = useLoginLink()

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMsg.value = ''
  submitting.value = true
  try {
    await login(email.value, password.value)
    await navigateTo(safeRedirect(route.query.redirect))
  } catch (err: unknown) {
    errorMsg.value = getApiErrorMessage(err, 'E-mail ou mot de passe incorrect.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex h-[100dvh] items-center justify-center overflow-y-auto bg-paw-brown-900 px-4 py-6">
    <div class="glass my-auto w-full max-w-sm rounded-3xl p-6 sm:p-8">
      <div class="mb-8 text-center">
        <img src="/logo/patte-de-chien.png" alt="PawSpot" class="mx-auto mb-4 h-12 w-12">
        <h1 class="text-2xl font-bold text-white">Connexion</h1>
        <p class="mt-1 text-sm text-white/70">Connectez-vous pour retrouver vos favoris et partager vos avis.</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <AuthField id="login-email" v-model="email" label="E-mail" type="email" autocomplete="email" placeholder="vous@exemple.fr" />
        <AuthField id="login-password" v-model="password" label="Mot de passe" type="password" autocomplete="current-password" />

        <p v-if="errorMsg" class="rounded-xl bg-paw-red-700/20 px-4 py-2.5 text-sm text-paw-red-200" role="alert">
          {{ errorMsg }}
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-paw-brown-900 shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98] disabled:opacity-50"
        >
          <span v-if="submitting" class="h-4 w-4 animate-spin rounded-full border-2 border-paw-brown-900 border-t-transparent" aria-hidden="true" />
          {{ submitting ? 'Connexion…' : 'Se connecter' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-white/70">
        Pas encore de compte ?
        <NuxtLink :to="registerLink" class="inline-flex min-h-[44px] items-center font-medium text-paw-orange-300 underline-offset-2 transition hover:text-paw-orange-200 hover:underline">
          Créer un compte
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
