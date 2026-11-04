import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlaceItineraryLink from '~/components/place/PlaceItineraryLink.vue'
import { detectItineraryPlatform, ITINERARY_APP_LABELS, itineraryApps, itineraryUrl } from '~/utils/itinerary'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let userAgent = WINDOWS

// Auto-imports Nuxt du script, fournis tels quels (fonctions réelles de app/utils/itinerary.ts).
beforeEach(() => {
  userAgent = WINDOWS
  const autoImports = {
    ref, computed, watch, nextTick, onMounted, onBeforeUnmount,
    detectItineraryPlatform, itineraryApps, itineraryUrl, ITINERARY_APP_LABELS,
  }
  for (const [name, fn] of Object.entries(autoImports)) vi.stubGlobal(name, fn)
  vi.stubGlobal('useId', () => 'menu-itineraire')
  vi.spyOn(navigator, 'userAgent', 'get').mockImplementation(() => userAgent)
  vi.spyOn(navigator, 'platform', 'get').mockImplementation(() => '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

enableAutoUnmount(afterEach)

const PLACE = { name: 'Café « L\'Étoile » & Chiens', lat: 48.8738, lon: 2.295 }

function mountLink() {
  return mount(PlaceItineraryLink, { props: { place: PLACE }, attachTo: document.body })
}

type Wrapper = ReturnType<typeof mountLink>

const button = (w: Wrapper) => w.get('[data-testid="itinerary-button"]')
const menu = (w: Wrapper) => w.get('[data-testid="itinerary-menu"]')
const links = (w: Wrapper) => w.findAll<HTMLAnchorElement>('a[data-app]')
const isOpen = (w: Wrapper) => button(w).attributes('aria-expanded') === 'true'
const active = () => document.activeElement as HTMLElement | null

/** Ouvre au clic et attend la fin de `show()` (asynchrone : focus posé après le rendu). */
async function openMenu(w: Wrapper) {
  const wasOpen = isOpen(w)
  await button(w).trigger('click')
  await flushPromises()
  if (!wasOpen) await vi.waitFor(() => expect(active()?.getAttribute('data-app')).toBeTruthy())
}

/**
 * Touche envoyée à l'élément actif (bouillonne, annulable) ; renvoie l'événement.
 * Petite attente d'abord : Vue ignore un événement bouillonnant horodaté dans la même
 * milliseconde que l'attachement de l'écouteur parent (`e._vts <= invoker.attached`),
 * ce qui arrive quand le test enchaîne montage et touche plus vite qu'un humain.
 */
async function press(key: string, target: Element = active()!) {
  await new Promise(resolve => setTimeout(resolve, 2))
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  await flushPromises()
  return event
}

describe('PlaceItineraryLink — bouton et menu', () => {
  it('fermé au départ : aria-expanded="false", menu masqué, relié par aria-controls', () => {
    const wrapper = mountLink()
    expect(button(wrapper).attributes('aria-expanded')).toBe('false')
    expect(button(wrapper).attributes('aria-controls')).toBe('menu-itineraire')
    expect(menu(wrapper).attributes('id')).toBe('menu-itineraire')
    expect(menu(wrapper).isVisible()).toBe(false)
  })

  it('nom accessible du bouton : « Itinéraire vers <lieu> »', () => {
    expect(button(mountLink()).attributes('aria-label')).toBe(`Itinéraire vers ${PLACE.name}`)
  })

  it('clic : ouvre le menu (aria-expanded="true") et met le focus sur le premier lien', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    expect(isOpen(wrapper)).toBe(true)
    expect(menu(wrapper).isVisible()).toBe(true)
    expect(active()).toBe(links(wrapper)[0]!.element)
  })

  it('second clic : referme le menu', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    await openMenu(wrapper)
    expect(isOpen(wrapper)).toBe(false)
  })

  it('Windows : Google Maps, Waze puis Apple Plans', async () => {
    const wrapper = mountLink()
    await nextTick()
    expect(links(wrapper).map(a => a.attributes('data-app'))).toEqual(['google', 'waze', 'apple'])
  })

  it('iPhone : Apple Plans en premier', async () => {
    userAgent = IPHONE
    const wrapper = mountLink()
    await nextTick()
    expect(links(wrapper).map(a => a.attributes('data-app'))).toEqual(['apple', 'google', 'waze'])
  })

  it('liens : destination seule (aucune origine), nouvel onglet, rel="noopener noreferrer"', () => {
    const wrapper = mountLink()
    for (const link of links(wrapper)) {
      const app = link.attributes('data-app') as 'google' | 'apple' | 'waze'
      expect(link.attributes('href')).toBe(itineraryUrl(app, PLACE))
      expect(link.attributes('href')).not.toMatch(/origin=|saddr=|[?&]from=/)
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
      expect(link.text()).toContain('nouvel onglet')
    }
  })
})

describe('PlaceItineraryLink — clavier', () => {
  it('↓ sur le bouton : ouvre et focus le premier lien ; ↑ : ouvre et focus le dernier', async () => {
    const wrapper = mountLink()
    await press('ArrowDown', button(wrapper).element)
    expect(isOpen(wrapper)).toBe(true)
    expect(active()).toBe(links(wrapper)[0]!.element)

    await press('Escape')
    await press('ArrowUp', button(wrapper).element)
    expect(active()).toBe(links(wrapper)[2]!.element)
  })

  it('↓ / ↑ parcourent les liens en boucle', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    const [first, second, third] = links(wrapper).map(l => l.element)

    expect((await press('ArrowDown')).defaultPrevented).toBe(true)
    expect(active()).toBe(second)
    await press('ArrowDown')
    expect(active()).toBe(third)
    await press('ArrowDown')
    expect(active()).toBe(first)
    await press('ArrowUp')
    expect(active()).toBe(third)
  })

  it('Début / Fin : premier et dernier lien', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    const all = links(wrapper).map(l => l.element)

    await press('End')
    expect(active()).toBe(all[2])
    await press('Home')
    expect(active()).toBe(all[0])
  })

  it('Échap : referme, empêche l\'action par défaut (la fiche reste ouverte) et rend le focus au bouton', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    await press('ArrowDown')

    const event = await press('Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(isOpen(wrapper)).toBe(false)
    expect(active()).toBe(button(wrapper).element)
  })

  it('Échap menu fermé : laissé à la fiche (pas de preventDefault)', async () => {
    const wrapper = mountLink()
    const event = await press('Escape', button(wrapper).element)
    expect(event.defaultPrevented).toBe(false)
  })

  it('Tab hors du menu : referme sans reprendre le focus', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const wrapper = mountLink()
    await openMenu(wrapper)

    links(wrapper)[2]!.element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }))
    await nextTick()
    expect(isOpen(wrapper)).toBe(false)
  })

  it('focus d\'un lien à l\'autre dans le menu : reste ouvert', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    const [first, second] = links(wrapper).map(l => l.element)

    first!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: second }))
    await nextTick()
    expect(isOpen(wrapper)).toBe(true)
  })
})

