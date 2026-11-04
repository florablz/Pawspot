import type * as Leaflet from 'leaflet'
import type { MapInsets, MapView, PawspotMapApi } from '~/types/map'

/**
 * Déplacements de la carte exposés par `PawspotMap` (tout sauf le focus des
 * marqueurs). `getMap` / `getLib` renvoient `null` tant que Leaflet n'est pas chargé.
 */
export function createMapNavigation(
  getMap: () => Leaflet.Map | null,
  getLib: () => typeof Leaflet | null,
): Omit<PawspotMapApi, 'focusMarker' | 'focusFirstMarker'> {
  const reducedMotion = () => matchesMedia(REDUCED_MOTION_QUERY)

  function getView(): MapView | null {
    const map = getMap()
    if (!map) return null
    const c = map.getCenter()
    return {
      center: { lat: c.lat, lng: c.lng },
      zoom: Math.round(map.getZoom()),
      bbox: map.getBounds().toBBoxString(),
    }
  }

  /** Zone visible hors marges, en pixels du conteneur. */
  function visibleBounds(map: Leaflet.Map, L: typeof Leaflet, insets: MapInsets): Leaflet.Bounds {
    const size = map.getSize()
    return L.bounds([0, 0], [Math.max(0, size.x - insets.right), Math.max(0, size.y - insets.bottom)])
  }

  return {
    getView,
    flyTo(lat, lng, zoom) {
      const map = getMap()
      if (!map) return false
      if (reducedMotion()) map.setView([lat, lng], zoom ?? map.getZoom(), { animate: false })
      else map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.8 })
      return true
    },
    isVisible(lat, lng, insets) {
      const map = getMap()
      const L = getLib()
      if (!map || !L) return false
      return visibleBounds(map, L, insets).contains(map.latLngToContainerPoint([lat, lng]))
    },
    reveal(lat, lng, insets, zoom) {
      const map = getMap()
      if (!map) return false
      const animate = !reducedMotion()
      if (zoom == null) {
        map.panInside([lat, lng], {
          paddingTopLeft: [24, 140],
          paddingBottomRight: [insets.right + 24, insets.bottom + 24],
          animate,
        })
        return true
      }
      // Centre décalé : le lieu apparaît au milieu de la zone non couverte par la fiche.
      const point = map.project([lat, lng], zoom).add([insets.right / 2, insets.bottom / 2])
      map.setView(map.unproject(point, zoom), zoom, { animate })
      return true
    },
    showArea(area, insets) {
      const map = getMap()
      const L = getLib()
      if (!map || !L) return false
      const animate = !reducedMotion()
      // Barres du haut (recherche + filtres) ≈ 140 px, barre d'état en bas ≈ 80 px.
      const topLeft = L.point(16, 140)
      const bottomRight = L.point(insets.right + 16, insets.bottom + 80)
      let zoom = area.maxZoom
      let center = L.latLng(area.lat, area.lng)
      if (area.bbox) {
        const bounds = L.latLngBounds([area.bbox.minLat, area.bbox.minLon], [area.bbox.maxLat, area.bbox.maxLon])
        zoom = Math.min(map.getBoundsZoom(bounds, false, topLeft.add(bottomRight)), area.maxZoom)
        if (zoom >= area.minZoom) center = bounds.getCenter()
      }
      zoom = Math.max(Math.min(zoom, map.getMaxZoom()), area.minZoom)
      // Centre décalé : la zone apparaît au milieu de la partie non couverte.
      const offset = topLeft.subtract(bottomRight).divideBy(2)
      const target = map.unproject(map.project(center, zoom).subtract(offset), zoom)
      if (animate) map.flyTo(target, zoom, { duration: 0.8 })
      else map.setView(target, zoom, { animate: false })
      return true
    },
  }
}
