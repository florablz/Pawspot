import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import type { PlaceAlert } from '~/types/api'
import { getApiErrorMessage } from '~/utils/apiError'
import { formatTimeAgo } from '~/utils/timeAgo'
import PlaceAlerts from '~/components/place/PlaceAlerts.vue'

interface FetchOptions { method?: string, body?: Record<string, unknown> }
const fetchMock = vi.fn<(url: string, options?: FetchOptions) => Promise<unknown>>()
const loggedIn = ref(true)
/** Lien de connexion fourni par `useLoginLink` (retour à la fiche après connexion). */
const LOGIN_LINK = { path: '/login', query: { redirect: '/?place=osm%3Anode%3A1' } }

// Auto-imports Nuxt du composant : globaux pour le script, `mocks` pour le gabarit.
beforeEach(() => {
  fetchMock.mockReset()
  loggedIn.value = true
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('getApiErrorMessage', getApiErrorMessage)
  vi.stubGlobal('useAuth', () => ({ loggedIn }))
  vi.stubGlobal('useLoginLink', () => ({ loginLink: computed(() => LOGIN_LINK) }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ID = 'osm:node:1'

function alert(overrides: Partial<PlaceAlert> = {}): PlaceAlert {
  return { id: 1, placeId: ID, type: 'closed', description: null, username: 'camille', createdAt: new Date().toISOString(), ...overrides }
}

async function mountAlerts(existing: PlaceAlert[] = []) {
  fetchMock.mockResolvedValueOnce(existing)
  const wrapper = mount(PlaceAlerts, {
    props: { placeId: ID },
    global: { mocks: { formatTimeAgo }, stubs: { NuxtLink: RouterLinkStub } },
  })
  await flushPromises()
  return wrapper
}

async function openForm(wrapper: Awaited<ReturnType<typeof mountAlerts>>) {
  await wrapper.findAll('button').find(b => b.text().includes('Signaler'))!.trigger('click')
}

describe('PlaceAlerts', () => {
  it('charge les signalements sur l\'URL encodée osm%3Anode%3A1', async () => {
    const wrapper = await mountAlerts([
      alert({ id: 1, type: 'closed', description: 'Rideau baissé' }),
      alert({ id: 2, type: 'info_change', description: 'Nouveaux horaires', username: 'eliot' }),
    ])

    expect(fetchMock).toHaveBeenCalledWith('/api/alerts/osm%3Anode%3A1')
    const items = wrapper.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('Signalé fermé définitivement')
    expect(items[0]!.text()).toContain('Rideau baissé')
    expect(items[1]!.text()).toContain('Changement signalé')
    expect(items[1]!.text()).toContain('par eliot')
    expect(items[0]!.get('time').text()).toBe('à l\'instant')
  })

  it('aucun signalement : message dédié', async () => {
    expect((await mountAlerts()).text()).toContain('Aucun signalement récent')
  })

  it('erreur de chargement : message et « Réessayer »', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const wrapper = mount(PlaceAlerts, {
      props: { placeId: ID },
      global: { mocks: { formatTimeAgo }, stubs: { NuxtLink: RouterLinkStub } },
    })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Impossible de charger les signalements.')

    fetchMock.mockResolvedValueOnce([alert()])
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('li')).toHaveLength(1)
  })

  it('non connecté : lien vers la connexion, pas de bouton « Signaler »', async () => {
    loggedIn.value = false
    const wrapper = await mountAlerts()
    const link = wrapper.getComponent(RouterLinkStub)
    expect(link.props('to')).toEqual(LOGIN_LINK)
    expect(link.text()).toBe('Connectez-vous pour signaler')
    expect(wrapper.findAll('button').some(b => b.text().includes('Signaler'))).toBe(false)
  })

  it('connecté : bouton « Signaler », pas de lien de connexion', async () => {
    const wrapper = await mountAlerts()
    expect(wrapper.findAllComponents(RouterLinkStub)).toHaveLength(0)
    expect(wrapper.findAll('button').some(b => b.text().includes('Signaler'))).toBe(true)
  })

  it('aucun texte au tutoiement dans le formulaire', async () => {
    const wrapper = await mountAlerts()
    await openForm(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.html()).not.toMatch(/\b(tu|ton|ta|tes|choisis|décris)\b/i)
  })

  it('propose les 4 types (sans l\'ancien « change »)', async () => {
    const wrapper = await mountAlerts()
    await openForm(wrapper)
    const values = wrapper.findAll('input[type="radio"]').map(i => i.attributes('value'))
    expect(values).toEqual(['closed', 'temporarily_closed', 'dogs_not_allowed', 'info_change'])
  })

  it('refuse l\'envoi sans type choisi', async () => {
    const wrapper = await mountAlerts()
    await openForm(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('form [role="alert"]').text()).toBe('Choisissez le type de problème.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('info_change : description obligatoire (libellé, required, pas d\'envoi à vide)', async () => {
    const wrapper = await mountAlerts()
    await openForm(wrapper)
    expect(wrapper.get('label[for="alert-description"]').text()).toBe('Détails (optionnel)')
    expect(wrapper.get('textarea').attributes('required')).toBeUndefined()

    await wrapper.get('input[value="info_change"]').setValue()
    expect(wrapper.get('label[for="alert-description"]').text()).toBe('Description (obligatoire)')
    expect(wrapper.get('textarea').attributes('required')).toBeDefined()
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('Décrivez le changement…')

    await wrapper.get('textarea').setValue('   ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('form [role="alert"]').text()).toBe('Décrivez le changement.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('info_change avec description : POST /api/alerts, ajouté en tête, formulaire fermé', async () => {
    const wrapper = await mountAlerts([alert({ id: 1 })])
    await openForm(wrapper)
    await wrapper.get('input[value="info_change"]').setValue()
    await wrapper.get('textarea').setValue('  Nouveaux horaires  ')
    fetchMock.mockResolvedValueOnce(alert({ id: 2, type: 'info_change', description: 'Nouveaux horaires' }))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/api/alerts', {
      method: 'POST',
      body: { placeId: ID, type: 'info_change', description: 'Nouveaux horaires' },
    })
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.findAll('li')[0]!.text()).toContain('Nouveaux horaires')
  })

  it('autre type sans description : envoyé sans champ description', async () => {
    const wrapper = await mountAlerts()
    await openForm(wrapper)
    await wrapper.get('input[value="closed"]').setValue()
    fetchMock.mockResolvedValueOnce(alert())
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock.mock.lastCall![1]!.body).toEqual({ placeId: ID, type: 'closed', description: undefined })
  })

  it('erreur de l\'API à l\'envoi : message affiché, formulaire gardé', async () => {
    const wrapper = await mountAlerts()
    await openForm(wrapper)
    await wrapper.get('input[value="closed"]').setValue()
    fetchMock.mockRejectedValueOnce({ data: { message: 'Vous avez déjà signalé ce lieu récemment' } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('form [role="alert"]').text()).toBe('Vous avez déjà signalé ce lieu récemment')
    expect(wrapper.find('form').exists()).toBe(true)
  })
})
