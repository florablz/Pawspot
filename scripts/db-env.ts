/** Charge `.env` s'il existe (sans dépendance externe). À importer en premier. */
try {
  process.loadEnvFile()
}
catch {
  // Pas de fichier .env : on garde les variables d'environnement existantes.
}
