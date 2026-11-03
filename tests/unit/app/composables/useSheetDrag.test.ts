import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onBeforeUnmount, ref } from 'vue'
import { useSheetDrag } from '~/composables/useSheetDrag'
import { dragOnWindow, pointer } from '../_pointer'

beforeEach(() => {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Bouton glissable : l'appui démarre le glisser, le clic est compté. */
function setup(enabled = true) {
  const onRelease = vi.fn<(dy: number, velocity: number) => void>()
  const onClick = vi.fn()
  let api!: ReturnType<typeof useSheetDrag>
  const Comp = defineComponent({
    setup() {
      api = useSheetDrag({ enabled: () => enabled, onRelease })
      return () => h('button', { onPointerdown: api.onPointerDown, onClick }, 'Fiche')
    },
  })
  const wrapper = mount(Comp, { attachTo: document.body })
  const press = (y = 300, t = 0, init: { id?: number, pointerType?: 'touch' | 'mouse', button?: number } = {}) =>
    wrapper.element.dispatchEvent(pointer('pointerdown', { y, t, ...init }))
  const click = () => (wrapper.element as HTMLButtonElement).click()
  return { wrapper, api, onRelease, onClick, press, click }
}

describe('useSheetDrag', () => {
  it('un appui court sans mouvement reste un clic', () => {
    const { press, click, onRelease, onClick, api, wrapper } = setup()
    press(300, 0)
    dragOnWindow([[303, 50]])
    click()
    expect(onRelease).not.toHaveBeenCalled()
    expect(api.dragging.value).toBe(false)
    expect(onClick).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('en dessous de 8 px, ce n\'est pas un glisser', () => {
    const { press, onRelease, api, wrapper } = setup()
    press(300, 0)
    window.dispatchEvent(pointer('pointermove', { y: 307, t: 20 }))
    expect(api.dragging.value).toBe(false)
    expect(api.dragY.value).toBe(0)
    window.dispatchEvent(pointer('pointermove', { y: 308, t: 40 }))
    expect(api.dragging.value).toBe(true)
    expect(api.dragY.value).toBe(8)
    window.dispatchEvent(pointer('pointerup', { y: 308, t: 40 }))
    expect(onRelease).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('suit le doigt puis remet le décalage à zéro au relâché', () => {
    const { press, onRelease, api, wrapper } = setup()
    press(300, 0)
    window.dispatchEvent(pointer('pointermove', { y: 350, t: 100 }))
    expect(api.dragY.value).toBe(50)
    window.dispatchEvent(pointer('pointermove', { y: 250, t: 200 }))
    expect(api.dragY.value).toBe(-50)
    window.dispatchEvent(pointer('pointerup', { y: 250, t: 200 }))
    expect(onRelease).toHaveBeenCalledWith(-50, -1)
    expect(api.dragY.value).toBe(0)
    expect(api.dragging.value).toBe(false)
    wrapper.unmount()
  })

  it('transmet la vitesse du dernier mouvement (px/ms)', () => {
    const { press, onRelease, wrapper } = setup()
    press(300, 0)
    dragOnWindow([[320, 100], [380, 120]])
    const [dy, velocity] = onRelease.mock.calls[0]!
    expect(dy).toBe(80)
    expect(velocity).toBeCloseTo(3)
    wrapper.unmount()
  })

  it('ignore le clic qui suit un glisser, puis laisse passer les suivants', () => {
    vi.useFakeTimers()
    const { press, click, onClick, wrapper } = setup()
    press(300, 0)
    dragOnWindow([[400, 100]])
    click()
    expect(onClick).not.toHaveBeenCalled()
    vi.runAllTimers()
    click()
    expect(onClick).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('après un glisser sans clic, le prochain clic n\'est pas avalé', () => {
    vi.useFakeTimers()
    const { press, click, onClick, wrapper } = setup()
    press(300, 0)
    dragOnWindow([[400, 100]])
    vi.runAllTimers()
    click()
    expect(onClick).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('pointercancel annule le glisser sans appeler onRelease', () => {
    const { press, onRelease, api, wrapper } = setup()
    press(300, 0)
    window.dispatchEvent(pointer('pointermove', { y: 400, t: 100 }))
    window.dispatchEvent(pointer('pointercancel', { y: 400, t: 100 }))
    expect(onRelease).not.toHaveBeenCalled()
    expect(api.dragY.value).toBe(0)
    window.dispatchEvent(pointer('pointerup', { y: 400, t: 120 }))
    expect(onRelease).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignore les autres pointeurs (second doigt) pendant un glisser', () => {
    const { press, onRelease, api, wrapper } = setup()
    press(300, 0, { id: 1 })
    press(100, 0, { id: 2 })
    window.dispatchEvent(pointer('pointermove', { y: 500, t: 50, id: 2 }))
    expect(api.dragging.value).toBe(false)
    window.dispatchEvent(pointer('pointerup', { y: 500, t: 50, id: 2 }))
    expect(onRelease).not.toHaveBeenCalled()
    dragOnWindow([[350, 100]], 1)
    expect(onRelease).toHaveBeenCalledWith(50, expect.any(Number))
    wrapper.unmount()
  })

  it('désactivé (desktop) : aucun glisser', () => {
    const { press, onRelease, wrapper } = setup(false)
    press(300, 0)
    dragOnWindow([[500, 100]])
    expect(onRelease).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('souris : seul le bouton principal démarre un glisser', () => {
    const { press, onRelease, wrapper } = setup()
    press(300, 0, { pointerType: 'mouse', button: 2 })
    dragOnWindow([[500, 100]])
    expect(onRelease).not.toHaveBeenCalled()
    press(300, 200, { pointerType: 'mouse', button: 0 })
    dragOnWindow([[500, 300]])
    expect(onRelease).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('retire ses écouteurs au démontage en plein glisser', () => {
    const { press, onRelease, wrapper } = setup()
    press(300, 0)
    window.dispatchEvent(pointer('pointermove', { y: 400, t: 50 }))
    wrapper.unmount()
    window.dispatchEvent(pointer('pointerup', { y: 400, t: 60 }))
    expect(onRelease).not.toHaveBeenCalled()
  })
})
