/**
 * Migrations automatiques au démarrage, pour une base locale seulement
 * (`DATABASE_URL` absent ou `file:…`) : après un `git pull` qui ajoute une
 * migration, `npm run dev` met la base à jour sans `npm run db:migrate`.
 *
 * Base distante (Turso, production) : rien n'est fait ici, les migrations y sont
 * lancées par `npm run db:migrate` avant le build.
 *
 * Les requêtes attendent la fin des migrations (hook `request`). Un échec est
 * journalisé en clair ; le serveur continue de tourner (les routes qui touchent
 * la base échoueront), `npm run db:migrate` donne alors le détail.
 */
import { applyMigrations, findMigrationsFolder, isLocalDatabaseUrl } from '../database/migrate'

export default defineNitroPlugin((nitroApp) => {
  const url = process.env.DATABASE_URL
  if (!isLocalDatabaseUrl(url)) return

  const ready = (async () => {
    const folder = findMigrationsFolder()
    if (!folder) {
      console.warn(
        '[PawSpot] Migrations automatiques ignorées : dossier server/database/migrations introuvable '
        + `(dossier courant : ${process.cwd()}). Lancez le serveur depuis la racine du projet, `
        + 'définissez PAWSPOT_MIGRATIONS_DIR, ou lancez `npm run db:migrate`.',
      )
      return
    }
    try {
      const { db } = await import('../database')
      await applyMigrations(db, folder)
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(
        `[PawSpot] ÉCHEC des migrations de la base locale (${url || 'file:pawspot.db'}) : ${detail}\n`
        + '  La base n\'est pas à jour : les pages et routes qui l\'utilisent vont échouer.\n'
        + '  Corrigez le problème puis lancez `npm run db:migrate` pour le détail complet.',
      )
    }
  })()

  nitroApp.hooks.hook('request', async () => {
    await ready
  })
})
