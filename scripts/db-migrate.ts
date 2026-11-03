import './db-env'
import { client, db } from '../server/database'
import { applyMigrations, MIGRATIONS_DIR } from '../server/database/migrate'

const url = process.env.DATABASE_URL || 'file:pawspot.db'
console.log(`Application des migrations sur ${url}…`)

try {
  await applyMigrations(db, MIGRATIONS_DIR)
  console.log('Migrations appliquées.')
}
catch (error) {
  console.error('Échec des migrations :', error)
  process.exitCode = 1
}
finally {
  client.close()
}
