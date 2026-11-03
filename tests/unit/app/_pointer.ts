/**
 * Événements pointeur simulés pour les tests de glisser (happy-dom).
 * `timeStamp` est fixé à la main : la vitesse du geste en dépend.
 */
export interface PointerInit {
  y: number
  t: number
  id?: number
  pointerType?: 'touch' | 'mouse' | 'pen'
  button?: number
}

export function pointer(type: string, { y, t, id = 1, pointerType = 'touch', button = 0 }: PointerInit): PointerEvent {
  const event = new PointerEvent(type, { clientY: y, clientX: 0, pointerId: id, pointerType, button, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: t })
  return event
}

/** Glisser complet sur `window` après l'appui : chaque étape `[y, t]`, puis relâché au dernier point. */
export function dragOnWindow(steps: Array<[number, number]>, id = 1) {
  for (const [y, t] of steps) window.dispatchEvent(pointer('pointermove', { y, t, id }))
  const [y, t] = steps.at(-1) ?? [0, 0]
  window.dispatchEvent(pointer('pointerup', { y, t, id }))
}