describe('PlaceItineraryLink — fermeture', () => {
  it('clic (pointerdown) à l\'extérieur : referme', async () => {
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    const wrapper = mountLink()
    await openMenu(wrapper)

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(isOpen(wrapper)).toBe(false)
  })

  it('pointerdown dans le menu : reste ouvert', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)

    links(wrapper)[1]!.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(isOpen(wrapper)).toBe(true)
  })

  it('choisir une application : referme et rend le focus au bouton', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    const link = links(wrapper)[0]!.element
    // Pas de navigation dans happy-dom : on n'en vérifie que la fermeture.
    link.addEventListener('click', e => e.preventDefault())

    link.click()
    await nextTick()
    expect(isOpen(wrapper)).toBe(false)
    expect(active()).toBe(button(wrapper).element)
  })

  it('autre lieu affiché : le menu se referme', async () => {
    const wrapper = mountLink()
    await openMenu(wrapper)
    await wrapper.setProps({ place: { name: 'Parc Monceau', lat: 48.8796, lon: 2.3095 } })
    expect(isOpen(wrapper)).toBe(false)
    expect(links(wrapper)[0]!.attributes('href')).toContain('48.8796,2.3095')
  })

  it('démonté menu ouvert : plus d\'écouteur sur le document', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountLink()
    await openMenu(wrapper)
    wrapper.unmount()
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
  })
})
