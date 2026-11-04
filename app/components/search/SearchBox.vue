<script setup lang="ts">
import type { GeocodeResult, Place } from '#shared/types'
import type { SearchOption } from '~/types/search'

/**
 * Recherche unifiée (§3.2), motif combobox ARIA : lieux PawSpot déjà chargés
 * (instantané) et adresses / villes (`/api/geocode`, debounce). Flèches haut /
 * bas, Entrée (option active, sinon premier résultat), Échap (ferme, puis
 * efface), Tab sort. Le texte tapé reste local (jamais dans l'URL).
 */
const props = defineProps<{ places: readonly Place[] }>()

const emit = defineEmits<{
  'select-place': [place: Place]
  'select-address': [result: GeocodeResult]
}>()

const baseId = useId()
const inputId = `${baseId}-input`
const listboxId = `${baseId}-listbox`
const optionId = (i: number) => `${baseId}-opt-${i}`

const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const open = ref(false)
const active = ref(-1)
const geocode = useGeocode()

const placeMatches = computed(() => matchPlaces(props.places, query.value))
const addressMatches = computed(() => (isSearchable(query.value) ? geocode.results.value : []))
/** La recherche est le nom exact d'une ville trouvée : adresses et villes d'abord. */
const exactCity = computed(() => addressMatches.value.find(r => isExactCityMatch(r, query.value)))
const addressesFirst = computed(() => !!exactCity.value)
const options = computed<SearchOption[]>(() => {
  const places = placeMatches.value.map(place => ({ kind: 'place' as const, place }))
  const addresses = addressMatches.value.map(result => ({ kind: 'address' as const, result }))
  return addressesFirst.value ? [...addresses, ...places] : [...places, ...addresses]
})

const searchable = computed(() => isSearchable(query.value))
const expanded = computed(() => open.value && searchable.value)
const empty = computed(() => options.value.length === 0 && geocode.status.value === 'done')

/** Annonce polie, quand la recherche d'adresses a abouti ou échoué (pas à chaque frappe). */
const announcement = computed(() => {
  if (!expanded.value) return ''
  const status = geocode.status.value
  if (status === 'done') return suggestionsAnnouncement(placeMatches.value.length, addressMatches.value.length)
  const places = placeMatches.value.length ? suggestionsAnnouncement(placeMatches.value.length, 0) : ''
  if (status === 'error') return [geocode.error.value, places].filter(Boolean).join(' ')
  if (status === 'offline') return [GEOCODE_OFFLINE_MESSAGE, places].filter(Boolean).join(' ')
  return ''
})

function onInput() {
  open.value = true
  active.value = -1
  geocode.search(query.value)
}

function close() {
  open.value = false
  active.value = -1
}

function clear() {
  query.value = ''
  geocode.clear()
  close()
  input.value?.focus()
}

function choose(option: SearchOption) {
  close()
  if (option.kind === 'place') {
    query.value = option.place.name
    emit('select-place', option.place)
  }
  else {
    // Le titre seul (« Lyon ») : plus court à remplacer par une nouvelle recherche.
    query.value = splitGeocodeLabel(option.result).title
    // Sur écran tactile, on range le clavier pour dégager la carte.
    if (matchesMedia('(pointer: coarse)')) input.value?.blur()
    emit('select-address', option.result)
  }
}

/**
 * Entrée sans option active : ville au nom identique, sinon lieu au nom
 * identique, sinon première adresse, sinon premier lieu.
 */
async function chooseDefault() {
  const q = query.value
  if (exactCity.value) return choose({ kind: 'address', result: exactCity.value })
  const exact = placeMatches.value.find(p => isExactPlaceMatch(p, q))
  if (exact) return choose({ kind: 'place', place: exact })
  await geocode.flush()
  if (query.value !== q) return
  if (exactCity.value) return choose({ kind: 'address', result: exactCity.value })
  const first = addressMatches.value[0]
  if (first) return choose({ kind: 'address', result: first })
  const place = placeMatches.value[0]
  if (place) return choose({ kind: 'place', place })
  open.value = true
}

