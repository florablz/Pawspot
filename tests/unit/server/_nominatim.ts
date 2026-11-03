/**
 * Résultats attendus de la fixture Nominatim `tests/fixtures/nominatim/lyon.json`
 * (partagés par les tests de server/utils/nominatim.ts et de GET /api/geocode).
 */
import type { GeocodeResult } from '../../../shared/types'

/** Résultats attendus de la fixture `lyon.json` (nœud « Lyon » en double et Kerguelen retirés). */
export const LYON_RESULTS: GeocodeResult[] = [
  {
    label: 'Lyon (69)', lat: 45.7578137, lon: 4.8320114, type: 'city', city: 'Lyon',
    bbox: { minLon: 4.7718134, minLat: 45.7073666, maxLon: 4.8983774, maxLat: 45.8082628 },
  },
  {
    label: 'Rue de Lyon, 75012 Paris', lat: 48.8468417, lon: 2.3720371, type: 'street', postcode: '75012', city: 'Paris',
    bbox: { minLon: 2.3693408, minLat: 48.8443561, maxLon: 2.3738935, maxLat: 48.8496427 },
  },
  {
    label: 'Gare de Lyon, 75012 Paris', lat: 48.8443038, lon: 2.3743773, type: 'place', postcode: '75012', city: 'Paris',
    bbox: { minLon: 2.3743273, minLat: 48.8442538, maxLon: 2.3744273, maxLat: 48.8443538 },
  },
  {
    label: 'Lyons-la-Forêt (27)', lat: 49.3989893, lon: 1.4760853, type: 'city', postcode: '27480', city: 'Lyons-la-Forêt',
    bbox: { minLon: 1.4302318, minLat: 49.3685471, maxLon: 1.5397563, maxLat: 49.4422373 },
  },
]
