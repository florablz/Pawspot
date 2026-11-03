/**
 * Liens « Itinéraire » vers les applications de navigation (§3.5, point 7).
 * Liens universels : ils ouvrent l'application si elle est installée, sinon le
 * site. Seule la destination y figure : la position de l'utilisateur n'est
 * jamais transmise (l'application d'itinéraire la demande elle-même).
 */

export type ItineraryApp = 'google' | 'apple' | 'waze'

export type ItineraryPlatform = 'apple' | 'android' | 'other'

export interface ItineraryDestination {
  name: string
  lat: number
  lon: number
}

export const ITINERARY_APP_LABELS: Record<ItineraryApp, string> = {
  google: 'Google Maps',
  apple: 'Apple Plans',
  waze: 'Waze',
}

/** Coordonnée bornée à 6 décimales (≈ 10 cm), sans notation exponentielle. */
function coord(value: number): string {
  return String(Math.round(value * 1e6) / 1e6)
}

export function itineraryUrl(app: ItineraryApp, place: ItineraryDestination): string {
  const ll = `${coord(place.lat)},${coord(place.lon)}`
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${ll}`
    case 'apple':
      return `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(place.name)}`
    case 'waze':
      return `https://waze.com/ul?ll=${ll}&navigate=yes`
  }
}

/**
 * Plateforme d'après le navigateur : iPhone, iPad (y compris iPadOS qui se
 * présente comme un Mac tactile) et macOS → `apple` ; Android → `android`.
 */
export function detectItineraryPlatform(userAgent: string, platform = ''): ItineraryPlatform {
  if (/android/i.test(userAgent)) return 'android'
  if (/iphone|ipad|ipod|macintosh|mac os x/i.test(userAgent) || /^(mac|iphone|ipad|ipod)/i.test(platform)) return 'apple'
  return 'other'
}

/** Ordre des choix : l'application native de l'appareil en premier. */
export function itineraryApps(platform: ItineraryPlatform): ItineraryApp[] {
  if (platform === 'apple') return ['apple', 'google', 'waze']
  return ['google', 'waze', 'apple']
}
