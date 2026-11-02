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
  truncated: boolean
  incomplete: boolean
  locationMessage: string | null
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
const NOTICES = ['location', 'zoom', 'truncated', 'stale', 'incomplete'] as const
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

    it('zone d\'annonce polie pour les lecteurs d\'écran', () => {
      expect(bar().get('[data-testid="places-count"]').attributes('aria-live')).toBe('polite')
    })
  })

  it('état normal : aucun bandeau, ni chargement, ni erreur', () => {
    const wrapper = bar()
    expect(visibleNotices(wrapper)).toEqual([])
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Aucun lieu')
  })

  it('chargement : « Chargement des lieux… » en role status', () => {
    expect(bar({ fetching: true }).get('[role="status"]').text()).toBe('Chargement des lieux…')
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
    ['zoomTooLow', { zoomTooLow: true }, 'zoom', 'Zoomez pour voir les lieux : seuls les lieux déjà connus de PawSpot sont affichés à ce niveau.'],
    ['truncated', { truncated: true }, 'truncated', 'Trop de lieux dans cette zone : zoomez pour tous les afficher.'],
    ['stale', { stale: true }, 'stale', 'Données en cache : le service de cartes ne répond pas'],
    ['incomplete', { incomplete: true }, 'incomplete', 'Une partie de la zone n\'a pas encore été chargée.'],
    ['géolocalisation', { locationMessage: 'Position indisponible : carte centrée sur Paris.' }, 'location', 'Position indisponible : carte centrée sur Paris.'],
  ] as const)('bandeau %s', (_label, props, notice, text) => {
    const wrapper = bar(props)
    expect(visibleNotices(wrapper)).toEqual([notice])
    expect(wrapper.get(`[data-testid="notice-${notice}"]`).text()).toContain(text)
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
})
