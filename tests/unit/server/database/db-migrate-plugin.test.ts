/**
 * Plugin Nitro `server/plugins/db-migrate.ts`, sans démarrer Nitro :
 * `defineNitroPlugin` est fourni en global (il renvoie la fonction du plugin),
 * l'application Nitro est simulée (`hooks.hook`), et les fonctions de
 * `server/database/migrate.ts` ainsi que le module de base sont remplacés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMigrationsFolder: vi.fn<() => string | null>(),
  applyMigrations: vi.fn<() => Promise<void>>(),
}))

vi.mock('../../../../server/database/migrate', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/database/migrate')>()
  return { ...original, findMigrationsFolder: mocks.findMigrationsFolder, applyMigrations: mocks.applyMigrations }
})
vi.mock('../../../../server/database', () => ({ db: { fake: true } }))

type Hook = () => Promise<void>

/** Charge le plugin et l'exécute sur une fausse application Nitro ; renvoie le hook `request`. */
async function startPlugin(): Promise<Hook | undefined> {
  vi.resetModules()
  vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn)
  const { default: plugin } = await import('../../../../server/plugins/db-migrate')
  let hook: Hook | undefined
  const nitroApp = { hooks: { hook: (name: string, fn: Hook) => { if (name === 'request') hook = fn } } }
  ;(plugin as unknown as (app: typeof nitroApp) => void)(nitroApp)
  return hook
}

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mocks.findMigrationsFolder.mockReset().mockReturnValue('/projet/server/database/migrations')
  mocks.applyMigrations.mockReset().mockResolvedValue()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('plugin db-migrate', () => {
  it('base distante (Turso) : ne fait rien, aucun hook posé', async () => {
    vi.stubEnv('DATABASE_URL', 'libsql://pawspot-flora.turso.io')
    expect(await startPlugin()).toBeUndefined()
    expect(mocks.findMigrationsFolder).not.toHaveBeenCalled()
    expect(mocks.applyMigrations).not.toHaveBeenCalled()
  })

  it('base locale : applique les migrations, et les requêtes attendent la fin', async () => {
    vi.stubEnv('DATABASE_URL', 'file:pawspot.db')
    let finish!: () => void
    mocks.applyMigrations.mockReturnValue(new Promise<void>(resolve => (finish = resolve)))
    const hook = await startPlugin()
    expect(hook).toBeDefined()

    let served = false
    const request = hook!().then(() => (served = true))
    await vi.waitFor(() => expect(mocks.applyMigrations).toHaveBeenCalledWith({ fake: true }, '/projet/server/database/migrations'))
    expect(served).toBe(false)
    finish()
    await request
    expect(served).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('DATABASE_URL absente : traitée comme une base locale', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const hook = await startPlugin()
    await hook!()
    expect(mocks.applyMigrations).toHaveBeenCalledTimes(1)
  })

  it('dossier des migrations introuvable : avertissement clair, pas de migration', async () => {
    vi.stubEnv('DATABASE_URL', 'file:pawspot.db')
    mocks.findMigrationsFolder.mockReturnValue(null)
    const hook = await startPlugin()
    await expect(hook!()).resolves.toBeUndefined()
    expect(mocks.applyMigrations).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/introuvable.*PAWSPOT_MIGRATIONS_DIR.*db:migrate/s)
  })

  it('migration cassée : erreur journalisée, sans exception, les requêtes continuent', async () => {
    vi.stubEnv('DATABASE_URL', 'file:pawspot.db')
    mocks.applyMigrations.mockRejectedValue(new Error('near ";": syntax error'))
    const hook = await startPlugin()
    await expect(hook!()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)
    const message = String(error.mock.calls[0]![0])
    expect(message).toContain('ÉCHEC des migrations')
    expect(message).toContain('file:pawspot.db')
    expect(message).toContain('near ";": syntax error')
    expect(message).toContain('npm run db:migrate')
  })
})
