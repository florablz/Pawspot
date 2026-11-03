/**
 * Migration 0001_places_cache sur une base Phase 0 contenant des données.
 *
 * Le migrateur Drizzle (`migrate`) applique toutes les migrations du dossier d'un
 * coup : on ne peut pas s'arrêter après 0000 pour insérer des données sans
 * fabriquer un faux dossier de migrations. On exécute donc le SQL des fichiers
 * nous-mêmes, découpé sur `--> statement-breakpoint` comme le fait Drizzle, et
 * on passe 0001 par `client.migrate()` : c'est l'appel qu'utilise le migrateur
 * Drizzle pour libSQL (transaction, clés étrangères désactivées puis réactivées).
 */
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../../../server/database/schema'

const MIGRATIONS = fileURLToPath(new URL('../../../../server/database/migrations', import.meta.url))

function statements(file: string): string[] {
  return readFileSync(`${MIGRATIONS}/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(Boolean)
}

const T = 1_700_000_000 // secondes (mode `timestamp` de Drizzle)

let client: Client

async function rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await client.execute(sql)).rows as unknown as T[]
}

beforeEach(async () => {
  client = createClient({ url: ':memory:' })
  await client.migrate(statements('0000_init.sql').map(sql => ({ sql, args: [] })))

  // Données Phase 0.
  await client.batch([
    `INSERT INTO users (id, email, username, password_hash, created_at) VALUES
      (1, 'alice@exemple.fr', 'alice', 'x', ${T}),
      (2, 'bob@exemple.fr', 'bob', 'x', ${T})`,
    // Favori 2 = doublon du favori 1 (même utilisateur, même lieu) ; le nom le plus récent l'emporte pour la fiche.
    `INSERT INTO favorites (id, user_id, place_id, place_name, place_lat, place_lon, place_category, created_at) VALUES
      (1, 1, 'node-1', 'Café A', 48.85, 2.33, 'cafe', ${T}),
      (2, 1, 'node-1', 'Café A (renommé)', 48.85, 2.33, 'cafe', ${T + 10}),
      (3, 2, 'node-1', 'Café A (renommé)', 48.85, 2.33, 'cafe', ${T + 20}),
      (4, 2, 'way-2', 'Parc B', 48.86, 2.34, 'park', ${T}),
      (5, 1, 'demo-1', 'Parc à chiens démo', 48.87, 2.35, 'dog_park', ${T}),
      (6, 1, 'illisible', 'Lieu inconnu', 48.88, 2.36, 'park', ${T}),
      (7, 2, 'node-8', 'Mauvaise catégorie', 48.88, 2.36, 'casino', ${T})`,
    // Avis 2 : orphelin (aucun favori ne donne les coordonnées de relation-99) ; avis 3 : id illisible.
    `INSERT INTO reviews (id, place_id, user_id, rating, comment, photos, created_at) VALUES
      (1, 'node-1', 2, 5, 'Très bon accueil', NULL, ${T}),
      (2, 'relation-99', 1, 3, 'Orphelin', NULL, ${T}),
      (3, 'n''importe quoi', 1, 1, NULL, NULL, ${T}),
      (4, 'demo-1', 2, 4, NULL, NULL, ${T})`,
    `INSERT INTO alerts (id, place_id, user_id, type, description, created_at) VALUES
      (1, 'way-2', 1, 'closed', NULL, ${T}),
      (2, 'node-777', 2, 'closed', NULL, ${T})`,
  ], 'write')

  await client.migrate(statements('0001_places_cache.sql').map(sql => ({ sql, args: [] })))
})

afterEach(() => {
  client.close()
})

describe('migration 0001_places_cache sur des données Phase 0', () => {
  it('convertit les ids et crée une ligne places par lieu connu', async () => {
    const places = await rows<{ id: string; source: string; name: string; name_normalized: string; lat: number; lon: number; category: string; status: string; verified: number; dog_status: string; fetched_at: number | null }>(
      'SELECT id, source, name, name_normalized, lat, lon, category, status, verified, dog_status, fetched_at FROM places ORDER BY id')
    expect(places.map(p => p.id)).toEqual(['osm:node:1', 'osm:way:2', 'user:demo-1'])
    expect(places[0]).toMatchObject({ source: 'osm', name: 'Café A (renommé)', name_normalized: 'café a (renommé)', lat: 48.85, lon: 2.33, category: 'cafe', status: 'active', verified: 1, dog_status: 'unknown', fetched_at: null })
    expect(places[2]).toMatchObject({ source: 'user', verified: 0, category: 'dog_park' })
  })

  it('fusionne le favori en double en gardant le plus ancien, et supprime les favoris sans lieu', async () => {
    const favorites = await rows<{ id: number; user_id: number; place_id: string }>('SELECT id, user_id, place_id FROM favorites ORDER BY id')
    expect(favorites.map(f => ({ ...f }))).toEqual([
      { id: 1, user_id: 1, place_id: 'osm:node:1' },
      { id: 3, user_id: 2, place_id: 'osm:node:1' },
      { id: 4, user_id: 2, place_id: 'osm:way:2' },
      { id: 5, user_id: 1, place_id: 'user:demo-1' },
    ])
  })

  it('supprime les avis et alertes orphelins, convertit les autres', async () => {
    const reviews = await rows<{ id: number; place_id: string }>('SELECT id, place_id FROM reviews ORDER BY id')
    expect(reviews.map(r => [r.id, r.place_id])).toEqual([[1, 'osm:node:1'], [4, 'user:demo-1']])
    const alerts = await rows<{ id: number; place_id: string }>('SELECT id, place_id FROM alerts ORDER BY id')
    expect(alerts.map(a => [a.id, a.place_id])).toEqual([[1, 'osm:way:2']])
  })

  it('laisse une base cohérente : foreign_key_check vide, table temporaire supprimée, index uniques', async () => {
    expect(await rows('PRAGMA foreign_key_check')).toEqual([])
    expect(await rows('SELECT name FROM sqlite_master WHERE name = \'__place_id_map\'')).toEqual([])
    const fks = await rows<{ table: string }>('PRAGMA foreign_key_list(favorites)')
    expect(fks.map(f => f.table).sort()).toEqual(['places', 'users'])
    await expect(client.execute(`INSERT INTO favorites (user_id, place_id, created_at) VALUES (1, 'osm:node:1', ${T})`)).rejects.toThrow(/UNIQUE/)
  })

  it('les clés étrangères sont actives après la migration', async () => {
    await expect(client.execute(`INSERT INTO reviews (place_id, user_id, rating, created_at) VALUES ('osm:node:404', 1, 5, ${T})`)).rejects.toThrow(/FOREIGN KEY/)
  })

  it('suppression d\'un lieu : ses favoris partent en cascade', async () => {
    await client.execute('DELETE FROM reviews WHERE place_id = \'user:demo-1\'')
    await client.execute('DELETE FROM places WHERE id = \'user:demo-1\'')
    expect(await rows('SELECT id FROM favorites WHERE place_id = \'user:demo-1\'')).toEqual([])
  })
})

describe('migrations complètes avec le migrateur Drizzle', () => {
  it('s\'appliquent sur une base vide et donnent le schéma attendu', async () => {
    const fresh = createClient({ url: ':memory:' })
    try {
      const db = drizzle(fresh, { schema })
      await migrate(db, { migrationsFolder: MIGRATIONS })
      const tables = (await fresh.execute('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')).rows.map(r => r.name)
      expect(tables).toEqual(['__drizzle_migrations', 'alerts', 'favorites', 'fetched_tiles', 'osm_lookup_misses', 'places', 'reviews', 'sessions', 'users'])
      // Une seconde exécution ne fait rien.
      await migrate(db, { migrationsFolder: MIGRATIONS })
      expect((await fresh.execute('SELECT count(*) AS n FROM __drizzle_migrations')).rows[0]!.n).toBe(3)
    }
    finally {
      fresh.close()
    }
  })
})
