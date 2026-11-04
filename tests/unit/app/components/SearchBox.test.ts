import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GeocodeResponse, Place } from '#shared/types'
import SearchBox from '~/components/search/SearchBox.vue'
import SearchSuggestions from '~/components/search/SearchSuggestions.vue'
import { GEOCODE_DEBOUNCE_MS, GEOCODE_OFFLINE_MESSAGE, useGeocode } from '~/composables/useGeocode'
import { getApiErrorMessage } from '~/utils/apiError'
import * as suggestions from '~/utils/searchSuggestions'
import { GEOCODE_LYON } from '../_geocode'
import { makePlace } from '../_helpers'

/**
 * Recherche unifiée (§3.2), motif combobox ARIA : rôles, clavier, Entrée,
 * Échap, effacement, événements, annonce. `useGeocode` réel, `$fetch` simulé.
 */
const fetchMock = vi.fn<(url: string, options: { query: { q: string } }) => Promise<GeocodeResponse>>()
const coarse = ref(false)

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(GEOCODE_LYON)
  coarse.value = false
  const autoImports = { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useGeocode, getApiErrorMessage, GEOCODE_OFFLINE_MESSAGE, ...suggestions }
  for (const [name, value] of Object.entries(autoImports)) vi.stubGlobal(name, value)
  vi.stubGlobal('useId', () => 'sb')
  vi.stubGlobal('matchesMedia', (q: string) => q === '(pointer: coarse)' && coarse.value)
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

const TETE_DOR = makePlace({ id: 'osm:way:1', name: 'Parc de la Tête d\'Or', category: 'park', lat: 45.7772, lon: 4.8558 })
const LYON_CAFE = makePlace({ id: 'osm:node:2', name: 'Lyon Café', category: 'cafe' })
const PETIT_LYON = makePlace({ id: 'osm:node:3', name: 'Le Petit Lyon', category: 'restaurant' })
const PLACES = [TETE_DOR, LYON_CAFE, PETIT_LYON]

function mountBox(places: Place[] = PLACES) {
  return mount(SearchBox, {
    props: { places },
    attachTo: document.body,
    global: {
      components: { SearchSuggestions },
      stubs: { PlaceDogStatusBadge: true },
      // Auto-imports lus par les templates (le script les trouve en globaux).
      mocks: {
        SEARCH_MAX_LENGTH: suggestions.SEARCH_MAX_LENGTH,
        GEOCODE_TYPE_DISPLAY: suggestions.GEOCODE_TYPE_DISPLAY,
        splitGeocodeLabel: suggestions.splitGeocodeLabel,
        GEOCODE_OFFLINE_MESSAGE,
      },
    },
  })
}
type Wrapper = ReturnType<typeof mountBox>

const input = (w: Wrapper) => w.get<HTMLInputElement>('[data-testid="search-input"]')
const options = (w: Wrapper) => w.findAll('[role="option"]')
const optionTexts = (w: Wrapper) => options(w).map(o => o.text())
const expanded = (w: Wrapper) => input(w).attributes('aria-expanded')
const announcement = (w: Wrapper) => w.get('[data-testid="search-announcement"]').text()

/** Saisie puis fin du debounce et de la réponse de `/api/geocode`. */
async function type(w: Wrapper, text: string, settle = true) {
  input(w).element.focus()
  await input(w).setValue(text)
  if (settle) await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
  await nextTick()
}

const key = (w: Wrapper, k: string) => input(w).trigger('keydown', { key: k })

