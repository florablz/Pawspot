import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PlaceShareButton from '~/components/place/PlaceShareButton.vue'
import { placePath } from '~/utils/placeUrl'

const APP_URL = 'https://pawspot.fr'
const PLACE = { id: 'osm:node:1001', name: 'Café de Flore' }
const SHARED_URL = `${APP_URL}/lieu/osm%3Anode%3A1001`

const share = vi.fn<(data: ShareData) => Promise<void>>()
const writeText = vi.fn<(text: string) => Promise<void>>()

/** Remplace une propriété de `navigator` (absente : `undefined`) le temps du test. */
function setNavigator(key: 'share' | 'canShare' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
}

beforeEach(() => {
  share.mockReset().mockResolvedValue(undefined)
  writeText.mockReset().mockResolvedValue(undefined)
  for (const [name, fn] of Object.entries({ ref, computed, watch, nextTick, onBeforeUnmount, placePath })) {
    vi.stubGlobal(name, fn)
  }
  vi.stubGlobal('useId', () => 'lien-partage')
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: APP_URL } }))
  setNavigator('share', share)
  setNavigator('canShare', undefined)
  setNavigator('clipboard', { writeText })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const key of ['share', 'canShare', 'clipboard'] as const) Reflect.deleteProperty(navigator, key)
})

enableAutoUnmount(afterEach)

function mountShare(place = PLACE) {
  return mount(PlaceShareButton, { props: { place }, attachTo: document.body })
}

type Wrapper = ReturnType<typeof mountShare>

async function clickShare(w: Wrapper) {
  await w.get('[data-testid="share-button"]').trigger('click')
  await flushPromises()
}

const feedback = (w: Wrapper) => w.get('[data-testid="share-feedback"]')

describe('PlaceShareButton — Web Share API', () => {
  it('appelle navigator.share avec { title, text, url } et l\'URL publique de la fiche (id encodé)', async () => {
    const wrapper = mountShare()
    await clickShare(wrapper)

    expect(share).toHaveBeenCalledTimes(1)
    const data = share.mock.calls[0]![0]
    expect(data).toEqual({
      title: 'Café de Flore — PawSpot',
      text: expect.stringContaining('Café de Flore'),
      url: SHARED_URL,
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('l\'URL ne contient ni la vue de la carte ni la position', async () => {
    await clickShare(mountShare())
    const url = new URL(share.mock.calls[0]![0].url!)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
  })

  it('id d\'un lieu ajouté par un utilisateur : encodé lui aussi', async () => {
    await clickShare(mountShare({ id: 'user:aB3_x-9', name: 'Parc à chiens' }))
    expect(share.mock.calls[0]![0].url).toBe(`${APP_URL}/lieu/user%3AaB3_x-9`)
  })

  it('partage annulé (AbortError) : aucun repli vers le presse-papier, aucun message', async () => {
    share.mockRejectedValue(new DOMException('Annulé', 'AbortError'))
    const wrapper = mountShare()
    await clickShare(wrapper)

    expect(writeText).not.toHaveBeenCalled()
    expect(feedback(wrapper).text()).toBe('')
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('autre échec de navigator.share : repli vers le presse-papier', async () => {
    share.mockRejectedValue(new DOMException('Refusé', 'NotAllowedError'))
    const wrapper = mountShare()
    await clickShare(wrapper)

    expect(writeText).toHaveBeenCalledWith(SHARED_URL)
    expect(feedback(wrapper).text()).toBe('Lien copié')
  })

  it('canShare refuse les données : copie du lien sans appeler share', async () => {
    setNavigator('canShare', () => false)
    const wrapper = mountShare()
    await clickShare(wrapper)

    expect(share).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(SHARED_URL)
  })
})

describe('PlaceShareButton — presse-papier', () => {
  beforeEach(() => {
    setNavigator('share', undefined)
  })

  it('sans Web Share : copie le lien et annonce « Lien copié » (role="status")', async () => {
    const wrapper = mountShare()
    await clickShare(wrapper)

    expect(writeText).toHaveBeenCalledWith(SHARED_URL)
    expect(feedback(wrapper).attributes('role')).toBe('status')
    expect(feedback(wrapper).attributes('aria-live')).toBe('polite')
    expect(feedback(wrapper).text()).toBe('Lien copié')
  })

  it('« Lien copié » disparaît après quelques secondes', async () => {
    vi.useFakeTimers()
    const wrapper = mountShare()
    await clickShare(wrapper)
    expect(feedback(wrapper).text()).toBe('Lien copié')

    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(feedback(wrapper).text()).toBe('')
  })

  it('la région d\'annonce est présente avant le clic (annonce garantie)', () => {
    const region = feedback(mountShare())
    expect(region.attributes('role')).toBe('status')
    expect(region.text()).toBe('')
  })

  it('échec du presse-papier : champ en lecture seule avec le lien, sélectionné', async () => {
    writeText.mockRejectedValue(new DOMException('Refusé', 'NotAllowedError'))
    const wrapper = mountShare()
    await clickShare(wrapper)
    await nextTick()

    const input = wrapper.get<HTMLInputElement>('input')
    expect(input.element.value).toBe(SHARED_URL)
    expect(input.attributes('readonly')).toBeDefined()
    expect(wrapper.get(`label[for="${input.attributes('id')}"]`).text()).toContain('copiez ce lien')
    // Texte entièrement sélectionné (`select()` ; Chrome y met aussi le focus, pas happy-dom).
    expect(input.element.selectionStart).toBe(0)
    expect(input.element.selectionEnd).toBe(SHARED_URL.length)
    expect(feedback(wrapper).text()).toBe('')
  })

  it('presse-papier absent : champ manuel aussi', async () => {
    setNavigator('clipboard', undefined)
    const wrapper = mountShare()
    await clickShare(wrapper)
    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe(SHARED_URL)
  })

  it('Échap dans le champ manuel : le referme sans fermer la fiche', async () => {
    writeText.mockRejectedValue(new Error('refus'))
    const wrapper = mountShare()
    await clickShare(wrapper)

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    wrapper.get('input').element.dispatchEvent(event)
    await nextTick()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('changement de lieu : le message précédent disparaît', async () => {
    const wrapper = mountShare()
    await clickShare(wrapper)
    await wrapper.setProps({ place: { id: 'osm:way:2002', name: 'Parc Monceau' } })
    expect(feedback(wrapper).text()).toBe('')
  })
})
