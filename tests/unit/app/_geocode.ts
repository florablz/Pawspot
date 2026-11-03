/**
 * Réponses de `GET /api/geocode` (format déjà converti par le serveur) lues dans
 * `tests/fixtures/geocode/*.json`. Le JSON type `type` en `string` : on le
 * ramène au contrat `GeocodeResponse` de shared/types.ts.
 */
import type { GeocodeResponse, GeocodeResult, GeocodeResultType } from '#shared/types'
import lyonJson from '../../fixtures/geocode/lyon.json'
import rivoliJson from '../../fixtures/geocode/rivoli.json'
import typesJson from '../../fixtures/geocode/types.json'

export const GEOCODE_LYON = lyonJson as GeocodeResponse
export const GEOCODE_RIVOLI = rivoliJson as GeocodeResponse
/** Un résultat de chaque type (adresse, lieu nommé, rue, code postal, ville, région). */
export const GEOCODE_TYPES = typesJson as GeocodeResponse

export function geocodeOfType(type: GeocodeResultType): GeocodeResult {
  return GEOCODE_TYPES.results.find(r => r.type === type)!
}
