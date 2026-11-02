/**
 * Banc de test des routes d'API, sans démarrer Nuxt.
 *
 * - Base : `DATABASE_URL=':memory:'` est fixé avant le premier import de
 *   `server/database`, puis les migrations sont appliquées. Le module de base reste
 *   le vrai, et Vitest isole les modules par fichier : chaque fichier de test a sa
 *   propre base vide.
 * - Routes : montées dans une vraie app h3, avec le gestionnaire d'erreurs de Nitro (`createApp` + `createRouter` +
 *   `toWebHandler`), appelées avec des `Request` : corps, cookies et paramètres
 *   encodés passent par le même chemin que dans Nitro.
 * - Auto-imports Nitro (`defineEventHandler`, `readBody`, `setCookie`…, et les
 *   fonctions de `server/utils/auth.ts`) : fournis en globaux.
 * - Overpass : `fetch` global simulé (`fetchMock`), aucun appel réseau. Le
 *   disjoncteur du processus est remis à zéro avant chaque test : une pause
 *   ouverte par un test (Overpass en panne) ne court-circuite pas le suivant.
 */
import { fileURLToPath } from 'node:url'
import { beforeEach, vi } from 'vitest'
import * as h3 from 'h3'
import type { EventHandler } from 'h3'
import { defaultHandler } from 'nitropack/runtime/internal/error/prod'
import type { Database } from '../../../../server/database'
import type * as Schema from '../../../../server/database/schema'

const MIGRATIONS = fileURLToPath(new URL('../../../../server/database/migrations', import.meta.url))

export const fetchMock = vi.fn<typeof fetch>()

beforeEach(async () => {
  // Import paresseux : rien n'est chargé avant que `setupApi` ait fixé DATABASE_URL.
  const { resetOverpassCircuit } = await import('../../../../server/services/places')
  resetOverpassCircuit()
})

/** Routes montées : [méthode, chemin h3, module]. Imports explicites (les noms de fichiers contiennent des crochets). */
const ROUTES = [
  ['get', '/api/places', () => import('../../../../server/api/places.get')],
  ['get', '/api/places/:id', () => import('../../../../server/api/places/[id].get')],
  ['get', '/api/favorites', () => import('../../../../server/api/favorites/index.get')],
  ['post', '/api/favorites', () => import('../../../../server/api/favorites/index.post')],
  ['delete', '/api/favorites/:placeId', () => import('../../../../server/api/favorites/[placeId].delete')],
  ['get', '/api/favorites/check/:placeId', () => import('../../../../server/api/favorites/check/[placeId].get')],
  ['post', '/api/reviews', () => import('../../../../server/api/reviews/index.post')],
  ['get', '/api/reviews/:placeId', () => import('../../../../server/api/reviews/[placeId].get')],
  ['post', '/api/alerts', () => import('../../../../server/api/alerts/index.post')],
  ['get', '/api/alerts/:placeId', () => import('../../../../server/api/alerts/[placeId].get')],
  ['post', '/api/auth/register', () => import('../../../../server/api/auth/register.post')],
  ['post', '/api/auth/login', () => import('../../../../server/api/auth/login.post')],
  ['post', '/api/auth/logout', () => import('../../../../server/api/auth/logout.post')],
  ['get', '/api/auth/me', () => import('../../../../server/api/auth/me.get')],
] as const

export interface ApiResponse<T = unknown> {
  status: number
  body: T
  /** Texte brut du corps (pour chercher une fuite de données). */
  text: string
  /** Valeur du cookie de session posé par la réponse (`''` s'il est effacé, `undefined` s'il n'est pas touché). */
  sessionCookie: string | undefined
}

export interface RequestOptions {
  /** Objet sérialisé en JSON, ou chaîne envoyée telle quelle. */
  body?: unknown
  /** Valeur du cookie `pawspot-session`. */
  session?: string
  contentType?: string
}

