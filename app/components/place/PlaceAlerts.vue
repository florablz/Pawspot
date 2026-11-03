<script setup lang="ts">
import { ALERT_DESCRIPTION_MAX_LENGTH, ALERT_TYPES_WITH_DESCRIPTION, type AlertType } from '#shared/schemas'
import type { PlaceAlert } from '~/types/api'

const props = defineProps<{ placeId: string }>()

const { loggedIn } = useAuth()

type NewAlertType = Exclude<AlertType, 'change'>

/** Types proposés dans le formulaire (libellés courts, icône décorative). */
const ALERT_OPTIONS: ReadonlyArray<{ type: NewAlertType, label: string, icon: string }> = [
  { type: 'closed', label: 'Fermé définitivement', icon: '⛔' },
  { type: 'temporarily_closed', label: 'Fermé temporairement', icon: '⏸️' },
  { type: 'dogs_not_allowed', label: 'N\'accepte plus les chiens', icon: '🚫' },
  { type: 'info_change', label: 'Autre changement', icon: '✏️' },
]

/** Libellés d'affichage, y compris l'ancien type `change`. */
const ALERT_LABELS: Record<AlertType, string> = {
  closed: 'Signalé fermé définitivement',
  temporarily_closed: 'Signalé fermé temporairement',
  dogs_not_allowed: 'Signalé : n\'accepte plus les chiens',
  info_change: 'Changement signalé',
  change: 'Changement signalé',
}

const SEVERE: ReadonlySet<AlertType> = new Set(['closed', 'dogs_not_allowed'])

const alerts = ref<PlaceAlert[]>([])
const loadingAlerts = ref(false)
const loadError = ref<string | null>(null)
const showForm = ref(false)
const alertType = ref<NewAlertType | ''>('')
const description = ref('')
const submitting = ref(false)
const errorMsg = ref('')

const descriptionRequired = computed(() => !!alertType.value && ALERT_TYPES_WITH_DESCRIPTION.includes(alertType.value))

async function loadAlerts() {
  loadingAlerts.value = true
  loadError.value = null
  try {
    alerts.value = await $fetch<PlaceAlert[]>(`/api/alerts/${encodeURIComponent(props.placeId)}`)
  }
  catch (err: unknown) {
    loadError.value = getApiErrorMessage(err, 'Impossible de charger les signalements.')
  }
  finally {
    loadingAlerts.value = false
  }
}

function resetForm() {
  showForm.value = false
  alertType.value = ''
  description.value = ''
  errorMsg.value = ''
}

async function submit() {
  if (!alertType.value) {
    errorMsg.value = 'Choisis le type de problème.'
    return
  }
  if (descriptionRequired.value && !description.value.trim()) {
    errorMsg.value = 'Décris le changement.'
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
        description: description.value.trim() || undefined,
      },
    })
    alerts.value.unshift(alert)
    resetForm()
  }
  catch (err: unknown) {
    errorMsg.value = getApiErrorMessage(err, 'Impossible d\'envoyer le signalement.')
  }
  finally {
    submitting.value = false
  }
}

