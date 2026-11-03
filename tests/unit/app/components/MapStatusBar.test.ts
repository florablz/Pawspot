import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import MapStatusBar from '~/components/map/MapStatusBar.vue'

beforeEach(() => {
  vi.stubGlobal('computed', computed)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Props {
  count: number
  loadedCount: number
  loaded: boolean
  filtersActive: boolean
  fetching: boolean
  error: string | null
  stale: boolean
  zoomTooLow: boolean
  outsideCoverage?: boolean
  truncated: boolean
  incomplete: boolean
  locationMessage: string | null
  confirmedOnly?: boolean
  locating?: boolean
}

const BASE: Props = {
  count: 12,
  loadedCount: 12,
  loaded: true,
  filtersActive: false,
  fetching: false,
  error: null,
  stale: false,
  zoomTooLow: false,
  truncated: false,
  incomplete: false,
  locationMessage: null,
}

const bar = (props: Partial<Props> = {}) => mount(MapStatusBar, { props: { ...BASE, ...props } })
const NOTICES = ['location', 'outside-coverage', 'zoom', 'truncated', 'stale', 'incomplete'] as const
const visibleNotices = (wrapper: ReturnType<typeof bar>) =>
  NOTICES.filter(n => wrapper.find(`[data-testid="notice-${n}"]`).exists())

describe('MapStatusBar', () => {
  describe('nombre de lieux (toujours visible)', () => {
    it.each([
      [0, '0 lieu affiché'],
      [1, '1 lieu affiché'],
      [12, '12 lieux affichés'],
    ])('%i → « %s »', (count, text) => {
      expect(bar({ count, loadedCount: count }).get('[data-testid="places-count"]').text()).toBe(text)
    })

    it('avec des filtres : « sur N » et bouton « Effacer les filtres »', async () => {
      const wrapper = bar({ count: 3, loadedCount: 12, filtersActive: true })
      expect(wrapper.get('[data-testid="places-count"]').text()).toBe('3 lieux affichés sur 12')
      const clear = wrapper.findAll('button').find(b => b.text() === 'Effacer les filtres')!
      await clear.trigger('click')
      expect(wrapper.emitted('clear-filters')).toHaveLength(1)
    })

    it('filtres actifs sans effet : pas de « sur N »', () => {
      expect(bar({ filtersActive: true }).get('[data-testid="places-count"]').text()).toBe('12 lieux affichés')
    })

    it('région d\'annonce polie et permanente pour les lecteurs d\'écran', async () => {
      const wrapper = bar()
      const region = wrapper.get('[data-testid="map-status"]')
      expect(region.attributes('role')).toBe('status')
      expect(region.attributes('aria-live')).toBe('polite')
      expect(region.find('[data-testid="places-count"]').exists()).toBe(true)
      // Une seule région : son contenu change, elle n'est jamais recréée.
      expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
      const element = region.element
      for (const props of [{ fetching: true }, { stale: true }, { loaded: false, count: 0, loadedCount: 0 }, { error: 'Erreur' }]) {
        await wrapper.setProps(props)
        expect(wrapper.get('[data-testid="map-status"]').element).toBe(element)
        expect(wrapper.findAll('[role="status"]')).toHaveLength(1)
      }
    })
  })

  it('état normal : aucun bandeau, ni chargement, ni erreur', () => {
    const wrapper = bar()
    expect(visibleNotices(wrapper)).toEqual([])
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Aucun lieu')
  })

  it('chargement : « Chargement des lieux… » dans la région d\'état', () => {
    const wrapper = bar({ fetching: true })
    expect(wrapper.get('[data-testid="loading"]').text()).toBe('Chargement des lieux…')
    expect(wrapper.get('[data-testid="map-status"]').text()).toContain('Chargement des lieux…')
  })

  describe('rien n\'est encore chargé', () => {
    const empty = { loaded: false, count: 0, loadedCount: 0 }

    it('« Zoomez pour afficher les lieux », sans « 0 lieu affiché »', () => {
      const wrapper = bar(empty)
      expect(wrapper.get('[data-testid="places-count"]').text()).toBe('Zoomez pour afficher les lieux')
      expect(wrapper.text()).not.toContain('0 lieu')
    })

    it.each([
      ['géolocalisation en cours', { locating: true }],
      ['message de géolocalisation', { locationMessage: 'Position indisponible : carte centrée sur Paris.' }],
      ['chargement en cours', { fetching: true }],
    ])('rien à compter si %s', (_label, props) => {
      const wrapper = bar({ ...empty, ...props })
      expect(wrapper.find('[data-testid="places-count"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Zoomez pour afficher les lieux')
      // La région d'annonce reste en place.
      expect(wrapper.find('[data-testid="map-status"]').exists()).toBe(true)
    })
  })

  it('erreur : message + « Réessayer » qui émet retry ; masquée pendant le chargement', async () => {
    const wrapper = bar({ error: 'Impossible de charger les lieux.' })
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Impossible de charger les lieux.')
    await alert.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    expect(bar({ error: 'Erreur', fetching: true }).find('[role="alert"]').exists()).toBe(false)
  })

  it.each([
    ['zoomTooLow', { zoomTooLow: true }, 'zoom', 'Zoomez sur une ville pour voir tous les lieux.'],
    ['truncated', { truncated: true }, 'truncated', 'Trop de lieux dans cette zone : zoomez pour tous les afficher.'],
    ['stale', { stale: true }, 'stale', 'Lieux affichés depuis notre sauvegarde : OpenStreetMap ne répond pas pour l\'instant, certaines infos peuvent dater.'],
    ['incomplete', { incomplete: true }, 'incomplete', 'Une partie de la zone n\'a pas encore été chargée.'],
    ['géolocalisation', { locationMessage: 'Position indisponible : carte centrée sur Paris.' }, 'location', 'Position indisponible : carte centrée sur Paris.'],
  ] as const)('bandeau %s', (_label, props, notice, text) => {
    const wrapper = bar(props)
    expect(visibleNotices(wrapper)).toEqual([notice])
    expect(wrapper.get(`[data-testid="notice-${notice}"]`).text()).toContain(text)
  })

  it('stale : « Réessayer » émet retry, masqué pendant un chargement', async () => {
    const wrapper = bar({ stale: true })
    const retry = wrapper.get('[data-testid="notice-stale"] button')
    expect(retry.text()).toBe('Réessayer')
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(bar({ stale: true, fetching: true }).find('[data-testid="notice-stale"] button').exists()).toBe(false)
  })

  describe('filtre « Confirmés » qui vide la carte', () => {
    const confirmedEmpty = { confirmedOnly: true, filtersActive: true, count: 0, loadedCount: 7 }

    it('message dédié et bouton qui émet disable-confirmed', async () => {
      const wrapper = bar(confirmedEmpty)
      const notice = wrapper.get('[data-testid="notice-confirmed-empty"]')
      expect(notice.text()).toContain('Aucun lieu n\'est encore confirmé par la communauté ici. Désactivez ce filtre pour voir les lieux probables.')
      // Pas de message générique en doublon.
      expect(wrapper.text()).not.toContain('Aucun lieu ne correspond à vos filtres.')
      const button = notice.get('button')
      expect(button.text()).toBe('Désactiver le filtre « Confirmés »')
      expect(button.classes()).toContain('min-h-[44px]')
      await button.trigger('click')
      expect(wrapper.emitted('disable-confirmed')).toHaveLength(1)
      expect(wrapper.emitted('clear-filters')).toBeUndefined()
    })

    it.each([
      ['des lieux restent affichés', { count: 2 }],
      ['rien n\'est chargé dans la zone', { loadedCount: 0 }],
      ['chargement en cours', { fetching: true }],
      ['erreur', { error: 'Erreur' }],
      ['filtre « Confirmés » inactif', { confirmedOnly: false }],
    ])('absent si %s', (_label, props) => {
      expect(bar({ ...confirmedEmpty, ...props }).find('[data-testid="notice-confirmed-empty"]').exists()).toBe(false)
    })
  })

  describe('zone hors couverture', () => {
    it('bandeau dédié une fois la zone chargée, sans « Aucun lieu trouvé »', () => {
      const wrapper = bar({ outsideCoverage: true, count: 0, loadedCount: 0 })
      expect(visibleNotices(wrapper)).toEqual(['outside-coverage'])
      expect(wrapper.get('[data-testid="notice-outside-coverage"]').text()).toContain('PawSpot couvre la France')
      expect(wrapper.text()).not.toContain('Aucun lieu trouvé')
    })

    it('masque le bandeau « Zoomez » quand le zoom est aussi trop faible', () => {
      const wrapper = bar({ outsideCoverage: true, zoomTooLow: true, count: 0, loadedCount: 0 })
      expect(visibleNotices(wrapper)).toEqual(['outside-coverage'])
      expect(wrapper.text()).not.toContain('Zoomez sur une ville')
    })

    it('absent tant que rien n\'est chargé', () => {
      expect(visibleNotices(bar({ outsideCoverage: true, loaded: false, count: 0, loadedCount: 0 }))).toEqual([])
    })
  })

  it('zoomTooLow : bandeau seulement une fois une zone chargée', () => {
    expect(visibleNotices(bar({ zoomTooLow: true, loaded: false, count: 0, loadedCount: 0 }))).toEqual([])
  })

  it('incomplete : « Compléter » émet retry, bandeau masqué pendant un chargement ou une erreur', async () => {
    const wrapper = bar({ incomplete: true })
    await wrapper.get('[data-testid="notice-incomplete"] button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(visibleNotices(bar({ incomplete: true, fetching: true }))).toEqual([])
    expect(visibleNotices(bar({ incomplete: true, error: 'Erreur' }))).toEqual([])
  })

  describe('liste vide', () => {
    it('aucun lieu dans la zone', () => {
      expect(bar({ count: 0, loadedCount: 0 }).text()).toContain('Aucun lieu trouvé dans cette zone.')
    })

    it('lieux chargés mais tous filtrés', () => {
      expect(bar({ count: 0, loadedCount: 5, filtersActive: true }).text()).toContain('Aucun lieu ne correspond à vos filtres.')
    })

    it.each([
      ['rien n\'est chargé', { loaded: false }],
      ['chargement en cours', { fetching: true }],
      ['erreur', { error: 'Erreur' }],
      ['zoom trop faible (le bandeau suffit)', { zoomTooLow: true }],
    ])('pas de message vide si %s', (_label, props) => {
      expect(bar({ count: 0, loadedCount: 0, ...props }).text()).not.toContain('Aucun lieu')
    })
  })

  it('boutons d\'action : zone tactile d\'au moins 44 px', () => {
    const wrapper = bar({ filtersActive: true, count: 1, incomplete: true })
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) expect(b.classes()).toContain('min-h-[44px]')
  })

  describe('géolocalisation refusée', () => {
    const MESSAGE = 'Géolocalisation refusée. Cherchez votre ville ou une adresse dans la barre de recherche, ou zoomez sur la carte.'

    it('le bouton « Chercher une ville » émet focus-search', async () => {
      const wrapper = bar({ loaded: false, count: 0, loadedCount: 0, locationMessage: MESSAGE })
      const notice = wrapper.get('[data-testid="notice-location"]')
      expect(notice.text()).toContain(MESSAGE)
      const button = notice.findAll('button').find(b => b.text() === 'Chercher une ville')!
      expect(button.attributes('type')).toBe('button')
      await button.trigger('click')
      expect(wrapper.emitted('focus-search')).toHaveLength(1)
      expect(wrapper.emitted('retry')).toBeUndefined()
    })

    it('pas de bouton « Chercher une ville » sans message de géolocalisation', () => {
      expect(bar().findAll('button').some(b => b.text() === 'Chercher une ville')).toBe(false)
    })
  })
})
