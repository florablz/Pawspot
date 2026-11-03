/**
 * Migrations au démarrage : fonctions de `server/database/migrate.ts`, sur des
 * bases libSQL en mémoire et des dossiers temporaires.
 */
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMigrations, findMigrationsFolder, isLocalDatabaseUrl } from '../../../../server/database/migrate'
import * as schema from '../../../../server/database/schema'

const MIGRATIONS = fileURLToPath(new URL('../../../../server/database/migrations', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

let client: Client
let tmp: string

beforeEach(() => {
  client = createClient({ url: ':memory:' })
  tmp = mkdtempSync(join(tmpdir(), 'pawspot-migrate-'))
})

afterEach(() => {
  client.close()
  rmSync(tmp, { recursive: true, force: true })
})

/** Dossier de migrations factice avec un seul fichier SQL. */
function fakeMigrations(sql: string): string {
  const dir = join(tmp, 'migrations')
  mkdirSync(join(dir, 'meta'), { recursive: true })
  writeFileSync(join(dir, '0000_test.sql'), sql)
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: [{ idx: 0, version: '6', when: 1, tag: '0000_test', breakpoints: true }],
  }))
  return dir
}

describe('isLocalDatabaseUrl', () => {
  it('absente ou vide : base locale (file:pawspot.db par défaut)', () => {
    expect(isLocalDatabaseUrl(undefined)).toBe(true)
    expect(isLocalDatabaseUrl(null)).toBe(true)
    expect(isLocalDatabaseUrl('')).toBe(true)
    expect(isLocalDatabaseUrl('   ')).toBe(true)
  })

  it('fichier SQLite ou :memory: : base locale', () => {
    expect(isLocalDatabaseUrl('file:pawspot.db')).toBe(true)
    expect(isLocalDatabaseUrl(' file:/var/data/pawspot.db ')).toBe(true)
    expect(isLocalDatabaseUrl(':memory:')).toBe(true)
  })

  it('Turso ou serveur libSQL : base distante', () => {
    expect(isLocalDatabaseUrl('libsql://pawspot-flora.turso.io')).toBe(false)
    expect(isLocalDatabaseUrl('https://pawspot-flora.turso.io')).toBe(false)
    expect(isLocalDatabaseUrl('wss://pawspot.turso.io')).toBe(false)
    expect(isLocalDatabaseUrl('http://127.0.0.1:8080')).toBe(false)
  })
})

describe('applyMigrations', () => {
  it('crée toutes les tables sur une base :memory:', async () => {
    const db = drizzle(client, { schema })
    await applyMigrations(db, MIGRATIONS)
    const tables = (await client.execute('SELECT name FROM sqlite_master WHERE type = \'table\'')).rows.map(r => r.name)
    expect(tables).toEqual(expect.arrayContaining(['users', 'places', 'reviews', 'fetched_tiles', 'osm_lookup_misses']))
  })

  it('est idempotente : un second passage ne fait rien et ne perd pas de données', async () => {
    const db = drizzle(client, { schema })
    await applyMigrations(db, MIGRATIONS)
    const count = async () => (await client.execute('SELECT count(*) AS n FROM __drizzle_migrations')).rows[0]!.n
    const before = await count()
    await applyMigrations(db, MIGRATIONS)
    expect(await count()).toBe(before)
  })

  it('migration cassée : rejette avec une erreur', async () => {
    const db = drizzle(client, { schema })
    await expect(applyMigrations(db, fakeMigrations('CREATE TABLE oops (;'))).rejects.toThrow()
  })
})

describe('findMigrationsFolder', () => {
  it('trouve le dossier depuis la racine du projet', () => {
    expect(findMigrationsFolder({ cwd: ROOT, entry: undefined, env: {} })).toBe(MIGRATIONS)
  })

  it('trouve le dossier en remontant depuis le script lancé (.output/server)', () => {
    const found = findMigrationsFolder({ cwd: tmp, entry: join(ROOT, '.output/server/index.mjs'), moduleUrl: 'data:text/javascript,', env: {} })
    expect(found).toBe(MIGRATIONS)
  })

  it('PAWSPOT_MIGRATIONS_DIR passe en premier', () => {
    const dir = fakeMigrations('SELECT 1;')
    expect(findMigrationsFolder({ cwd: ROOT, env: { PAWSPOT_MIGRATIONS_DIR: dir } })).toBe(dir)
  })

  it('PAWSPOT_MIGRATIONS_DIR sans meta/_journal.json : ignoré', () => {
    expect(findMigrationsFolder({ cwd: ROOT, env: { PAWSPOT_MIGRATIONS_DIR: tmp } })).toBe(MIGRATIONS)
  })

  it('introuvable : null', () => {
    const entry = join(tmp, 'index.mjs')
    expect(findMigrationsFolder({ cwd: tmp, entry, moduleUrl: 'data:text/javascript,', env: {} })).toBeNull()
  })
})
