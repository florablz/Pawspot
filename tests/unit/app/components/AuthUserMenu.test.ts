import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AuthUserMenu from '~/components/auth/AuthUserMenu.vue'

interface User { id: number, username: string, email: string }
const user = ref<User | null>(null)
const logout = vi.fn(async () => {
  user.value = null
})
const LOGIN_LINK = { path: '/login', query: { redirect: '/favorites' } }

beforeEach(() => {
  user.value = { id: 1, username: 'camille', email: 'camille@exemple.fr' }
  logout.mockClear()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('useAuth', () => ({ user, loggedIn: computed(() => !!user.value), logout }))
  vi.stubGlobal('useLoginLink', () => ({ loginLink: computed(() => LOGIN_LINK) }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function mountMenu() {
  // Attaché au document : nécessaire pour le focus et les écouteurs globaux.
  return mount(AuthUserMenu, {
    attachTo: document.body,
    global: { stubs: { NuxtLink: RouterLinkStub } },
  })
}

const trigger = (wrapper: ReturnType<typeof mountMenu>) => wrapper.get('button[aria-haspopup="true"]')
const menu = (wrapper: ReturnType<typeof mountMenu>) => wrapper.find('#account-menu')

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

describe('AuthUserMenu', () => {
  it('non connecté : lien « Connexion » avec retour à la page actuelle', () => {
    user.value = null
    const wrapper = mountMenu()
    const link = wrapper.getComponent(RouterLinkStub)
    expect(link.props('to')).toEqual(LOGIN_LINK)
    expect(link.attributes('aria-label')).toBe('Connexion')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })

  it('connecté : avatar accessible, menu fermé au départ', () => {
    const wrapper = mountMenu()
    expect(trigger(wrapper).attributes('aria-label')).toBe('Menu du compte camille')
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    expect(trigger(wrapper).attributes('aria-controls')).toBe('account-menu')
    expect(menu(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('clic sur l\'avatar : ouvre le menu (favoris, déconnexion)', async () => {
    const wrapper = mountMenu()
    await trigger(wrapper).trigger('click')
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true')
    expect(menu(wrapper).text()).toContain('camille@exemple.fr')
    expect(wrapper.getComponent(RouterLinkStub).props('to')).toBe('/favorites')
    expect(menu(wrapper).text()).toContain('Déconnexion')
    wrapper.unmount()
  })

  it('Échap ferme le menu et rend le focus à l\'avatar', async () => {
    const wrapper = mountMenu()
    await trigger(wrapper).trigger('click')
    await flushPromises()
    const logoutButton = menu(wrapper).get('button').element as HTMLButtonElement
    logoutButton.focus()
    expect(document.activeElement).toBe(logoutButton)

    pressEscape()
    await flushPromises()
    expect(menu(wrapper).exists()).toBe(false)
    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger(wrapper).element)
    wrapper.unmount()
  })

  it('Échap menu fermé : rien ne change, le focus reste où il est', async () => {
    const wrapper = mountMenu()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    pressEscape()
    await flushPromises()
    expect(document.activeElement).toBe(outside)
    expect(menu(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('clic à l\'extérieur : ferme le menu sans voler le focus', async () => {
    const wrapper = mountMenu()
    await trigger(wrapper).trigger('click')
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(menu(wrapper).exists()).toBe(false)
    expect(document.activeElement).not.toBe(trigger(wrapper).element)
    wrapper.unmount()
  })

  it('clic dans le menu : il reste ouvert', async () => {
    const wrapper = mountMenu()
    await trigger(wrapper).trigger('click')
    menu(wrapper).element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(menu(wrapper).exists()).toBe(true)
    wrapper.unmount()
  })

  it('Déconnexion : appelle logout et ferme le menu', async () => {
    const wrapper = mountMenu()
    await trigger(wrapper).trigger('click')
    await menu(wrapper).get('button').trigger('click')
    await flushPromises()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(menu(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('menu démonté : les écouteurs du document sont retirés', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountMenu()
    await trigger(wrapper).trigger('click')
    wrapper.unmount()
    expect(remove.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['keydown', 'pointerdown']))
    remove.mockRestore()
  })
})
