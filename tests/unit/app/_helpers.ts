/**
 * Outils communs aux tests app : fabrique de lieux et promesse contrôlable.
 * (Pas de suffixe `.test.ts` : Vitest ne le prend pas pour un fichier de test.)
 */
import type { Place, PlacesResponse } from '#shared/types'

/** Lieu complet et valide, surchargé au besoin. */
export function makePlace(overrides: Partial<Place> & Pick<Place, 'id' | 'name'>): Place {
  return {
    source: 'osm',
    hasName: true,
    lat: 48.8566,
    lon: 2.3522,
    category: 'park',
    dogStatus: 'unknown',
    dogStatusInfo: { source: 'none', reports: { total: 0, accepted: 0, refused: 0, inside: 0, recent: 0 } },
    osmDogPolicy: 'unknown',
    hasTerrace: false,
    status: 'active',
    verified: true,
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

/** Réponse de `GET /api/places` : drapeaux à faux par défaut. */
export function placesResponse(places: Place[], flags: Partial<Omit<PlacesResponse, 'places'>> = {}): PlacesResponse {
  return { places, stale: false, zoomTooLow: false, incomplete: false, truncated: false, ...flags }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
