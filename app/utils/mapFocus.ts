/**
 * Ordre de tabulation des marqueurs et des bulles de la carte : seuls ceux
 * réellement visibles (dans la carte, hors des bandeaux posés dessus) restent
 * atteignables au clavier (`tabindex="0"`), les autres passent à `-1`.
 */

/** Attribut des bandeaux posés sur la carte (barre du haut, filtres, barre d'état, fiche). */
export const MAP_OVERLAY_ATTR = 'data-map-overlay'

/** Marge (px) au bord de la carte : un marqueur à moitié sorti de l'écran n'est pas proposé. */
const EDGE_MARGIN = 16

/** Marqueurs et bulles focusables (Leaflet leur pose `role="button"`). */
const MARKER_SELECTOR = '.leaflet-marker-pane [role="button"]'

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/** Rectangles des bandeaux affichés (ceux masqués ont une taille nulle) et des contrôles Leaflet. */
function overlayBoxes(container: HTMLElement): Box[] {
  const els = [
    ...document.querySelectorAll<HTMLElement>(`[${MAP_OVERLAY_ATTR}]`),
    ...container.querySelectorAll<HTMLElement>('.leaflet-control'),
  ]
  return els.map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
}

/** Le centre de l'élément est-il visible sur la carte (dedans et hors des bandeaux) ? */
export function isMarkerReachable(rect: Box, map: Box, overlays: readonly Box[]): boolean {
  const x = (rect.left + rect.right) / 2
  const y = (rect.top + rect.bottom) / 2
  const inner = { left: map.left + EDGE_MARGIN, top: map.top + EDGE_MARGIN, right: map.right - EDGE_MARGIN, bottom: map.bottom - EDGE_MARGIN }
  return contains(inner, x, y) && !overlays.some(o => contains(o, x, y))
}

/**
 * Recalcule les `tabindex` et renvoie les éléments atteignables, triés en
 * ordre de lecture (haut en bas, puis gauche à droite).
 */
export function updateMarkerTabOrder(container: HTMLElement): HTMLElement[] {
  const map = container.getBoundingClientRect()
  const overlays = overlayBoxes(container)
  const reachable: { el: HTMLElement, rect: DOMRect }[] = []
  for (const el of container.querySelectorAll<HTMLElement>(MARKER_SELECTOR)) {
    const rect = el.getBoundingClientRect()
    const ok = isMarkerReachable(rect, map, overlays)
    el.tabIndex = ok ? 0 : -1
    if (ok) reachable.push({ el, rect })
  }
  return sortByReadingOrder(reachable).map(r => r.el)
}

/** Haut en bas (par rangées de 24 px), puis gauche à droite. */
export function sortByReadingOrder<T extends { rect: Box }>(items: T[]): T[] {
  const row = (b: Box) => Math.round((b.top + b.bottom) / 2 / 24)
  return [...items].sort((a, b) => row(a.rect) - row(b.rect) || a.rect.left - b.rect.left)
}
