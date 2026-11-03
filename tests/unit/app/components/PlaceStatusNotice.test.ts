import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import PlaceStatusNotice from '~/components/place/PlaceStatusNotice.vue'

beforeEach(() => {
  vi.stubGlobal('computed', computed)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const notice = (status: 'active' | 'closed' | 'removed', source: 'osm' | 'user' = 'osm') =>
  mount(PlaceStatusNotice, { props: { place: { status, source } } }).find('[data-testid="place-status-notice"]')

describe('PlaceStatusNotice — bandeaux d\'état', () => {
  it('rien pour un lieu OSM actif', () => {
    expect(notice('active').exists()).toBe(false)
  })

  it('lieu signalé fermé', () => {
    const el = notice('closed')
    expect(el.text()).toContain('Ce lieu est signalé fermé.')
    expect(el.attributes('data-status')).toBe('closed')
  })

  it('lieu disparu d\'OpenStreetMap', () => {
    const el = notice('removed')
    expect(el.text()).toContain('n\'apparaît plus sur OpenStreetMap')
    expect(el.attributes('data-status')).toBe('removed')
  })

  it('lieu ajouté par la communauté', () => {
    expect(notice('active', 'user').text()).toContain('Ajouté par la communauté.')
  })

  it('un lieu de la communauté fermé affiche « fermé » plutôt que « communauté »', () => {
    const el = notice('closed', 'user')
    expect(el.text()).toContain('signalé fermé')
    expect(el.text()).not.toContain('communauté')
  })

  it('l\'icône est décorative', () => {
    expect(notice('closed').get('[aria-hidden="true"]').text()).toBe('⛔')
  })
})
