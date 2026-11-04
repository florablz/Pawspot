/**
 * Choix du fournisseur de géocodage du proxy `GET /api/geocode?q=`, par la
 * variable `GEOCODER` (lue à chaque appel) :
 * - `photon` (défaut) : Photon, conçu pour la recherche pendant la frappe
 *   (`PHOTON_URL`, voir server/utils/photon.ts) ;
 * - `nominatim` : Nominatim (`NOMINATIM_URL`, voir server/utils/nominatim.ts). La
 *   politique de l'instance publique de l'OSMF interdit l'autocomplétion : à
 *   réserver à une instance qui l'autorise.
 * Valeur absente, vide ou inconnue : `photon`.
 *
 * Les deux fournisseurs partagent la même file « 1 requête/s », le même délai et
 * les mêmes erreurs (server/utils/geocoding/core.ts).
 */
import type { GeocodeResult } from '../../shared/types'
import type { GeocoderDeps } from './geocoding/core'
import { searchNominatim } from './nominatim'
import { searchPhoton } from './photon'

export const GEOCODERS = ['photon', 'nominatim'] as const
export type Geocoder = (typeof GEOCODERS)[number]
export const DEFAULT_GEOCODER: Geocoder = 'photon'

/** Fournisseur configuré (`GEOCODER`, insensible à la casse), `photon` par défaut. */
export function configuredGeocoder(env: Record<string, string | undefined> = process.env): Geocoder {
  const value = env.GEOCODER?.trim().toLowerCase()
  return (GEOCODERS as readonly string[]).includes(value ?? '') ? value as Geocoder : DEFAULT_GEOCODER
}

/** Nom lisible du fournisseur (journaux serveur uniquement). */
export function geocoderName(geocoder: Geocoder): string {
  return geocoder === 'nominatim' ? 'Nominatim' : 'Photon'
}

/**
 * Recherche auprès du fournisseur configuré (sans cache : voir la route). La
 * chaîne envoyée est `normalizeGeocodeQuery(query)`.
 * @throws GeocodeServiceError si la file est pleine ou si le fournisseur échoue.
 */
export function searchGeocoder(query: string, deps: GeocoderDeps & { geocoder?: Geocoder } = {}): Promise<GeocodeResult[]> {
  const geocoder = deps.geocoder ?? configuredGeocoder()
  return geocoder === 'nominatim' ? searchNominatim(query, deps) : searchPhoton(query, deps)
}