describe('SearchBox', () => {
  describe('rôles et attributs ARIA', () => {
    it('champ combobox étiqueté, relié à la listbox, fermé au départ', () => {
      const w = mountBox()
      const el = input(w)
      expect(el.attributes('role')).toBe('combobox')
      expect(el.attributes('aria-autocomplete')).toBe('list')
      expect(el.attributes('aria-expanded')).toBe('false')
      expect(el.attributes('aria-activedescendant')).toBeUndefined()
      expect(w.get(`label[for="${el.attributes('id')}"]`).text()).toBe('Rechercher un lieu, une adresse ou une ville')
      const listbox = w.get('[role="listbox"]')
      expect(el.attributes('aria-controls')).toBe(listbox.attributes('id'))
      expect(listbox.attributes('aria-label')).toBe('Suggestions de recherche')
    })

    it('ouvert, saisie partielle : deux groupes étiquetés (lieux puis adresses), options non sélectionnées', async () => {
      const w = mountBox()
      await type(w, 'Lyo')
      expect(expanded(w)).toBe('true')

      const groups = w.findAll('[role="group"]')
      expect(groups).toHaveLength(2)
      const labels = groups.map(g => w.get(`[id="${g.attributes('aria-labelledby')}"]`).text())
      expect(labels).toEqual(['Lieux PawSpot', 'Adresses et villes'])
      expect(groups[0]!.findAll('[role="option"]')).toHaveLength(2)
      expect(groups[1]!.findAll('[role="option"]')).toHaveLength(2)

      // Ordre : lieux classés (début du nom avant début d'un mot), puis adresses dans l'ordre de l'API.
      expect(optionTexts(w)[0]).toContain('Lyon Café')
      expect(optionTexts(w)[1]).toContain('Le Petit Lyon')
      expect(optionTexts(w)[2]).toContain('Lyon')
      expect(optionTexts(w)[2]).toContain('Ville · Métropole de Lyon, Rhône')
      expect(optionTexts(w)[3]).toContain('Code postal · Lyon')

      const ids = options(w).map(o => o.attributes('id'))
      expect(new Set(ids).size).toBe(4)
      expect(options(w).every(o => o.attributes('aria-selected') === 'false')).toBe(true)
      // Les options ne prennent jamais le focus.
      expect(options(w).every(o => o.attributes('tabindex') === undefined)).toBe(true)
    })

    it('sous 2 caractères : liste fermée, aucun appel', async () => {
      const w = mountBox()
      await type(w, 'L')
      expect(expanded(w)).toBe('false')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('flèches haut et bas', () => {
    it('↓ active la première option, met à jour aria-activedescendant et aria-selected, puis boucle', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      const ids = options(w).map(o => o.attributes('id'))

      await key(w, 'ArrowDown')
      expect(input(w).attributes('aria-activedescendant')).toBe(ids[0])
      expect(options(w)[0]!.attributes('aria-selected')).toBe('true')

      await key(w, 'ArrowDown')
      await key(w, 'ArrowDown')
      await key(w, 'ArrowDown')
      expect(input(w).attributes('aria-activedescendant')).toBe(ids[3])
      await key(w, 'ArrowDown')
      expect(input(w).attributes('aria-activedescendant')).toBe(ids[0])
      // Le focus reste dans le champ.
      expect(document.activeElement).toBe(input(w).element)
    })

    it('↑ depuis rien active la dernière option, puis boucle vers le haut', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      const ids = options(w).map(o => o.attributes('id'))
      await key(w, 'ArrowUp')
      expect(input(w).attributes('aria-activedescendant')).toBe(ids[3])
      await key(w, 'ArrowUp')
      expect(input(w).attributes('aria-activedescendant')).toBe(ids[2])
      await key(w, 'ArrowDown')
      await key(w, 'ArrowDown')
      expect(input(w).attributes('aria-activedescendant')).toBe(ids[0])
    })

    it('une nouvelle frappe désactive l\'option active', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      await key(w, 'ArrowDown')
      await type(w, 'Lyon C')
      expect(input(w).attributes('aria-activedescendant')).toBeUndefined()
    })

    it('↓ rouvre la liste fermée par Échap', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      await key(w, 'Escape')
      expect(expanded(w)).toBe('false')
      await key(w, 'ArrowDown')
      expect(expanded(w)).toBe('true')
    })
  })

  describe('nom exact d\'une ville (2a0168f)', () => {
    it('« Lyon » : adresses et villes d\'abord, puis les lieux PawSpot', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      const groups = w.findAll('[role="group"]')
      const labels = groups.map(g => w.get(`[id="${g.attributes('aria-labelledby')}"]`).text())
      expect(labels).toEqual(['Adresses et villes', 'Lieux PawSpot'])
      expect(optionTexts(w)[0]).toContain('Ville · Métropole de Lyon, Rhône')
      expect(optionTexts(w)[2]).toContain('Lyon Café')
      // Identifiants uniques et dans l'ordre affiché (aria-activedescendant cohérent).
      expect(new Set(options(w).map(o => o.attributes('id'))).size).toBe(4)
      await key(w, 'ArrowDown')
      expect(input(w).attributes('aria-activedescendant')).toBe(options(w)[0]!.attributes('id'))
      expect(options(w)[0]!.attributes('aria-selected')).toBe('true')
    })

    it('Entrée sans option active : la ville passe avant un lieu au nom identique ; titre seul dans le champ', async () => {
      const lyonPlace = makePlace({ id: 'osm:node:4', name: 'Lyon', category: 'bar' })
      const w = mountBox([...PLACES, lyonPlace])
      await type(w, 'lyon')
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(0)
      expect(w.emitted('select-address')).toEqual([[GEOCODE_LYON.results[0]]])
      expect(w.emitted('select-place')).toBeUndefined()
      expect(input(w).element.value).toBe('Lyon')
    })

    it('au focus, le texte précédent est sélectionné (une nouvelle frappe le remplace)', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(0)
      input(w).element.blur()
      await input(w).trigger('focus')
      expect(input(w).element.selectionStart).toBe(0)
      expect(input(w).element.selectionEnd).toBe(input(w).element.value.length)
    })
  })

  describe('Entrée', () => {
    it('choisit l\'option active (lieu) : select-place, liste fermée, nom dans le champ', async () => {
      const w = mountBox()
      await type(w, 'Lyo')
      await key(w, 'ArrowDown')
      await key(w, 'Enter')
      expect(w.emitted('select-place')).toEqual([[LYON_CAFE]])
      expect(w.emitted('select-address')).toBeUndefined()
      expect(expanded(w)).toBe('false')
      expect(input(w).element.value).toBe('Lyon Café')
    })

    it('choisit l\'option active (adresse) : select-address avec le résultat de l\'API, titre seul dans le champ', async () => {
      const w = mountBox()
      await type(w, 'Lyo')
      await key(w, 'ArrowUp')
      await key(w, 'Enter')
      expect(w.emitted('select-address')).toEqual([[GEOCODE_LYON.results[1]]])
      // « 69002, Lyon » → « 69002 » : plus court à remplacer par une nouvelle recherche.
      expect(input(w).element.value).toBe('69002')
    })

    it('sans option active : le lieu au nom identique passe avant les adresses', async () => {
      const w = mountBox()
      await type(w, 'le petit lyon')
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(0)
      expect(w.emitted('select-place')).toEqual([[PETIT_LYON]])
      expect(w.emitted('select-address')).toBeUndefined()
    })

    it('sans option active ni lieu exact : la première adresse, même avant la fin du debounce', async () => {
      const w = mountBox()
      await type(w, 'Lyon', false)
      expect(fetchMock).not.toHaveBeenCalled()
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(w.emitted('select-address')).toEqual([[GEOCODE_LYON.results[0]]])
      expect(w.emitted('select-place')).toBeUndefined()
    })

    it('sans adresse : le premier lieu proposé', async () => {
      fetchMock.mockResolvedValue({ results: [] })
      const w = mountBox()
      await type(w, 'Lyon')
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(0)
      expect(w.emitted('select-place')).toEqual([[LYON_CAFE]])
    })

    it('aucun résultat : rien n\'est émis, la liste montre « Aucun résultat »', async () => {
      fetchMock.mockResolvedValue({ results: [] })
      const w = mountBox()
      await type(w, 'Zzyzx')
      await key(w, 'Escape')
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(0)
      expect(w.emitted('select-place')).toBeUndefined()
      expect(w.emitted('select-address')).toBeUndefined()
      expect(expanded(w)).toBe('true')
      expect(w.find('[data-testid="search-status-empty"]').exists()).toBe(true)
    })

    it('sous 2 caractères : Entrée ne fait rien', async () => {
      const w = mountBox()
      await type(w, 'L')
      await key(w, 'Enter')
      await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(w.emitted('select-place')).toBeUndefined()
      expect(w.emitted('select-address')).toBeUndefined()
    })
  })

  describe('Échap', () => {
    it('ferme d\'abord la liste (texte gardé), puis efface, sans propager l\'événement', async () => {
      const outside = vi.fn()
      document.addEventListener('keydown', outside)
      try {
        const w = mountBox()
        await type(w, 'Lyon')

        await key(w, 'Escape')
        expect(expanded(w)).toBe('false')
        expect(input(w).element.value).toBe('Lyon')

        await key(w, 'Escape')
        expect(input(w).element.value).toBe('')
        expect(outside).not.toHaveBeenCalled()

        // Champ vide et liste fermée : Échap repart vers la page (fermer la fiche).
        await key(w, 'Escape')
        expect(outside).toHaveBeenCalledTimes(1)
      }
      finally {
        document.removeEventListener('keydown', outside)
      }
    })
  })

  describe('Tab', () => {
    it('ferme la liste et laisse sortir le focus', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      input(w).element.dispatchEvent(tab)
      await nextTick()
      expect(expanded(w)).toBe('false')
      expect(tab.defaultPrevented).toBe(false)
    })

    it('garde la liste ouverte en cas d\'erreur (pour atteindre « Réessayer »)', async () => {
      fetchMock.mockRejectedValue({ statusCode: 503, data: { message: 'Le service de recherche d\'adresses est momentanément indisponible, réessayez dans quelques instants.' } })
      const w = mountBox()
      await type(w, 'Lyon')
      await key(w, 'Tab')
      expect(expanded(w)).toBe('true')
      const error = w.get('[data-testid="search-status-error"]')
      expect(error.text()).toContain('momentanément indisponible')

      fetchMock.mockResolvedValue(GEOCODE_LYON)
      await error.get('button').trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(w.findAll('[data-testid="search-option-address"]')).toHaveLength(2)
    })
  })

  describe('bouton ×', () => {
    it('absent sans texte ; efface, ferme la liste et rend le focus au champ', async () => {
      const w = mountBox()
      expect(w.find('[data-testid="search-clear"]').exists()).toBe(false)
      await type(w, 'Lyon')
      const clear = w.get('[data-testid="search-clear"]')
      expect(clear.attributes('aria-label')).toBe('Effacer la recherche')
      ;(clear.element as HTMLButtonElement).focus()

      await clear.trigger('click')
      expect(input(w).element.value).toBe('')
      expect(expanded(w)).toBe('false')
      expect(document.activeElement).toBe(input(w).element)
      expect(w.find('[data-testid="search-clear"]').exists()).toBe(false)
    })
  })

  describe('clic sur une option', () => {
    it('lieu → select-place ; adresse → select-address', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      await w.findAll('[data-testid="search-option-place"]')[1]!.trigger('click')
      expect(w.emitted('select-place')).toEqual([[PETIT_LYON]])

      await type(w, 'Lyon')
      await w.findAll('[data-testid="search-option-address"]')[0]!.trigger('click')
      expect(w.emitted('select-address')).toEqual([[GEOCODE_LYON.results[0]]])
    })

    it('appuyer sur une option ne retire pas le focus du champ (mousedown sans action par défaut)', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      options(w)[0]!.element.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
    })

    it('écran tactile : choisir une adresse range le clavier (blur)', async () => {
      coarse.value = true
      const w = mountBox()
      await type(w, 'Lyon')
      await w.findAll('[data-testid="search-option-address"]')[0]!.trigger('click')
      expect(document.activeElement).not.toBe(input(w).element)
    })
  })

  describe('annonce aria-live', () => {
    it('région polie et atomique ; muette pendant la frappe, annonce le total à la réponse', async () => {
      const w = mountBox()
      const live = w.get('[data-testid="search-announcement"]')
      expect(live.attributes('aria-live')).toBe('polite')
      expect(live.attributes('aria-atomic')).toBe('true')

      await type(w, 'Lyon', false)
      expect(announcement(w)).toBe('')
      await vi.advanceTimersByTimeAsync(GEOCODE_DEBOUNCE_MS)
      await nextTick()
      expect(announcement(w)).toBe('2 lieux PawSpot et 2 adresses ou villes. Flèches haut et bas pour parcourir, Entrée pour choisir.')
    })

    it('aucun résultat : « Aucun résultat. »', async () => {
      fetchMock.mockResolvedValue({ results: [] })
      const w = mountBox()
      await type(w, 'Zzyzx')
      expect(announcement(w)).toBe('Aucun résultat.')
    })

    it('erreur : message de l\'API suivi des lieux trouvés', async () => {
      fetchMock.mockRejectedValue({ statusCode: 503, data: { message: 'Service indisponible.' } })
      const w = mountBox()
      await type(w, 'Lyon')
      expect(announcement(w)).toBe('Service indisponible. 2 lieux PawSpot. Flèches haut et bas pour parcourir, Entrée pour choisir.')
    })

    it('liste fermée : plus rien d\'annoncé', async () => {
      const w = mountBox()
      await type(w, 'Lyon')
      await key(w, 'Escape')
      expect(announcement(w)).toBe('')
    })
  })
})
