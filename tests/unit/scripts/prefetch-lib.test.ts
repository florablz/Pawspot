/**
 * Fonctions pures du pré-remplissage (scripts/prefetch-lib.ts) : options de la
 * ligne de commande, choix des villes, état des instances, mise en forme.
 * Module sans effet de bord : ni base, ni réseau, ni `process.exit`.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFETCH_OPTIONS,
  PREFETCH_HELP,
  PrefetchUsageError,
  SLEEP_SUSPICION_MARGIN_MS,
  allInstancesPaused,
  formatDuration,
  formatNumber,
  parseArgs,
  plural,
  selectCities,
  suspectedSleep,
} from '../../../scripts/prefetch-lib'
import { PREFETCH_CITIES } from '../../../shared/cities'
import type { PrefetchCity } from '../../../shared/cities'
import { OverpassCircuit } from '../../../server/services/places/overpass'

/** Erreur levée par `fn`, pour en vérifier le type et le message. */
function errorOf(fn: () => unknown): unknown {
  try {
    fn()
  }
  catch (error) {
    return error
  }
  throw new Error('aucune erreur levée')
}

describe('parseArgs', () => {
  it('sans argument : valeurs par défaut et toutes les villes', () => {
    expect(parseArgs([])).toEqual({ ...DEFAULT_PREFETCH_OPTIONS, cities: [] })
    expect(DEFAULT_PREFETCH_OPTIONS).toMatchObject({ pauseMs: 5_000, timeoutMs: 90_000, tilesPerRequest: 4 })
  })

  it('lit les drapeaux et les nombres (secondes converties en ms)', () => {
    const options = parseArgs(['--list', '--dry-run', '--force', '--pause=2.5', '--timeout=120', '--tiles-per-request=8'])
    expect(options).toMatchObject({ list: true, dryRun: true, force: true, pauseMs: 2_500, timeoutMs: 120_000, tilesPerRequest: 8 })
  })

  it('--city répétable et séparé par des virgules, espaces retirés', () => {
    expect(parseArgs(['--city=Paris, Lyon', '--city=Nice,']).cities).toEqual(['Paris', 'Lyon', 'Nice'])
  })

  it('refuse une option inconnue avec l\'aide dans le message', () => {
    const error = errorOf(() => parseArgs(['--villes=Paris']))
    expect(error).toBeInstanceOf(PrefetchUsageError)
    expect((error as Error).message).toContain('Option inconnue : --villes=Paris')
    expect((error as Error).message).toContain(PREFETCH_HELP)
  })

  it('refuse --city vide ou fait d\'espaces', () => {
    for (const arg of ['--city=', '--city', '--city=  ']) {
      const error = errorOf(() => parseArgs([arg]))
      expect(error, arg).toBeInstanceOf(PrefetchUsageError)
      expect((error as Error).message).toMatch(/^Option --city vide/)
    }
  })

  it('--pause : accepte 0 et 600 s, refuse en dehors', () => {
    expect(parseArgs(['--pause=0']).pauseMs).toBe(0)
    expect(parseArgs(['--pause=600']).pauseMs).toBe(600_000)
    for (const value of ['-1', '601', '', 'abc', 'Infinity']) {
      expect(() => parseArgs([`--pause=${value}`]), value).toThrow(PrefetchUsageError)
    }
    expect(() => parseArgs(['--pause=601'])).toThrow('Option --pause invalide : « 601 » (attendu entre 0 et 600).')
  })

  it('--timeout : accepte 10 et 600 s, refuse en dehors', () => {
    expect(parseArgs(['--timeout=10']).timeoutMs).toBe(10_000)
    expect(parseArgs(['--timeout=600']).timeoutMs).toBe(600_000)
    for (const value of ['9', '9.99', '601', '', ' ']) {
      expect(() => parseArgs([`--timeout=${value}`]), value).toThrow(PrefetchUsageError)
    }
  })

  it('--tiles-per-request : 1 à 8, partie entière', () => {
    expect(parseArgs(['--tiles-per-request=1']).tilesPerRequest).toBe(1)
    expect(parseArgs(['--tiles-per-request=8']).tilesPerRequest).toBe(8)
    expect(parseArgs(['--tiles-per-request=3.7']).tilesPerRequest).toBe(3)
    for (const value of ['0', '0.5', '9', '']) {
      expect(() => parseArgs([`--tiles-per-request=${value}`]), value).toThrow(PrefetchUsageError)
    }
  })

  it('--help et -h donnent help: true sans lever d\'erreur', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
    expect(PREFETCH_HELP).toContain('caffeinate -i')
  })
})

