<script setup lang="ts">
import { CATEGORIES } from '#shared/categories'
import { DOG_STATUS_LABELS } from '#shared/dogStatus'
import type { Place } from '#shared/types'

/**
 * `/lieu/<id>` (id encodé) : la carte du layout + la fiche ouverte. Rendu SSR
 * pour les aperçus de partage (Open Graph). Lieu fusionné → redirection vers
 * le lieu gardé ; introuvable → message, la carte reste normale.
 */
definePageMeta({ layout: 'map' })

const route = useRoute()
const id = String(route.params.id ?? '')
const validId = isValidPlaceId(id)

const { selected, close } = usePlaceSheet()
const { places } = usePlaces()

// `lazy` : une navigation côté client n'attend pas l'API (le lieu déjà chargé s'affiche).
const placeRequest = useFetch<Place>(placeApiUrl(id), {
  key: `place:${id}`,
  lazy: true,
  immediate: validId,
})
const { data, error, status, refresh } = placeRequest
// Côté serveur on attend le lieu : métadonnées, redirection et code 404 dans la réponse.
if (import.meta.server && validId) await placeRequest

/** Lieu déjà chargé sur la carte : affiché tout de suite, remplacé par la réponse de l'API. */
const known = selected.value?.id === id ? selected.value : places.value.find(p => p.id === id) ?? null
const place = computed<Place | null>(() => data.value ?? known)

const notFound = computed(() => !validId || error.value?.statusCode === 404)
const loadError = computed(() => (!place.value && !notFound.value && error.value) ? getApiErrorMessage(error.value, 'Impossible de charger ce lieu.') : null)

async function redirectIfMerged(p: Place | null | undefined) {
  if (p?.status === 'merged' && p.mergedInto) {
    await navigateTo({ path: placePath(p.mergedInto), query: pickMapQuery(route.query) }, { replace: true, redirectCode: 301 })
    return true
  }
  return false
}

if (import.meta.server) {
  if (!(await redirectIfMerged(data.value)) && notFound.value) setResponseStatus(useRequestEvent()!, 404)
}

watch(place, async (p) => {
  if (await redirectIfMerged(p)) return
  if (p) selected.value = p
}, { immediate: true })

onBeforeUnmount(() => {
  // D'une fiche à l'autre, la nouvelle page a déjà posé son lieu : ne pas l'effacer.
  if (selected.value?.id === id) selected.value = null
})

// --- Partage (Open Graph) : uniquement nos propres textes et notre logo. ---
// Base fixe (APP_URL), jamais déduite de la requête : l'en-tête Host peut être forgé.
const appUrl = useRuntimeConfig().public.appUrl
const pageTitle = computed(() => {
  if (place.value) return `${place.value.name} — PawSpot`
  return notFound.value ? 'Lieu introuvable — PawSpot' : 'PawSpot'
})
const pageDescription = computed(() => {
  const p = place.value
  if (!p) return 'Ce lieu n\'existe plus ou est introuvable sur PawSpot.'
  const parts = [CATEGORIES[p.category]?.singular ?? 'Lieu', `Chiens : ${DOG_STATUS_LABELS[p.dogStatus].label}`]
  if (p.dogStatusSource) parts.push(`source : ${p.dogStatusSource}`)
  if (p.address) parts.push(p.address)
  return parts.join(' · ')
})
const canonical = `${appUrl}${placePath(id)}`

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogType: 'website',
  ogSiteName: 'PawSpot',
  ogLocale: 'fr_FR',
  ogUrl: canonical,
  ogImage: `${appUrl}/logo.png`,
  twitterCard: 'summary',
  robots: () => (notFound.value ? 'noindex' : undefined),
})
useHead({ link: [{ rel: 'canonical', href: canonical }] })
</script>

<template>
  <div>
    <PlaceSheet v-if="place && place.status !== 'merged'" :place="place" @close="close" />
    <PlaceLoadNotice v-else-if="notFound" state="not-found" @close="close" />
    <PlaceLoadNotice v-else-if="loadError" state="error" :message="loadError" @retry="refresh()" @close="close" />
    <PlaceLoadNotice v-else-if="status === 'pending' || status === 'idle'" state="loading" @close="close" />
  </div>
</template>
