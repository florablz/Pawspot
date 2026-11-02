import './db-env'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { client, db } from '../server/database'

const url = process.env.DATABASE_URL || 'file:pawspot.db'
console.log(`Application des migrations sur ${url}…`)

try {
  await migrate(db, { migrationsFolder: './server/database/migrations' })
  console.log('Migrations appliquées.')
}
catch (error) {
  console.error('Échec des migrations :', error)
  process.exitCode = 1
}
finally {
  client.close()
}
