import type { MapView } from '~/types/map'

/**
 * Vue courante de la carte (centre, zoom, emprise), partagée entre la carte,
 * la fiche et la synchronisation de l'URL.
 * - `view` : dernière vue émise par la carte (fin de déplacement) ;
 * - `settled` : la carte a trouvé sa position de départ (URL, lieu ouvert ou
 *   géolocalisation aboutie / refusée) ; avant cela, la vue n'est pas recopiée
 *   dans l'URL (pas de « France entière » transitoire) ;
 * - `centeredOnUser` : la carte est centrée sur la géolocalisation (« Me
 *   localiser ») et n'a pas encore été déplacée par l'utilisateur, une
 *   recherche ou l'ouverture d'un lieu ; la vue n'est alors pas recopiée dans
 *   l'URL (la position resterait dans un lien partagé et les journaux du serveur).
 */
export function useMapView() {
  const view = useState<MapView | null>('map-view', () => null)
  const settled = useState<boolean>('map-view-settled', () => false)
  const centeredOnUser = useState<boolean>('map-view-centered-on-user', () => false)
  return { view, settled, centeredOnUser }
}
