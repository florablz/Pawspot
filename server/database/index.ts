import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

/**
 * Client libSQL : fichier local en dev (`file:pawspot.db`), Turso en prod.
 * Configuré par `DATABASE_URL` et `DATABASE_AUTH_TOKEN`.
 * Attention : toutes les requêtes sont asynchrones (`await`).
 */
export const client = createClient({
  url: process.env.DATABASE_URL || 'file:pawspot.db',
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
})

export const db = drizzle(client, { schema })

export type Database = typeof db
