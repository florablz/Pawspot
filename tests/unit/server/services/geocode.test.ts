/**
 * Cache du géocodage (server/services/geocode) sur une base libSQL en mémoire,
 * recréée pour chaque test. Aucun appel au fournisseur : ce module ne lit et
 * n'écrit que la table `geocode_cache`.
 */
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import type { Database } from '../../../../server/database'
import * as schema from '../../../../server/database/schema'
import {
  GEOCODE_CACHE_MAX_RESULTS,
  GEOCODE_CACHE_TTL_MS,
  geocodeCacheKey,
  getCachedGeocode,
  purgeGeocodeCache,
  setCachedGeocode,
} from '../../../../server/services/geocode'
import { geocodeQuerySchema } from '../../../../shared/schemas'
import type { GeocodeResult } from '../../../../shared/types'

const MIGRATIONS = fileURLToPath(new URL('../../../../server/database/migrations', import.meta.url))
const DAY = 24 * 60 * 60 * 1000
/** Seconde ronde : `created_at` est stocké à la seconde. */
const T0 = new Date('2026-11-02T10:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

const PARIS: GeocodeResult = {
  label: 'Paris, Île-de-France, France',
  lat: 48.8566,
  lon: 2.3522,
  bbox: { minLon: 2.2241, minLat: 48.8156, maxLon: 2.4699, maxLat: 48.9022 },
  type: 'city',
  city: 'Paris',
}
const RIVOLI: GeocodeResult = {
  label: '8 Rue de Rivoli, 75004 Paris',
  lat: 48.8556,
  lon: 2.3601,
  type: 'address',
  postcode: '75004',
  city: 'Paris',
}

let client: Client
let db: Database

const deps = (now: Date = T0) => ({ db, now: () => now })
const rowCount = async () => Number((await client.execute('SELECT count(*) AS n FROM geocode_cache')).rows[0]!.n)

beforeEach(async () => {
  client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  client.close()
})

describe('geocodeCacheKey', () => {
  it('« PARIS », « paris » et «  Paris  » donnent la même clé', () => {
    expect(geocodeCacheKey('PARIS')).toBe('paris')
    expect(geocodeCacheKey('  Paris  ')).toBe('paris')
    expect(geocodeCacheKey('Saint-Étienne')).toBe('saint etienne')
  })

  it('clé vide si la requête n\'a ni lettre ni chiffre', () => {
    expect(geocodeCacheKey('!!! ?')).toBe('')
  })
})

describe('getCachedGeocode / setCachedGeocode', () => {
  it('une requête mise en cache sous « PARIS » est relue sous « paris »', async () => {
    await setCachedGeocode('PARIS', [PARIS], deps())
    expect(await getCachedGeocode('paris', deps())).toEqual([PARIS])
    expect(await rowCount()).toBe(1)
  })

  it('absent du cache → null', async () => {
    expect(await getCachedGeocode('Lyon', deps())).toBeNull()
  })

  it('clé vide : rien n\'est écrit et la lecture renvoie null', async () => {
    await setCachedGeocode('!!!', [PARIS], deps())
    expect(await rowCount()).toBe(0)
    expect(await getCachedGeocode('!!!', deps())).toBeNull()
  })

  it('remplace l\'entrée existante de la même requête', async () => {
    await setCachedGeocode('paris', [PARIS], deps())
    await setCachedGeocode('Paris', [RIVOLI], deps(at(DAY)))
    expect(await getCachedGeocode('paris', deps(at(DAY)))).toEqual([RIVOLI])
    expect(await rowCount()).toBe(1)
  })

  it('valable juste avant 30 jours, expirée à exactement 30 jours', async () => {
    await setCachedGeocode('paris', [PARIS], deps())
    expect(await getCachedGeocode('paris', deps(at(GEOCODE_CACHE_TTL_MS - 1000)))).toEqual([PARIS])
    expect(await getCachedGeocode('paris', deps(at(GEOCODE_CACHE_TTL_MS)))).toBeNull()
    expect(GEOCODE_CACHE_TTL_MS).toBe(30 * DAY)
  })

  it('une liste vide (« aucun résultat ») est mise en cache et relue comme []', async () => {
    await setCachedGeocode('zzqx introuvable', [], deps())
    expect(await getCachedGeocode('zzqx introuvable', deps())).toEqual([])
  })

  it('au plus 10 résultats gardés, dans l\'ordre', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...RIVOLI, label: `${i + 1} Rue de Rivoli, 75004 Paris` }))
    await setCachedGeocode('rue de rivoli', many, deps())
    const cached = await getCachedGeocode('rue de rivoli', deps())
    expect(cached).toHaveLength(GEOCODE_CACHE_MAX_RESULTS)
    expect(cached!.map(r => r.label)).toEqual(many.slice(0, 10).map(r => r.label))
  })

  it('résultat invalide → ZodError, rien n\'est écrit', async () => {
    const invalid = { ...PARIS, lat: 200 } as GeocodeResult
    await expect(setCachedGeocode('paris', [invalid], deps())).rejects.toBeInstanceOf(ZodError)
    const inverted = { ...PARIS, bbox: { minLon: 3, minLat: 48, maxLon: 2, maxLat: 49 } }
    await expect(setCachedGeocode('paris', [inverted], deps())).rejects.toBeInstanceOf(ZodError)
    expect(await rowCount()).toBe(0)
  })

  // BUG (donnees, server/services/geocode/index.ts) : la colonne `results` est en mode `json`,
  // Drizzle fait JSON.parse dans `.get()` et lève une SyntaxError avant le `safeParse`.
  // La doc promet `null` (« illisibles ») ; le proxy /api/geocode répondrait 500 au lieu de
  // redemander au fournisseur. Retirer `.fails` une fois corrigé (try/catch autour de la lecture,
  // ou colonne texte relue avec JSON.parse protégé).
  it.fails('JSON corrompu en base → null (pas d\'exception)', async () => {
    await client.execute({ sql: 'INSERT INTO geocode_cache (query, results, created_at) VALUES (?, ?, ?)', args: ['paris', '{pas du json', Math.floor(T0.getTime() / 1000)] })
    expect(await getCachedGeocode('paris', deps())).toBeNull()
  })

  it('JSON valide mais d\'une autre forme → null', async () => {
    await client.execute({ sql: 'INSERT INTO geocode_cache (query, results, created_at) VALUES (?, ?, ?)', args: ['paris', '[{"label":"Paris"}]', Math.floor(T0.getTime() / 1000)] })
    expect(await getCachedGeocode('paris', deps())).toBeNull()
  })

  it('un ajout purge les entrées expirées', async () => {
    await setCachedGeocode('lyon', [PARIS], deps())
    await setCachedGeocode('paris', [PARIS], deps(at(31 * DAY)))
    const keys = (await client.execute('SELECT query FROM geocode_cache ORDER BY query')).rows.map(r => r.query)
    expect(keys).toEqual(['paris'])
  })
})

