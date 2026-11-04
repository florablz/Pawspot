import { enableAutoUnmount, mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import type { FavoritePlace } from '#shared/types'
import FavoritesListItem from '~/components/favorites/FavoritesListItem.vue'
import { placePath } from '~/utils/placeUrl'
import { formatTimeAgo } from '~/utils/timeAgo'
import { makePlace } from '../_helpers'

// Auto-imports Nuxt du script ; `NuxtLink` remplacé par le lien de test de Vue Test Utils.
beforeEach(() => {
  for (const [name, fn] of Object.entries({ computed, placePath, formatTimeAgo })) vi.stubGlobal(name, fn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

const FAVORITE: FavoritePlace = {
  ...makePlace({ id: 'osm:node:1001', name: 'Café de Flore', category: 'cafe' }),
  favoritedAt: '2026-10-30T10:00:00.000Z',
}

function mountItem(favorite = FAVORITE, current = false) {
  return mount(FavoritesListItem, {
    props: { favorite, current },
    global: {
      stubs: { NuxtLink: RouterLinkStub, PlaceDogStatusBadge: true },
      // Appelé depuis le template : auto-import exposé au rendu.
      mocks: { formatTimeAgo, placePath },
    },
  })
}

describe('FavoritesListItem — « Voir sur la carte »', () => {
  it('lien vers la fiche, id encodé (/lieu/osm%3Anode%3A…)', () => {
    const link = mountItem().getComponent(RouterLinkStub)
    expect(link.props('to')).toBe('/lieu/osm%3Anode%3A1001')
  })

  it('nom accessible qui nomme le lieu', () => {
    const link = mountItem().get('[data-testid="favorite-map-link"]')
    expect(link.attributes('aria-label')).toBe('Voir Café de Flore sur la carte')
    expect(link.attributes('title')).toBe('Voir sur la carte')
  })

  it('lieu de la communauté : id encodé aussi', () => {
    const link = mountItem({ ...FAVORITE, id: 'user:aB3_x-9', name: 'Parc à chiens' }).getComponent(RouterLinkStub)
    expect(link.props('to')).toBe('/lieu/user%3AaB3_x-9')
  })
})

describe('FavoritesListItem — actions', () => {
  it('bouton principal : émet select ; aria-current seulement sur le favori ouvert', async () => {
    const wrapper = mountItem()
    const main = wrapper.findAll('button')[0]!
    expect(main.attributes('aria-current')).toBeUndefined()
    await main.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)

    expect(mountItem(FAVORITE, true).findAll('button')[0]!.attributes('aria-current')).toBe('true')
  })

  it('« Retirer … des favoris » : émet remove', async () => {
    const wrapper = mountItem()
    await wrapper.get('button[aria-label="Retirer Café de Flore des favoris"]').trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})