watch(() => props.placeId, () => {
  resetForm()
  loadAlerts()
}, { immediate: true })
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-white">Signalements</h3>
        <span v-if="alerts.length" class="rounded-full bg-paw-red-700/30 px-2 py-0.5 text-xs text-paw-red-200">
          {{ alerts.length }}<span class="sr-only"> signalement{{ alerts.length > 1 ? 's' : '' }}</span>
        </span>
      </div>
      <button
        v-if="loggedIn && !showForm"
        type="button"
        class="min-h-[44px] rounded-full bg-paw-red-700/30 px-4 text-xs font-medium text-paw-red-200 transition hover:bg-paw-red-700/50"
        @click="showForm = true"
      >
        + Signaler
      </button>
      <NuxtLink
        v-else-if="!loggedIn"
        to="/login"
        class="flex min-h-[44px] items-center rounded-full bg-paw-red-700/30 px-4 text-xs font-medium text-paw-red-200 transition hover:bg-paw-red-700/50"
      >
        Connecte-toi pour signaler
      </NuxtLink>
    </div>

    <form v-if="showForm" class="mb-5 rounded-2xl bg-paw-brown-800/60 p-4" @submit.prevent="submit">
      <fieldset class="mb-3">
        <legend class="mb-3 text-xs text-white/70">Quel est le problème ?</legend>
        <div class="grid grid-cols-2 gap-2">
          <label
            v-for="opt in ALERT_OPTIONS"
            :key="opt.type"
            class="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ring-1 transition focus-within:ring-2 focus-within:ring-paw-orange-300"
            :class="alertType === opt.type
              ? 'bg-paw-red-700/30 text-paw-red-200 ring-paw-red-300/60'
              : 'bg-paw-brown-900/60 text-white/70 ring-white/10 hover:text-white'"
          >
            <input v-model="alertType" type="radio" name="alert-type" :value="opt.type" class="sr-only">
            <span aria-hidden="true">{{ opt.icon }}</span>
            <span>{{ opt.label }}</span>
          </label>
        </div>
      </fieldset>

      <label for="alert-description" class="mb-1.5 block text-xs text-white/70">
        {{ descriptionRequired ? 'Description (obligatoire)' : 'Détails (optionnel)' }}
      </label>
      <textarea
        id="alert-description"
        v-model="description"
        class="mb-1 w-full resize-none rounded-xl bg-paw-brown-900/60 px-4 py-3 text-sm text-white placeholder-white/60 outline-none ring-1 ring-white/10 transition focus:ring-paw-orange-500/50"
        rows="2"
        :maxlength="ALERT_DESCRIPTION_MAX_LENGTH"
        :required="descriptionRequired"
        :placeholder="descriptionRequired ? 'Décris le changement…' : 'Précisions…'"
      />
      <p class="mb-3 text-right text-[11px] text-white/50">{{ description.length }} / {{ ALERT_DESCRIPTION_MAX_LENGTH }}</p>

      <div v-if="errorMsg" class="mb-3 rounded-xl bg-paw-red-700/20 px-3 py-2 text-xs text-paw-red-200" role="alert">{{ errorMsg }}</div>

      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="min-h-[44px] flex-1 rounded-xl bg-paw-red-700 text-sm font-semibold text-white transition hover:bg-paw-red-700/80 active:scale-[0.98] disabled:opacity-50"
        >
          {{ submitting ? 'Envoi…' : 'Envoyer' }}
        </button>
        <button
          type="button"
          class="min-h-[44px] rounded-xl border border-white/10 px-4 text-sm text-white/70 transition hover:text-white"
          @click="resetForm"
        >
          Annuler
        </button>
      </div>
    </form>

    <div v-if="loadingAlerts" class="flex justify-center py-4" role="status">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-paw-red-300 border-t-transparent" aria-hidden="true" />
      <span class="sr-only">Chargement des signalements…</span>
    </div>

    <div v-else-if="loadError" class="flex items-center justify-between gap-3 py-2 text-sm text-white/80" role="alert">
      <span>{{ loadError }}</span>
      <button type="button" class="min-h-[44px] rounded-full bg-paw-orange-500/20 px-4 text-xs text-paw-orange-300" @click="loadAlerts">
        Réessayer
      </button>
    </div>

    <ul v-else-if="alerts.length" class="space-y-2.5">
      <li
        v-for="alert in alerts"
        :key="alert.id"
        class="rounded-xl p-3"
        :class="SEVERE.has(alert.type) ? 'bg-paw-red-700/20' : 'bg-paw-yellow-400/10'"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold" :class="SEVERE.has(alert.type) ? 'text-paw-red-200' : 'text-paw-yellow-300'">
            {{ ALERT_LABELS[alert.type] ?? 'Signalement' }}
          </span>
          <time class="text-xs text-white/50" :datetime="alert.createdAt">{{ formatTimeAgo(alert.createdAt) }}</time>
        </div>
        <p v-if="alert.description" class="mt-1 text-sm text-white/80">{{ alert.description }}</p>
        <p class="mt-1 text-xs text-white/50">par {{ alert.username }}</p>
      </li>
    </ul>

    <p v-else class="py-3 text-center text-sm text-white/50">Aucun signalement récent</p>
  </div>
</template>