export interface ApiBench {
  db: Database
  schema: typeof Schema
  request: <T = unknown>(method: string, path: string, options?: RequestOptions) => Promise<ApiResponse<T>>
  /** Utilisateur créé directement en base (sans bcrypt, donc rapide), avec une session valide. */
  createUser: (username: string) => Promise<{ id: number; email: string; session: string }>
  /** Lieu inséré directement en base. */
  insertPlace: (values: Partial<typeof Schema.places.$inferInsert> & { id: string }) => Promise<void>
}

const SESSION_COOKIE = 'pawspot-session'

function readSessionCookie(headers: Headers): string | undefined {
  for (const cookie of headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const [name, ...value] = pair!.split('=')
    if (name!.trim() === SESSION_COOKIE) return value.join('=')
  }
  return undefined
}

export async function setupApi(): Promise<ApiBench> {
  process.env.DATABASE_URL = ':memory:'
  delete process.env.DATABASE_AUTH_TOKEN

  vi.stubGlobal('fetch', fetchMock)
  for (const name of ['defineEventHandler', 'createError', 'readBody', 'getCookie', 'setCookie', 'deleteCookie'] as const) {
    vi.stubGlobal(name, h3[name])
  }

  const { db } = await import('../../../../server/database')
  const schema = await import('../../../../server/database/schema')
  const { migrate } = await import('drizzle-orm/libsql/migrator')
  await migrate(db, { migrationsFolder: MIGRATIONS })

  const auth = await import('../../../../server/utils/auth')
  for (const name of ['hashPassword', 'verifyPassword', 'createSession', 'deleteSession', 'setSessionCookie', 'clearSessionCookie', 'getUserFromSession', 'requireAuth'] as const) {
    vi.stubGlobal(name, auth[name])
  }

  // Erreurs rendues comme dans l'application (requêtes JSON) : corps
  // `{ error, url, statusCode, statusMessage, message, data }`, message masqué pour une erreur non gérée.
  const app = h3.createApp({
    async onError(error, event) {
      const res = await defaultHandler(error, event, { json: true, silent: true })
      h3.setResponseHeaders(event, res.headers)
      h3.setResponseStatus(event, res.status, res.statusText)
      await h3.send(event, typeof res.body === 'string' ? res.body : JSON.stringify(res.body))
    },
  })
  const router = h3.createRouter()
  for (const [method, path, load] of ROUTES) {
    const handler = (await load()).default as EventHandler
    router[method](path, handler)
  }
  app.use(router)
  const handle = h3.toWebHandler(app)

  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const headers = new Headers()
    if (options.session !== undefined) headers.set('cookie', `${SESSION_COOKIE}=${options.session}`)
    let body: string | undefined
    if (options.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      headers.set('content-type', options.contentType ?? 'application/json')
    }
    const response = await handle(new Request(`http://localhost${path}`, { method, headers, body }))
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : undefined
    }
    catch {
      // corps non JSON : laissé en texte
    }
    return { status: response.status, body: parsed as T, text, sessionCookie: readSessionCookie(response.headers) }
  }

  async function createUser(username: string) {
    const email = `${username}@exemple.fr`
    const user = await db.insert(schema.users)
      .values({ email, username, passwordHash: `hash-secret-${username}` })
      .returning({ id: schema.users.id })
      .get()
    const session = await auth.createSession(user.id)
    return { id: user.id, email, session }
  }

  async function insertPlace(values: Partial<typeof Schema.places.$inferInsert> & { id: string }) {
    await db.insert(schema.places).values({
      source: values.id.startsWith('user:') ? 'user' : 'osm',
      name: 'Lieu de test',
      lat: 48.86,
      lon: 2.34,
      category: 'cafe',
      verified: true,
      ...values,
    })
  }

  return { db, schema, request, createUser, insertPlace }
}

/** Réponse Overpass simulée. */
export function overpassResponse(elements: unknown[]): Response {
  return new Response(JSON.stringify({ version: 0.6, elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** Overpass injoignable sur toutes les instances. */
export function overpassDown(): void {
  fetchMock.mockImplementation(async () => new Response('busy', { status: 504 }))
}