describe('purgeGeocodeCache', () => {
  it('supprime les entrées de 30 jours ou plus et renvoie le nombre de lignes supprimées', async () => {
    await setCachedGeocode('lyon', [PARIS], deps())
    await setCachedGeocode('nice', [PARIS], deps(at(DAY)))
    await setCachedGeocode('paris', [PARIS], deps(at(20 * DAY)))
    expect(await purgeGeocodeCache(deps(at(31 * DAY)))).toBe(2)
    expect(await getCachedGeocode('paris', deps(at(31 * DAY)))).toEqual([PARIS])
    expect(await purgeGeocodeCache(deps(at(31 * DAY)))).toBe(0)
  })
})

describe('geocodeQuerySchema', () => {
  it('refuse un seul caractère', () => {
    expect(geocodeQuerySchema.safeParse({ q: 'a' }).success).toBe(false)
  })

  it('retire les espaces aux bords : «  ab  » → « ab »', () => {
    expect(geocodeQuerySchema.parse({ q: ' ab ' })).toEqual({ q: 'ab' })
  })

  it('refuse « a » entouré d\'espaces (1 caractère après trim)', () => {
    expect(geocodeQuerySchema.safeParse({ q: '   a   ' }).success).toBe(false)
  })

  it('accepte 100 caractères, refuse 101', () => {
    expect(geocodeQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true)
    expect(geocodeQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false)
  })

  it('refuse une requête absente', () => {
    const result = geocodeQuerySchema.safeParse({})
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Recherche requise')
  })
})
