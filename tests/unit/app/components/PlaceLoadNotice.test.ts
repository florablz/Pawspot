import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaceLoadNotice from '~/components/place/PlaceLoadNotice.vue'

type State = 'loading' | 'not-found' | 'error'

const mountNotice = (state: State, message?: string | null) => mount(PlaceLoadNotice, { props: { state, message } })
const button = (wrapper: ReturnType<typeof mountNotice>, label: string) => wrapper.findAll('button').find(b => b.text() === label)

describe('PlaceLoadNotice — fiche d\'une URL /lieu/… impossible à afficher', () => {
  it('chargement : message d\'état poli, sans bouton', () => {
    const wrapper = mountNotice('loading')
    const box = wrapper.get('[data-testid="place-load-notice"]')
    expect(box.attributes('role')).toBe('status')
    expect(box.attributes('data-state')).toBe('loading')
    expect(box.text()).toContain('Chargement du lieu')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('lieu introuvable : alerte, « Retour à la carte » mais pas « Réessayer »', () => {
    const wrapper = mountNotice('not-found')
    expect(wrapper.get('[role="alert"]').text()).toContain('Ce lieu n\'existe plus ou est introuvable.')
    expect(button(wrapper, 'Retour à la carte')).toBeDefined()
    expect(button(wrapper, 'Réessayer')).toBeUndefined()
  })

  it('erreur : message reçu, « Réessayer » et « Retour à la carte »', async () => {
    const wrapper = mountNotice('error', 'Connexion impossible. Vérifiez votre réseau.')
    expect(wrapper.get('[role="alert"]').text()).toContain('Connexion impossible. Vérifiez votre réseau.')
    await button(wrapper, 'Réessayer')!.trigger('click')
    await button(wrapper, 'Retour à la carte')!.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('erreur sans message : texte par défaut', () => {
    expect(mountNotice('error', null).text()).toContain('Impossible de charger ce lieu.')
  })

  it('« Retour à la carte » émet close (lieu introuvable)', async () => {
    const wrapper = mountNotice('not-found')
    await button(wrapper, 'Retour à la carte')!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('retry')).toBeUndefined()
  })
})
