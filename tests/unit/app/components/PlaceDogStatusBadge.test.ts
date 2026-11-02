import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { DOG_STATUSES, DOG_STATUS_LABELS } from '#shared/dogStatus'
import type { DogStatus } from '#shared/dogStatus'
import type { Place } from '#shared/types'
import { DOG_STATUS_TONE } from '~/utils/dogStatusDisplay'
import PlaceDogStatusBadge from '~/components/place/PlaceDogStatusBadge.vue'

// Auto-imports Nuxt utilisés par le composant.
beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('DOG_STATUS_TONE', DOG_STATUS_TONE)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type BadgePlace = Pick<Place, 'dogStatus' | 'dogStatusSource' | 'osmDogDetail'>

function mountBadge(place: BadgePlace, compact = false) {
  return mount(PlaceDogStatusBadge, { props: { place, compact } })
}

const CONFIRMED: ReadonlySet<DogStatus> = new Set(['confirmed', 'confirmed_outside_only'])

describe('PlaceDogStatusBadge', () => {
  it.each(DOG_STATUSES)('%s : emoji décoratif, libellé, texte pour lecteur d\'écran', (status) => {
    const wrapper = mountBadge({ dogStatus: status })
    const badge = wrapper.get('[data-testid="dog-status-badge"]')
    const { emoji, label } = DOG_STATUS_LABELS[status]

    expect(badge.attributes('data-status')).toBe(status)
    expect(badge.text()).toContain(label)
    expect(badge.text()).toContain('Statut chien :')
    expect(wrapper.get('[aria-hidden="true"]').text()).toBe(emoji)
    expect(badge.text().includes('Confirmé')).toBe(CONFIRMED.has(status))
  })

  it('« Confirmé » absent pour likely_terrace, même avec une source', () => {
    const wrapper = mountBadge({ dogStatus: 'likely_terrace', dogStatusSource: 'terrasse' })
    expect(wrapper.text()).not.toContain('Confirmé')
    expect(wrapper.text()).toContain('Probablement accepté en terrasse — non confirmé')
  })

  it('affiche la source quand elle est connue, rien sinon', () => {
    expect(mountBadge({ dogStatus: 'confirmed', dogStatusSource: '3 membres, dernier retour il y a 12 jours' }).text())
      .toContain('Source : 3 membres, dernier retour il y a 12 jours')
    expect(mountBadge({ dogStatus: 'unknown' }).text()).not.toContain('Source')
  })

  it('détail OSM affiché seulement pour osm_conditional', () => {
    const detail = 'Uniquement la nuit (yes @ (19:00-08:00))'
    expect(mountBadge({ dogStatus: 'osm_conditional', osmDogDetail: detail }).text()).toContain(detail)
    expect(mountBadge({ dogStatus: 'osm_yes', osmDogDetail: detail }).text()).not.toContain(detail)
  })

  it('compact : pas de « Confirmé », source et détail gardés pour les lecteurs d\'écran', () => {
    const wrapper = mountBadge({ dogStatus: 'osm_conditional', dogStatusSource: 'OpenStreetMap', osmDogDetail: 'En laisse' }, true)
    const srOnly = wrapper.findAll('.sr-only').map(s => s.text())
    expect(srOnly).toEqual(['Statut chien :', 'En laisse', 'Source : OpenStreetMap'])
    expect(mountBadge({ dogStatus: 'confirmed' }, true).text()).not.toContain('Confirmé')
  })

  it('teinte : bordure en pointillés pour « probablement », distincte d\'un statut confirmé', () => {
    const likely = mountBadge({ dogStatus: 'likely_terrace' }).get('[data-testid="dog-status-badge"]')
    const confirmed = mountBadge({ dogStatus: 'confirmed' }).get('[data-testid="dog-status-badge"]')
    expect(likely.classes()).toContain('border-dashed')
    expect(confirmed.classes()).not.toContain('border-dashed')
  })
})