function move(delta: number) {
  if (!searchable.value) return
  if (!open.value) open.value = true
  const n = options.value.length
  if (!n) return
  active.value = active.value < 0
    ? (delta > 0 ? 0 : n - 1)
    : (active.value + delta + n) % n
  nextTick(() => document.getElementById(optionId(active.value))?.scrollIntoView({ block: 'nearest' }))
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      e.preventDefault()
      move(e.key === 'ArrowDown' ? 1 : -1)
      break
    case 'Enter': {
      if (!searchable.value) return
      e.preventDefault()
      const option = expanded.value ? options.value[active.value] : undefined
      if (option) choose(option)
      else chooseDefault()
      break
    }
    case 'Escape':
      if (!expanded.value && !query.value) return
      // Ne pas fermer la fiche ouverte en même temps.
      e.stopPropagation()
      e.preventDefault()
      if (expanded.value) close()
      else clear()
      break
    case 'Tab':
      // Seul « Réessayer » mérite de garder la liste ouverte.
      if (geocode.status.value !== 'error') close()
      break
  }
}

/**
 * Au focus, tout le texte est sélectionné : une nouvelle frappe remplace la
 * recherche précédente. Le relâchement du clic qui a donné le focus ne doit
 * pas annuler la sélection.
 */
const KEEP_SELECTION_MS = 600
let keepSelectionUntil = 0
function onFocus() {
  if (!query.value) return
  input.value?.select()
  keepSelectionUntil = Date.now() + KEEP_SELECTION_MS
}
function onMouseUp(e: MouseEvent) {
  if (Date.now() < keepSelectionUntil) e.preventDefault()
  keepSelectionUntil = 0
}

function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as Node | null
  if (!next || !root.value?.contains(next)) close()
}

// Les lieux rechargés (nouvelle zone) changent les options : on désactive la sélection.
watch(options, () => {
  if (active.value >= options.value.length) active.value = -1
})

defineExpose({
  focus: () => input.value?.focus(),
})

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-orange-300'
</script>

<template>
  <div ref="root" class="min-w-0 flex-1" @focusout="onFocusOut">
    <div class="relative">
      <label :for="inputId" class="sr-only">Rechercher un lieu, une adresse ou une ville</label>
      <input
        :id="inputId"
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        inputmode="search"
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :maxlength="SEARCH_MAX_LENGTH"
        aria-autocomplete="list"
        :aria-expanded="expanded"
        :aria-controls="listboxId"
        :aria-activedescendant="expanded && active >= 0 ? optionId(active) : undefined"
        placeholder="Lieu, adresse, ville"
        :class="['min-h-[44px] w-full rounded-lg bg-transparent pl-2 pr-11 text-base text-white placeholder-white/70 outline-none sm:text-sm', focusRing]"
        data-testid="search-input"
        @input="onInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @mouseup="onMouseUp"
      >
      <span
        v-if="geocode.status.value === 'pending' && searchable"
        class="pointer-events-none absolute right-11 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-paw-orange-400 border-t-transparent motion-safe:animate-spin"
        aria-hidden="true"
        data-testid="search-loading"
      />
      <button
        v-if="query"
        type="button"
        aria-label="Effacer la recherche"
        :class="['absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-white/80 hover:text-white', focusRing]"
        data-testid="search-clear"
        @click="clear"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <SearchSuggestions
      v-show="expanded"
      :listbox-id="listboxId"
      :option-id="optionId"
      :places="placeMatches"
      :addresses="addressMatches"
      :addresses-first="addressesFirst"
      :active="active"
      :status="geocode.status.value"
      :error="geocode.error.value"
      :empty="empty"
      @choose="choose"
      @hover="active = $event"
      @retry="geocode.retry()"
    />
    <p class="sr-only" aria-live="polite" aria-atomic="true" data-testid="search-announcement">{{ announcement }}</p>
  </div>
</template>
