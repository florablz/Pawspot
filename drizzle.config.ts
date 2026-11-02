import { defineConfig } from 'drizzle-kit'

try {
  process.loadEnvFile()
}
catch {
  // Pas de fichier .env : on garde les variables d'environnement existantes.
}

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:pawspot.db',
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
})
