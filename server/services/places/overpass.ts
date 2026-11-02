/**
 * Client Overpass : requête construite depuis `shared/categories.ts`, instance
 * de secours, délai par instance, User-Agent identifiable. `fetch` injectable
 * (les tests n'appellent jamais Overpass en vrai).
 */
import { overpassStatements } from '../../../shared/categories'
import type { CategoryKey } from '../../../shared/categories'
import type { Bbox } from '../../../shared/geo'
import { PAWSPOT_USER_AGENT } from '../../utils/http'

/** Instance principale puis instance de secours. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const

/** Délai côté client, par instance. */
export const OVERPASS_TIMEOUT_MS = 25_000
/** Délai demandé au serveur Overpass (`[timeout:…]`), un peu sous le délai client. */
export const OVERPASS_SERVER_TIMEOUT_S = 23

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export interface OverpassDeps {
  fetch?: typeof fetch
  overpassEndpoints?: readonly string[]
  overpassTimeoutMs?: number
}

/** Échec sur toutes les instances. `attempts` : une ligne par instance (sans données sensibles). */
export class OverpassError extends Error {
  constructor(readonly attempts: string[]) {
    super(`Overpass indisponible (${attempts.join(' ; ')})`)
    this.name = 'OverpassError'
  }
}

function coord(n: number): string {
  return n.toFixed(6)
}

/** Requête de tous les lieux des catégories dans l'emprise (format `[bbox:sud,ouest,nord,est]`). */
export function buildOverpassBboxQuery(bbox: Bbox, categories?: readonly CategoryKey[]): string {
  const b = `${coord(bbox.minLat)},${coord(bbox.minLon)},${coord(bbox.maxLat)},${coord(bbox.maxLon)}`
  const statements = overpassStatements(categories).map(s => `  ${s}`).join('\n')
  return `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}][bbox:${b}];\n(\n${statements}\n);\nout center tags qt;`
}

/** Requête d'un seul élément OSM. */
export function buildOverpassElementQuery(type: 'node' | 'way' | 'relation', id: number): string {
  return `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];\n${type}(${Math.trunc(id)});\nout center tags;`
}

interface OverpassResponse {
  elements?: unknown
  remark?: unknown
}

function isElement(e: unknown): e is OverpassElement {
  if (!e || typeof e !== 'object') return false
  const el = e as Record<string, unknown>
  return (el.type === 'node' || el.type === 'way' || el.type === 'relation') && typeof el.id === 'number'
}

/**
 * Exécute la requête sur chaque instance jusqu'au premier succès.
 * Un `remark` contenant « runtime error » (délai ou mémoire dépassés côté Overpass,
 * résultat partiel) compte comme un échec : on ne veut pas marquer une tuile
 * comme chargée avec des données incomplètes.
 * @throws OverpassError si toutes les instances échouent.
 */
export async function runOverpassQuery(query: string, deps: OverpassDeps = {}): Promise<OverpassElement[]> {
  const doFetch = deps.fetch ?? globalThis.fetch
  const endpoints = deps.overpassEndpoints ?? OVERPASS_ENDPOINTS
  const timeoutMs = deps.overpassTimeoutMs ?? OVERPASS_TIMEOUT_MS
  const attempts: string[] = []

  for (const endpoint of endpoints) {
    const host = new URL(endpoint).host
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': PAWSPOT_USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        attempts.push(`${host}: HTTP ${response.status}`)
        continue
      }
      const data = await response.json() as OverpassResponse
      if (typeof data.remark === 'string' && /runtime error/i.test(data.remark)) {
        attempts.push(`${host}: résultat partiel`)
        continue
      }
      if (!Array.isArray(data.elements)) {
        attempts.push(`${host}: réponse invalide`)
        continue
      }
      return data.elements.filter(isElement)
    }
    catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      attempts.push(`${host}: ${name === 'TimeoutError' || name === 'AbortError' ? 'délai dépassé' : 'erreur réseau ou JSON'}`)
    }
  }
  throw new OverpassError(attempts)
}
