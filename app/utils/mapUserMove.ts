import type * as Leaflet from 'leaflet'

/** Touches de déplacement de la carte au clavier (gestionnaire `keyboard` de Leaflet). */
const MAP_MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', '_'])

/**
 * Appelle `onUserMove` quand l'utilisateur déplace ou zoome la carte lui-même
 * (glisser, molette, double-clic, pincement, boutons de zoom, flèches, bulle
 * ouverte), jamais pour un déplacement fait par l'application (`flyTo`…).
 * Renvoie la fonction qui retire les écouteurs.
 */
export function watchUserMoves(
  map: Leaflet.Map,
  container: HTMLElement,
  clusterLayer: Leaflet.MarkerClusterGroup,
  onUserMove: () => void,
): () => void {
  const moved = () => onUserMove()

  function onKeydown(event: KeyboardEvent) {
    if (event.target === container && MAP_MOVE_KEYS.has(event.key)) onUserMove()
  }

  function onClick(event: MouseEvent) {
    if ((event.target as HTMLElement | null)?.closest('.leaflet-control-zoom')) onUserMove()
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length > 1) onUserMove()
  }

  function onClusterKeydown(event: Leaflet.LeafletEvent) {
    const key = (event as Leaflet.LeafletKeyboardEvent).originalEvent?.key
    if (key === 'Enter' || key === ' ') onUserMove()
  }

  map.on('dragstart', moved)
  clusterLayer.on('clusterclick', moved)
  clusterLayer.on('clusterkeydown', onClusterKeydown)
  container.addEventListener('wheel', moved, { passive: true })
  container.addEventListener('dblclick', moved)
  container.addEventListener('keydown', onKeydown)
  container.addEventListener('click', onClick)
  container.addEventListener('touchstart', onTouchStart, { passive: true })

  return () => {
    map.off('dragstart', moved)
    clusterLayer.off('clusterclick', moved)
    clusterLayer.off('clusterkeydown', onClusterKeydown)
    container.removeEventListener('wheel', moved)
    container.removeEventListener('dblclick', moved)
    container.removeEventListener('keydown', onKeydown)
    container.removeEventListener('click', onClick)
    container.removeEventListener('touchstart', onTouchStart)
  }
}
