<script setup lang="ts">
import { PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '#shared/schemas'

const { register } = useAuth()
const route = useRoute()
const { loginLink } = useLoginLink()

const email = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function onSubmit() {
  errorMsg.value = ''

  if (password.value !== confirmPassword.value) {
    errorMsg.value = 'Les deux mots de passe ne correspondent pas.'
    return
  }

  submitting.value = true
  try {
    await register(email.value, username.value, password.value)
    await navigateTo(safeRedirect(route.query.redirect))
  } catch (err: unknown) {
    errorMsg.value = getApiErrorMessage(err, 'Impossible de créer le compte pour le moment.')
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
        <h1 class="text-2xl font-bold text-white">Créer un compte</h1>
        <p class="mt-1 text-sm text-white/70">Rejoignez la communauté PawSpot et partagez vos bonnes adresses.</p>
      </div>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <AuthField
          id="register-username"
          v-model="username"
          label="Pseudo"
          type="text"
          autocomplete="username"
          placeholder="MonChien42"
          :minlength="USERNAME_MIN_LENGTH"
          :maxlength="USERNAME_MAX_LENGTH"
          :hint="`De ${USERNAME_MIN_LENGTH} à ${USERNAME_MAX_LENGTH} caractères, visible avec vos avis.`"
        />
        <AuthField id="register-email" v-model="email" label="E-mail" type="email" autocomplete="email" placeholder="vous@exemple.fr" />
        <AuthField
          id="register-password"
          v-model="password"
          label="Mot de passe"
          type="password"
          autocomplete="new-password"
          :minlength="PASSWORD_MIN_LENGTH"
          :hint="`${PASSWORD_MIN_LENGTH} caractères minimum.`"
        />
        <AuthField id="register-password-confirm" v-model="confirmPassword" label="Confirmer le mot de passe" type="password" autocomplete="new-password" />

        <p v-if="errorMsg" class="rounded-xl bg-paw-red-700/20 px-4 py-2.5 text-sm text-paw-red-200" role="alert">
          {{ errorMsg }}
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-paw-orange-500 px-5 py-3.5 text-sm font-semibold text-paw-brown-900 shadow-lg shadow-paw-orange-500/25 transition hover:bg-paw-orange-400 active:scale-[0.98] disabled:opacity-50"
        >
          <span v-if="submitting" class="h-4 w-4 animate-spin rounded-full border-2 border-paw-brown-900 border-t-transparent" aria-hidden="true" />
          {{ submitting ? 'Création…' : 'Créer mon compte' }}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-white/70">
        Déjà inscrit ?
        <NuxtLink :to="loginLink" class="inline-flex min-h-[44px] items-center font-medium text-paw-orange-300 underline-offset-2 transition hover:text-paw-orange-200 hover:underline">
          Se connecter
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
