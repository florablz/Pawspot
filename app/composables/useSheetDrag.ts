/** Déplacement (px) au-delà duquel un appui devient un glisser (et non un clic). */
const DRAG_THRESHOLD = 8

export interface SheetDragOptions {
  /** Le glisser est-il possible maintenant (ex. faux sur desktop) ? */
  enabled: () => boolean
  /** Fin du glisser : `dy` (px, positif vers le bas) et vitesse finale (px/ms). */
  onRelease: (dy: number, velocity: number) => void
}

/**
 * Glisser vertical d'un panneau au doigt ou à la souris (pointer events), sans
 * dépendance. Un appui qui ne bouge pas reste un clic normal ; après un vrai
 * glisser, le clic qui suit est ignoré (pas de bouton déclenché par erreur).
 */
export function useSheetDrag(options: SheetDragOptions) {
  const dragY = ref(0)
  const dragging = ref(false)

  let pointerId: number | null = null
  let startY = 0
  let lastY = 0
  let lastT = 0
  let velocity = 0

  function swallowNextClick() {
    const stop = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('click', stop, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0)
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    const dy = e.clientY - startY
    if (!dragging.value) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return
      dragging.value = true
    }
    const dt = e.timeStamp - lastT
    if (dt > 0) velocity = (e.clientY - lastY) / dt
    lastY = e.clientY
    lastT = e.timeStamp
    dragY.value = dy
  }

  function stopListening() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    pointerId = null
  }

  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    stopListening()
    if (dragging.value) {
      swallowNextClick()
      options.onRelease(dragY.value, velocity)
    }
    dragging.value = false
    dragY.value = 0
  }

  function onCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    stopListening()
    dragging.value = false
    dragY.value = 0
  }

  function onPointerDown(e: PointerEvent) {
    if (pointerId !== null || !options.enabled()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointerId = e.pointerId
    startY = lastY = e.clientY
    lastT = e.timeStamp
    velocity = 0
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  onBeforeUnmount(stopListening)

  return { dragY, dragging, onPointerDown }
}
