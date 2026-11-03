/**
 * Application des migrations Drizzle (dossier `server/database/migrations`).
 * Utilisé par `npm run db:migrate` et, pour une base locale, au démarrage du
 * serveur (`server/plugins/db-migrate.ts`).
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/libsql/migrator'
import type { Database } from '.'

/** Chemin du dossier des migrations, relatif à la racine du projet. */
export const MIGRATIONS_DIR = 'server/database/migrations'

/** Base locale (fichier SQLite ou mémoire) : `DATABASE_URL` absent, `file:…` ou `:memory:`. */
export function isLocalDatabaseUrl(url: string | undefined | null): boolean {
  const value = (url ?? '').trim()
  return value === '' || value.startsWith('file:') || value === ':memory:'
}

/**
 * Cherche le dossier des migrations (celui qui contient `meta/_journal.json`) :
 * `PAWSPOT_MIGRATIONS_DIR` s'il est défini, puis en remontant depuis le dossier
 * courant, depuis le script lancé (`node .output/server/index.mjs` hors de la racine)
 * et depuis l'emplacement de ce module (sources en dev). `null` si introuvable.
 * Le build ne copie pas les migrations : il les retrouve dans le dépôt, à côté de `.output`.
 */
export function findMigrationsFolder(options: { cwd?: string; entry?: string; moduleUrl?: string; env?: Record<string, string | undefined> } = {}): string | null {
  const env = options.env ?? process.env
  const candidates: string[] = []
  if (env.PAWSPOT_MIGRATIONS_DIR) candidates.push(resolve(env.PAWSPOT_MIGRATIONS_DIR))
  const starts = [options.cwd ?? process.cwd()]
  const entry = options.entry ?? process.argv[1]
  if (entry) starts.push(dirname(resolve(entry)))
  try {
    starts.push(dirname(fileURLToPath(options.moduleUrl ?? import.meta.url)))
  }
  catch {
    // URL de module non `file:` (bundle) : seul le dossier courant est utilisé.
  }
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 6; i++) {
      candidates.push(resolve(dir, MIGRATIONS_DIR))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return candidates.find(dir => existsSync(resolve(dir, 'meta/_journal.json'))) ?? null
}

/** Applique les migrations en attente (idempotent : celles déjà appliquées sont ignorées). */
export async function applyMigrations(db: Database, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder })
}
