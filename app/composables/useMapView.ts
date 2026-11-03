import type { MapView } from '~/types/map'

/**
 * Vue courante de la carte (centre, zoom, emprise), partagée entre la carte,
 * la fiche et la synchronisation de l'URL.
 * - `view` : dernière vue émise par la carte (fin de déplacement) ;
 * - `settled` : la carte a trouvé sa position de départ (URL, lieu ouvert ou
 *   géolocalisation aboutie / refusée) ; avant cela, la vue n'est pas recopiée
 *   dans l'URL (pas de « France entière » transitoire).
 */
export function useMapView() {
  const view = useState<MapView | null>('map-view', () => null)
  const settled = useState<boolean>('map-view-settled', () => false)
  return { view, settled }
}
