import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SheetSnap } from '~/composables/usePlaceSheet'
import { useSheetDrag } from '~/composables/useSheetDrag'
import { DESKTOP_QUERY } from '~/composables/useMediaQuery'
import PlaceHeader from '~/components/place/PlaceHeader.vue'
import PlaceSheet from '~/components/place/PlaceSheet.vue'
import { makePlace } from '../_helpers'
import { dragOnWindow, pointer } from '../_pointer'

const snap = ref<SheetSnap>('peek')
const peekHeight = ref<number | null>(null)
const isDesktop = ref(false)

// Auto-imports Nuxt du script (dont `useSheetDrag` réel) ; `usePlaceSheet` réduit à son état.
beforeEach(() => {
  snap.value = 'peek'
  peekHeight.value = null
  isDesktop.value = false
  for (const [name, fn] of Object.entries({ ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useSheetDrag })) {
    vi.stubGlobal(name, fn)
  }
  vi.stubGlobal('DESKTOP_QUERY', DESKTOP_QUERY)
  vi.stubGlobal('useId', () => 'fiche-titre')
  vi.stubGlobal('useMediaQuery', () => isDesktop)
  vi.stubGlobal('usePlaceSheet', () => ({ snap, peekHeight }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

/** Contenu de la fiche remplacé par un bouton (cible de focus et de clavier). */
const DetailsStub = defineComponent({
  props: { embedded: Boolean },
  setup: props => () => h('button', { 'type': 'button', 'data-testid': 'details-content', 'data-embedded': String(props.embedded) }, 'Voir les avis'),
})

const PLACE = makePlace({ id: 'osm:node:1', name: 'Parc de la Tête d\'Or' })

function mountSheet(place = PLACE) {
  return mount(PlaceSheet, {
    props: { place, origin: null },
    attachTo: document.body,
    global: {
      components: { PlaceHeader },
      stubs: { PlaceDetails: DetailsStub, PlaceFavoriteButton: true, PlaceDogStatusBadge: true, PlaceItineraryLink: true },
    },
  })
}

type Wrapper = ReturnType<typeof mountSheet>

/** Glisser vertical : appui sur `target`, puis mouvements `[y, t]` sur la fenêtre. */
function drag(target: Element, steps: Array<[number, number]>) {
  target.dispatchEvent(pointer('pointerdown', { y: 400, t: 0 }))
  dragOnWindow(steps.map(([dy, t]) => [400 + dy, t]))
}

const sheetEl = (w: Wrapper) => w.get('[data-testid="place-sheet"]')
/** Partie fixe (poignée + en-tête) : zone de glisser quand la fiche est dépliée. */
const headerEl = (w: Wrapper) => w.get('[data-testid="sheet-handle"]').element.parentElement!

describe('PlaceSheet — accessibilité', () => {
  it('région nommée par le titre du lieu (aria-labelledby)', () => {
    const wrapper = mountSheet()
    const title = wrapper.get('h2')
    expect(title.attributes('id')).toBe('fiche-titre')
    expect(sheetEl(wrapper).attributes('aria-labelledby')).toBe('fiche-titre')
    expect(title.text()).toBe('Parc de la Tête d\'Or')
  })

  it('donne le focus au titre à l\'ouverture', async () => {
    const wrapper = mountSheet()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('h2').element)
  })

  it('Échap ferme la fiche', async () => {
    const wrapper = mountSheet()
    await sheetEl(wrapper).trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('Échap déjà traité par un élément intérieur ne ferme pas la fiche', () => {
    const wrapper = mountSheet()
    const inner = wrapper.get('[data-testid="details-content"]').element
    inner.addEventListener('keydown', e => e.preventDefault())
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('une autre touche ne ferme pas la fiche', async () => {
    const wrapper = mountSheet()
    await sheetEl(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('le bouton « Fermer la fiche » ferme', async () => {
    const wrapper = mountSheet()
    await wrapper.get('[data-testid="sheet-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('PlaceSheet — aperçu et fiche dépliée (mobile)', () => {
  it('s\'ouvre en aperçu', () => {
    expect(sheetEl(mountSheet()).attributes('data-snap')).toBe('peek')
  })

  it('la poignée bascule entre aperçu et fiche dépliée', async () => {
    const wrapper = mountSheet()
    const handle = wrapper.get('[data-testid="sheet-handle"]')
    expect(handle.attributes('aria-expanded')).toBe('false')
    expect(handle.attributes('aria-label')).toBe('Agrandir la fiche')

    await handle.trigger('click')
    expect(sheetEl(wrapper).attributes('data-snap')).toBe('full')
    expect(handle.attributes('aria-expanded')).toBe('true')
    expect(handle.attributes('aria-label')).toBe('Réduire la fiche')

    await handle.trigger('click')
    expect(sheetEl(wrapper).attributes('data-snap')).toBe('peek')
  })

  it('« Plus d\'infos » déplie, puis devient « Réduire »', async () => {
    const wrapper = mountSheet()
    const more = wrapper.findAll('button').find(b => b.text() === 'Plus d\'infos')!
    await more.trigger('click')
    expect(snap.value).toBe('full')
    expect(more.text()).toBe('Réduire')
  })

  it('le focus clavier entrant dans le contenu caché de l\'aperçu déplie la fiche', async () => {
    const wrapper = mountSheet()
    ;(wrapper.get('[data-testid="details-content"]').element as HTMLElement).focus()
    await nextTick()
    expect(sheetEl(wrapper).attributes('data-snap')).toBe('full')
  })

  it('le focus dans la partie fixe (en-tête) ne déplie pas', async () => {
    const wrapper = mountSheet()
    ;(wrapper.get('[data-testid="sheet-close"]').element as HTMLElement).focus()
    await nextTick()
    expect(snap.value).toBe('peek')
  })

  it('revient en aperçu quand un autre lieu est affiché', async () => {
    const wrapper = mountSheet()
    snap.value = 'full'
    await wrapper.setProps({ place: makePlace({ id: 'osm:node:2', name: 'Café des Chiens' }) })
    expect(snap.value).toBe('peek')
  })

  it('le contenu est affiché en mode embarqué (sans en-tête ni itinéraire en double)', () => {
    expect(mountSheet().get('[data-testid="details-content"]').attributes('data-embedded')).toBe('true')
  })
})

describe('PlaceSheet — glisser (mobile)', () => {
  it('aperçu : glisser franchement vers le haut déplie', async () => {
    const wrapper = mountSheet()
    drag(sheetEl(wrapper).element, [[-40, 400], [-90, 800]])
    await nextTick()
    expect(snap.value).toBe('full')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('aperçu : glisser franchement vers le bas ferme', () => {
    const wrapper = mountSheet()
    drag(sheetEl(wrapper).element, [[40, 400], [90, 800]])
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(snap.value).toBe('peek')
  })

  it('un glisser lent de 80 px ou moins ne change rien', () => {
    const wrapper = mountSheet()
    drag(sheetEl(wrapper).element, [[40, 400], [80, 800]])
    drag(sheetEl(wrapper).element, [[-40, 400], [-80, 800]])
    expect(snap.value).toBe('peek')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('un geste rapide vers le haut déplie même sur une courte distance', () => {
    const wrapper = mountSheet()
    // 30 px en 30 ms : 1 px/ms (> 0,5)
    drag(sheetEl(wrapper).element, [[-30, 30]])
    expect(snap.value).toBe('full')
  })

  it('un geste rapide vers le bas ferme l\'aperçu', () => {
    const wrapper = mountSheet()
    drag(sheetEl(wrapper).element, [[30, 30]])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('une vitesse de 0,5 px/ms pile n\'est pas un geste rapide', () => {
    const wrapper = mountSheet()
    // Dernier mouvement : 20 px en 40 ms
    drag(sheetEl(wrapper).element, [[20, 100], [40, 140]])
    expect(snap.value).toBe('peek')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('dépliée : glisser vers le bas réduit d\'abord, un second glisser ferme', async () => {
    const wrapper = mountSheet()
    snap.value = 'full'
    await nextTick()
    drag(headerEl(wrapper), [[50, 400], [120, 800]])
    await nextTick()
    expect(snap.value).toBe('peek')
    expect(wrapper.emitted('close')).toBeUndefined()

    drag(sheetEl(wrapper).element, [[50, 400], [120, 800]])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('dépliée : glisser vers le haut ne change rien', async () => {
    const wrapper = mountSheet()
    snap.value = 'full'
    await nextTick()
    drag(headerEl(wrapper), [[-150, 400]])
    expect(snap.value).toBe('full')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('dépliée : glisser dans le contenu fait défiler, sans déplacer la fiche', async () => {
    const wrapper = mountSheet()
    snap.value = 'full'
    await nextTick()
    drag(wrapper.get('[data-testid="details-content"]').element, [[150, 400]])
    expect(snap.value).toBe('full')
  })
})

describe('PlaceSheet — desktop (panneau latéral)', () => {
  it('pas de glisser, et le focus dans le contenu ne change pas la hauteur', async () => {
    isDesktop.value = true
    const wrapper = mountSheet()
    drag(sheetEl(wrapper).element, [[150, 400]])
    expect(wrapper.emitted('close')).toBeUndefined()
    ;(wrapper.get('[data-testid="details-content"]').element as HTMLElement).focus()
    await nextTick()
    expect(snap.value).toBe('peek')
  })

  it('Échap ferme aussi le panneau', async () => {
    isDesktop.value = true
    const wrapper = mountSheet()
    await sheetEl(wrapper).trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
