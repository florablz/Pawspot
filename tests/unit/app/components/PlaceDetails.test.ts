import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import PlaceDetails from '~/components/place/PlaceDetails.vue'
import { makePlace } from '../_helpers'

// Auto-imports Nuxt du script ; les sous-composants (favori, avis, alertes…) sont remplacés
// par des bouchons : seule l'image de la fiche est vérifiée ici.
beforeEach(() => {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const STUBS = {
  PlaceHeader: true,
  PlaceItineraryLink: true,
  PlaceStatusNotice: true,
  PlaceFavoriteButton: true,
  PlaceDogStatusBadge: true,
  PlaceInfoList: true,
  PlaceAlerts: true,
  PlaceReviews: true,
}

const details = (image?: string) => mount(PlaceDetails, {
  props: { place: makePlace({ id: 'osm:node:1', name: 'Café des Chiens', image }) },
  global: { stubs: STUBS },
})

describe('PlaceDetails — image du lieu', () => {
  it('image OSM sans referrer, chargée en différé, avec un alt qui nomme le lieu', () => {
    const img = details('https://upload.wikimedia.org/photo.jpg').get('img')
    expect(img.attributes('src')).toBe('https://upload.wikimedia.org/photo.jpg')
    expect(img.attributes('referrerpolicy')).toBe('no-referrer')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('alt')).toContain('Café des Chiens')
  })

  it('pas d\'image si le lieu n\'en a pas', () => {
    expect(details().find('img').exists()).toBe(false)
  })

  it('image retirée si son chargement échoue', async () => {
    const wrapper = details('https://upload.wikimedia.org/cassee.jpg')
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
  })
})

describe('PlaceDetails — fiche complète ou embarquée', () => {
  const mountDetails = (props: { embedded?: boolean } = {}, slot?: string) => mount(PlaceDetails, {
    props: { place: makePlace({ id: 'osm:node:1', name: 'Café des Chiens' }), ...props },
    slots: slot ? { default: slot } : {},
    global: { stubs: STUBS },
  })

  it('seule (« Mes favoris ») : en-tête et itinéraire affichés', () => {
    const wrapper = mountDetails()
    expect(wrapper.findComponent({ name: 'PlaceHeader' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'PlaceItineraryLink' }).exists()).toBe(true)
  })

  it('embarquée dans la fiche de la carte : ni en-tête ni itinéraire (déjà dans la partie fixe)', () => {
    const wrapper = mountDetails({ embedded: true })
    expect(wrapper.findComponent({ name: 'PlaceHeader' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'PlaceItineraryLink' }).exists()).toBe(false)
  })

  it('embarquée : garde bandeau d\'état, alertes, infos et avis', () => {
    const wrapper = mountDetails({ embedded: true })
    for (const name of ['PlaceStatusNotice', 'PlaceAlerts', 'PlaceInfoList', 'PlaceReviews']) {
      expect(wrapper.findComponent({ name }).exists(), name).toBe(true)
    }
  })

  it('embarquée : les actions du slot restent affichées', () => {
    const wrapper = mountDetails({ embedded: true }, '<button type="button">Retirer des favoris</button>')
    expect(wrapper.text()).toContain('Retirer des favoris')
  })

  it('attribution OpenStreetMap pour un lieu OSM, pas pour un lieu de la communauté', () => {
    expect(mountDetails().text()).toContain('contributeurs d\'OpenStreetMap')
    const user = mount(PlaceDetails, {
      props: { place: makePlace({ id: 'user:abc', name: 'Toilettage Médor', source: 'user' }) },
      global: { stubs: STUBS },
    })
    expect(user.text()).not.toContain('OpenStreetMap')
  })
})
