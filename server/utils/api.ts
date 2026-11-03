/**
 * Outils communs aux routes : erreurs homogènes `{ statusCode, message }` en français,
 * validation Zod des entrées (requête, paramètres de route, corps) et accès aux lieux.
 */
import { createError, getQuery, getRouterParam, readBody } from 'h3'
import type { H3Error, H3Event } from 'h3'
import type { ZodType } from 'zod'
import { placeIdSchema } from '~~/shared/schemas'
import type { Place } from '~~/shared/types'
import { ensurePlace, OverpassError } from '~~/server/services/places'

/** Libellés HTTP standard (ASCII) pour `statusMessage`, sinon h3 met « Server Error ». */
const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
}

/**
 * Erreur d'API. Le texte français passe dans `message` (et non `statusMessage`, qui
 * est réduit à l'ASCII par h3 et perdrait les accents) : le corps JSON renvoyé
 * contient `{ statusCode, message }`.
 */
export function apiError(statusCode: number, message: string): H3Error {
  return createError({ statusCode, statusMessage: STATUS_TEXT[statusCode], message })
}

/** Premier message d'une erreur Zod (déjà en français dans nos schémas). */
function firstIssueMessage(issues: readonly { message: string }[]): string {
  return issues[0]?.message || 'Données invalides'
}

/** Valide `input` avec `schema`, ou lève une erreur 400 avec le premier message Zod. */
export function parseOr400<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw apiError(400, firstIssueMessage(result.error.issues))
  return result.data
}

/** Paramètres de la query string validés (400 sinon). */
export function getValidatedQueryOr400<T>(event: H3Event, schema: ZodType<T>): T {
  return parseOr400(schema, getQuery(event))
}

/**
 * Corps JSON validé. Corps absent, vide, illisible ou qui n'est pas un objet → 400
 * (`readBody` renvoie `undefined` pour un corps vide et lève une erreur en anglais
 * pour un JSON invalide).
 */
export async function readValidatedBodyOr400<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    throw apiError(400, 'Corps de la requête illisible (JSON attendu)')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw apiError(400, 'Corps de la requête manquant ou invalide')
  }
  return parseOr400(schema, body)
}

/**
 * Identifiant de lieu lu dans un paramètre de route. Décodé : `osm:node:1` contient
 * des `:` que le client encode (`osm%3Anode%3A1`).
 */
export function getPlaceIdParam(event: H3Event, name = 'placeId'): string {
  return parseOr400(placeIdSchema, getRouterParam(event, name, { decode: true }))
}

/** Erreur 503 quand Overpass est injoignable (`OverpassError`), sinon l'erreur telle quelle. */
export function toPlacesServiceError(error: unknown): unknown {
  if (error instanceof OverpassError) {
    return apiError(503, 'Le service des lieux est momentanément indisponible, réessayez dans quelques instants.')
  }
  return error
}

/**
 * Lieu garanti en base avant d'y rattacher un favori, un avis ou une alerte.
 * Inconnu → 404 ; Overpass injoignable pour un lieu OSM pas encore en cache → 503.
 * `allowOverpass` : n'interroger Overpass pour un lieu absent de la base que pour un
 * utilisateur connecté (sinon 404 directement), pour qu'un anonyme ne puisse pas
 * déclencher un appel Overpass par id forgé.
 */
export async function requirePlace(placeId: string, options: { allowOverpass: boolean }): Promise<Place> {
  let place: Place | null
  try {
    place = await ensurePlace(placeId, {}, { allowOverpass: options.allowOverpass })
  }
  catch (error) {
    throw toPlacesServiceError(error)
  }
  if (!place || place.status === 'hidden') throw apiError(404, 'Lieu introuvable')
  return place
}
