<script setup lang="ts">
import type { PlaceAlert } from '~/types/api'

const props = defineProps<{ placeId: string }>()

const { loggedIn } = useAuth()

const alerts = ref<PlaceAlert[]>([])
const loadingAlerts = ref(false)
const showForm = ref(false)
const alertType = ref<'closed' | 'change' | ''>('')
const description = ref('')
const submitting = ref(false)
const errorMsg = ref('')

async function loadAlerts() {
  loadingAlerts.value = true
  try {
    alerts.value = await $fetch<PlaceAlert[]>(`/api/alerts/${props.placeId}`)
  } catch { /* ignore */ } finally {
    loadingAlerts.value = false
  }
}

async function submit() {
  if (!alertType.value) {
    errorMsg.value = 'Choisis un type'
    return
  }
  if (alertType.value === 'change' && !description.value.trim()) {
    errorMsg.value = 'Decris le changement'
    return
  }
  errorMsg.value = ''
  submitting.value = true
  try {
    const alert = await $fetch<PlaceAlert>('/api/alerts', {
      method: 'POST',
      body: {
        placeId: props.placeId,
        type: alertType.value,
        description: description.value,
      },
    })
    alerts.value.unshift(alert)
    showForm.value = false
    alertType.value = ''
    description.value = ''
  } catch (err: unknown) {
    errorMsg.value = getApiErrorMessage(err, 'Erreur')
  } finally {
    submitting.value = false
  }
}

function timeAgo(date: string | Date) {
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "a l'instant"
  if (mins < 60) return `il y a ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `il y a ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days}j`
  return d.toLocaleDateString('fr-FR')
}

watch(() => props.placeId, () => loadAlerts(), { immediate: true })
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-white">Avertissements</h3>
        <span v-if="alerts.length" class="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
          {{ alerts.length }}
        </span>
      </div>
      <button
        v-if="loggedIn && !showForm"
        class="rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/30"
        @click="showForm = true"
      >
        + Signaler
      </button>
      <NuxtLink
        v-else-if="!loggedIn"
        to="/login"
        class="rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/30"
      >
        Connecte-toi pour signaler
      </NuxtLink>
    </div>

    <!-- Alert form -->
    <div v-if="showForm" class="mb-5 rounded-2xl bg-paw-brown-800/60 p-4">
      <p class="mb-3 text-xs text-white/50">Quel est le probleme ?</p>

      <!-- Type selection -->
      <div class="mb-3 flex gap-2">
        <button
          class="flex-1 rounded-xl px-4 py-3 text-sm font-medium transition active:scale-[0.98]"
          :class="alertType === 'closed'
            ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40'
            : 'bg-paw-brown-900/60 text-white/50 ring-1 ring-white/10 hover:text-white/70'"
          @click="alertType = 'closed'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto mb-1.5 h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
          </svg>
          Lieu ferme
        </button>
        <button
          class="flex-1 rounded-xl px-4 py-3 text-sm font-medium transition active:scale-[0.98]"
          :class="alertType === 'change'
            ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/40'
            : 'bg-paw-brown-900/60 text-white/50 ring-1 ring-white/10 hover:text-white/70'"
          @click="alertType = 'change'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto mb-1.5 h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
          Changement
        </button>
      </div>

      <!-- Description -->
      <textarea
        v-model="description"
        class="mb-3 w-full resize-none rounded-xl bg-paw-brown-900/60 px-4 py-3 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
        rows="2"
        :placeholder="alertType === 'closed' ? 'Details (optionnel)...' : 'Decris le changement...'"
      />

      <div v-if="errorMsg" class="mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-400">{{ errorMsg }}</div>

      <div class="flex gap-2">
        <button
          :disabled="submitting"
          class="flex-1 rounded-xl bg-red-500/80 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 active:scale-[0.98] disabled:opacity-50"
          @click="submit"
        >
          {{ submitting ? 'Envoi...' : 'Envoyer' }}
        </button>
        <button
          class="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/50 transition hover:text-white"
          @click="showForm = false; alertType = ''; description = ''"
        >
          Annuler
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loadingAlerts" class="flex justify-center py-4">
      <div class="h-5 w-5 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
    </div>

    <!-- Alerts list -->
    <div v-else-if="alerts.length" class="space-y-2.5">
      <div
        v-for="alert in alerts"
        :key="alert.id"
        class="flex items-start gap-3 rounded-xl p-3"
        :class="alert.type === 'closed' ? 'bg-red-500/10' : 'bg-yellow-500/10'"
      >
        <svg
          v-if="alert.type === 'closed'"
          xmlns="http://www.w3.org/2000/svg"
          class="mt-0.5 h-4 w-4 shrink-0 text-red-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          class="mt-0.5 h-4 w-4 shrink-0 text-yellow-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium" :class="alert.type === 'closed' ? 'text-red-400' : 'text-yellow-400'">
              {{ alert.type === 'closed' ? 'Lieu ferme' : 'Changement' }}
            </span>
            <span class="text-xs text-white/30">{{ timeAgo(alert.createdAt) }}</span>
          </div>
          <p v-if="alert.description" class="mt-1 text-sm text-white/60">{{ alert.description }}</p>
          <p class="mt-1 text-xs text-white/30">par {{ alert.username }}</p>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <p v-else class="py-3 text-center text-sm text-white/30">Aucun avertissement</p>
  </div>
</template>
