import type * as Leaflet from 'leaflet'

/** Délai au-delà duquel on renonce à suivre le focus d'une bulle ouverte au clavier (ms). */
const PENDING_FOCUS_MS = 2500

export interface MapKeyboardOptions {
  map: Leaflet.Map
  container: HTMLElement
  clusterLayer: Leaflet.MarkerClusterGroup
}

export interface MapKeyboard {
  /** Recalcule l'ordre de tabulation (au prochain affichage). */
  refresh: () => void
  /** Focus sur le premier marqueur ou la première bulle visible ; faux s'il n'y en a pas. */
  focusFirst: () => boolean
  dispose: () => void
}

/**
 * Clavier sur la carte : ordre de tabulation limité aux marqueurs visibles,
 * et Entrée / Espace sur une bulle (zoom puis focus sur un lieu issu du groupe).
 */
export function setupMapKeyboard({ map, container, clusterLayer }: MapKeyboardOptions): MapKeyboard {
  let frame = 0
  /** Bulle ouverte au clavier : marqueurs à suivre et élément de la bulle d'origine. */
  let pending: { markers: Leaflet.Marker[], from: HTMLElement | null, until: number } | null = null

  function focusPending(reachable: HTMLElement[]) {
    if (!pending) return
    if (Date.now() > pending.until) {
      pending = null
      return
    }
    const targets = new Set<HTMLElement>()
    for (const marker of pending.markers) {
      const shown = marker.getElement() ? marker : clusterLayer.getVisibleParent(marker)
      const el = shown?.getElement()
      if (el) targets.add(el)
    }
    // La bulle d'origine encore affichée : le regroupement n'est pas encore recalculé.
    const next = reachable.find(el => targets.has(el) && el !== pending!.from)
    if (!next) return
    pending = null
    next.focus({ preventScroll: true })
  }

  function update(): HTMLElement[] {
    const reachable = updateMarkerTabOrder(container)
    focusPending(reachable)
    return reachable
  }

  function refresh() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => update())
  }

  /** Juste avant que Tab ne déplace le focus : l'ordre est à jour même si la fiche ou les barres ont bougé. */
  function onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') update()
  }

  function followCluster(event: Leaflet.LeafletEvent) {
    const cluster = (event as Leaflet.LeafletEvent & { layer: Leaflet.MarkerCluster }).layer
    pending = { markers: cluster.getAllChildMarkers(), from: cluster.getElement() ?? null, until: Date.now() + PENDING_FOCUS_MS }
  }

  function onClusterKeypress(event: Leaflet.LeafletEvent) {
    const key = (event as Leaflet.LeafletKeyboardEvent).originalEvent
    // Entrée : le greffon zoome lui-même sur la bulle.
    if (key?.key === 'Enter') followCluster(event)
  }

  function onClusterKeydown(event: Leaflet.LeafletEvent) {
    const key = (event as Leaflet.LeafletKeyboardEvent).originalEvent
    if (key?.key !== ' ') return
    // Espace : pas de défilement de la page, même zoom que pour Entrée.
    key.preventDefault()
    followCluster(event)
    ;(event as Leaflet.LeafletEvent & { layer: Leaflet.MarkerCluster }).layer.zoomToBounds()
  }

  map.on('moveend', refresh)
  clusterLayer.on('animationend', refresh)
  clusterLayer.on('clusterkeypress', onClusterKeypress)
  clusterLayer.on('clusterkeydown', onClusterKeydown)
  document.addEventListener('keydown', onDocumentKeydown, true)

  return {
    refresh,
    focusFirst() {
      const first = update()[0]
      if (!first) return false
      first.focus({ preventScroll: true })
      return true
    },
    dispose() {
      cancelAnimationFrame(frame)
      map.off('moveend', refresh)
      clusterLayer.off('animationend', refresh)
      clusterLayer.off('clusterkeypress', onClusterKeypress)
      clusterLayer.off('clusterkeydown', onClusterKeydown)
      document.removeEventListener('keydown', onDocumentKeydown, true)
    },
  }
}
