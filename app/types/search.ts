import type { GeocodeResult, Place } from '#shared/types'

/** Option de la liste de suggestions : lieu PawSpot ou adresse / ville. */
export type SearchOption =
  | { kind: 'place', place: Place }
  | { kind: 'address', result: GeocodeResult }