describe('selectCities', () => {
  it('liste vide : toutes les villes, dans une copie', () => {
    const all = selectCities([])
    expect(all).toEqual([...PREFETCH_CITIES])
    expect(all).not.toBe(PREFETCH_CITIES)
  })

  it('--city=Paris,paris : Paris une seule fois', () => {
    const cities = selectCities(parseArgs(['--city=Paris,paris']).cities)
    expect(cities.map(c => c.key)).toEqual(['paris'])
  })

  it('garde l\'ordre donné et accepte la clé ou le nom sans accents', () => {
    expect(selectCities(['Lyon', 'saint etienne', 'PARIS']).map(c => c.key)).toEqual(['lyon', 'saint-etienne', 'paris'])
  })

  it('cite toutes les villes inconnues dans le message', () => {
    const error = errorOf(() => selectCities(['Paris', 'Atlantide', 'Lyon', 'Ys']))
    expect(error).toBeInstanceOf(PrefetchUsageError)
    expect((error as Error).message).toBe('Ville inconnue : Atlantide, Ys. Liste des villes : --list.')
  })

  // BUG (donnees, scripts/prefetch-lib.ts) : `selectCities(names, all)` cherche les noms avec
  // `findPrefetchCity(name)` sur PREFETCH_CITIES et ignore la liste `all` fournie. Sans effet
  // aujourd'hui (le script n'injecte rien), mais le paramètre ne sert que quand `names` est vide.
  // Retirer `.fails` une fois corrigé (`findPrefetchCity(name, all)`).
  it.fails('cherche les villes dans la liste fournie', () => {
    const custom: PrefetchCity[] = [{ key: 'brest', name: 'Brest', lat: 48.39, lon: -4.49, radiusKm: 2 }]
    expect(selectCities(['Brest'], custom)).toEqual(custom)
  })
})

describe('allInstancesPaused', () => {
  const A = 'https://overpass-a.test/api/interpreter'
  const B = 'https://overpass-b.test/api/interpreter'
  const NOW = Date.UTC(2026, 10, 3, 10)

  it('liste vide : vrai (aucune instance utilisable)', () => {
    expect(allInstancesPaused([], new OverpassCircuit(), 90_000, NOW)).toBe(true)
  })

  it('vrai seulement si chaque instance est en pause', () => {
    const circuit = new OverpassCircuit()
    circuit.recordFailure(A, NOW, 120_000)
    expect(allInstancesPaused([A, B], circuit, 90_000, NOW)).toBe(false)
    circuit.recordFailure(B, NOW, 120_000)
    expect(allInstancesPaused([A, B], circuit, 90_000, NOW)).toBe(true)
    expect(allInstancesPaused([A, B], circuit, 90_000, NOW + 120_000)).toBe(false)
  })
})

describe('mise en forme', () => {
  it('formatDuration : secondes avec une décimale sous la minute', () => {
    expect(formatDuration(0)).toBe('0,0 s')
    expect(formatDuration(4_200)).toBe('4,2 s')
    expect(formatDuration(59_900)).toBe('59,9 s')
  })

  it('formatDuration : minutes et secondes sur deux chiffres, sans « 60 s »', () => {
    expect(formatDuration(60_000)).toBe('1 min 00 s')
    expect(formatDuration(119_600)).toBe('2 min 00 s')
    expect(formatDuration(1_153_000)).toBe('19 min 13 s')
  })

  it('plural : singulier pour 0 et 1, pluriel au-delà, nombre au format français', () => {
    expect(plural(0, 'tuile', 'tuiles')).toBe('0 tuile')
    expect(plural(1, 'tuile', 'tuiles')).toBe('1 tuile')
    expect(plural(2, 'tuile', 'tuiles')).toBe('2 tuiles')
    // Intl fr-FR sépare les milliers par une espace fine insécable.
    expect(plural(5887, 'lieu', 'lieux')).toBe(`${formatNumber(5887)} lieux`)
    expect(formatNumber(5887).replace(/\s/g, ' ')).toBe('5 887')
  })

  it('suspectedSleep : seulement au-delà du délai total plus la marge', () => {
    expect(SLEEP_SUSPICION_MARGIN_MS).toBe(30_000)
    expect(suspectedSleep(120_000, 90_000)).toBe(false)
    expect(suspectedSleep(120_001, 90_000)).toBe(true)
    expect(suspectedSleep(19 * 60_000 + 13_000, 90_000)).toBe(true)
    expect(suspectedSleep(1_500, 1_000, 0)).toBe(true)
  })
})
