/**
 * Client Overpass seul (`runOverpassQuery`) : budget partagé entre instances,
 * plancher d'essai, `[timeout:N]` réécrit, HTTP 429 et `Retry-After`, disjoncteur,
 * liste d'instances configurable. Faux minuteurs et `fetch` simulé : aucun réseau.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CIRCUIT_LONGER_ATTEMPT_RATIO,
  OVERPASS_CIRCUIT_PAUSE_MS,
  OVERPASS_ENDPOINTS,
  OVERPASS_MIN_ATTEMPT_MS,
  OVERPASS_RETRY_AFTER_MAX_MS,
  OVERPASS_SERVER_TIMEOUT_S,
  OVERPASS_TIMEOUT_MS,
  OverpassCircuit,
  OverpassError,
  buildOverpassBboxQuery,
  configuredOverpassEndpoints,
  parseOverpassEndpoints,
  parseRetryAfter,
  runOverpassQuery,
  withServerTimeout,
} from '../../../../server/services/places/overpass'
import type { OverpassDeps, OverpassElement } from '../../../../server/services/places/overpass'
import { REFRESH_DEADLINE_EMPTY_MS } from '../../../../server/services/places'

const T0 = new Date('2026-11-03T10:00:00Z')
const A = 'https://overpass-a.test/api/interpreter'
const B = 'https://overpass-b.test/api/interpreter'
const C = 'https://overpass-c.test/api/interpreter'
const PARIS = { minLon: 2.30, minLat: 48.85, maxLon: 2.35, maxLat: 48.88 }
const QUERY = buildOverpassBboxQuery(PARIS)
const FLORE: OverpassElement = { type: 'node', id: 1001, lat: 48.854, lon: 2.333, tags: { amenity: 'cafe', name: 'Café de Flore' } }

const fetchMock = vi.fn<typeof fetch>()
let circuit: OverpassCircuit

const ok = (elements: OverpassElement[] = [FLORE]) =>
  new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const status = (code: number, headers: Record<string, string> = {}) => new Response('', { status: code, headers })
/** Ne répond jamais et ignore le signal d'annulation. */
const neverAnswers = () => new Promise<Response>(() => {})
/** Répond après `ms` (faux minuteurs). */
const answersAfter = (ms: number) => () => new Promise<Response>(resolve => setTimeout(() => resolve(ok()), ms))

/** Implémentation de `fetch` par instance. */
function route(handlers: Record<string, () => Promise<Response>>) {
  fetchMock.mockImplementation(async (input) => {
    const handler = handlers[String(input)]
    if (!handler) throw new Error(`instance inattendue : ${String(input)}`)
    return handler()
  })
}

function run(extra: Partial<OverpassDeps> = {}) {
  return runOverpassQuery(QUERY, {
    fetch: fetchMock,
    overpassEndpoints: [A, B, C],
    overpassCircuit: circuit,
    ...extra,
  })
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false, promise }
  promise.then(() => (state.settled = true), () => (state.settled = true))
  promise.catch(() => {})
  return state
}

const calledHosts = () => fetchMock.mock.calls.map(c => String(c[0]))
const sentTimeout = (i: number) => {
  const body = new URLSearchParams(String(fetchMock.mock.calls[i]![1]!.body))
  return Number(/\[timeout:(\d+)\]/.exec(body.get('data') ?? '')?.[1])
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 })
  fetchMock.mockReset()
  circuit = new OverpassCircuit()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('budget partagé entre instances', () => {
  it('502 rapide, instance muette puis réponse en 15 s : succès avant 40 s', async () => {
    route({ [A]: async () => status(502), [B]: neverAnswers, [C]: answersAfter(15_000) })
    const call = track(run({ overpassDeadlineMs: REFRESH_DEADLINE_EMPTY_MS }))

    // L'instance muette reçoit 20 s (le 502 n'a rien consommé), la troisième les 20 s restantes.
    await vi.advanceTimersByTimeAsync(OVERPASS_TIMEOUT_MS + 15_000 - 1)
    expect(call.settled).toBe(false)
    expect(calledHosts()).toEqual([A, B, C])
    await vi.advanceTimersByTimeAsync(1)
    expect(call.settled).toBe(true)
    expect(await call.promise).toEqual([FLORE])
    expect(Date.now() - T0.getTime()).toBeLessThan(REFRESH_DEADLINE_EMPTY_MS)
  })

  it('chaque essai reçoit au plus 20 s, même avec un budget total plus grand', async () => {
    route({ [A]: neverAnswers, [B]: async () => ok() })
    const call = track(run({ overpassEndpoints: [A, B], overpassDeadlineMs: 60_000 }))
    await vi.advanceTimersByTimeAsync(OVERPASS_TIMEOUT_MS - 1)
    expect(calledHosts()).toEqual([A])
    await vi.advanceTimersByTimeAsync(1)
    expect(await call.promise).toEqual([FLORE])
    expect(calledHosts()).toEqual([A, B])
  })

  it('n\'essaie plus d\'instance quand il reste moins de 3 s', async () => {
    route({ [A]: neverAnswers, [B]: async () => ok() })
    const call = track(run({ overpassEndpoints: [A, B], overpassDeadlineMs: OVERPASS_TIMEOUT_MS + OVERPASS_MIN_ATTEMPT_MS - 1 }))
    await vi.advanceTimersByTimeAsync(OVERPASS_TIMEOUT_MS)
    const error = await call.promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OverpassError)
    expect((error as OverpassError).attempts).toEqual([
      'overpass-a.test: délai dépassé',
      'overpass-b.test: délai total dépassé',
    ])
    expect(calledHosts()).toEqual([A])
  })

  it('essaie encore l\'instance suivante s\'il reste exactement 3 s', async () => {
    route({ [A]: neverAnswers, [B]: async () => ok() })
    const call = track(run({ overpassEndpoints: [A, B], overpassDeadlineMs: OVERPASS_TIMEOUT_MS + OVERPASS_MIN_ATTEMPT_MS }))
    await vi.advanceTimersByTimeAsync(OVERPASS_TIMEOUT_MS)
    expect(await call.promise).toEqual([FLORE])
    expect(calledHosts()).toEqual([A, B])
    expect(sentTimeout(1)).toBe(1)
  })
})

describe('[timeout:N] réécrit à chaque essai', () => {
  it('annonce le délai accordé moins 2 s : 18 s, puis ce qui reste', async () => {
    route({ [A]: neverAnswers, [B]: async () => ok() })
    const call = track(run({ overpassEndpoints: [A, B], overpassDeadlineMs: 32_000 }))
    await vi.advanceTimersByTimeAsync(OVERPASS_TIMEOUT_MS)
    await call.promise
    expect(sentTimeout(0)).toBe(OVERPASS_SERVER_TIMEOUT_S)
    expect(sentTimeout(1)).toBe(10) // 12 s restantes - 2 s
  })

  it('withServerTimeout ne dépasse jamais la valeur d\'origine et vaut au moins 1 s', () => {
    expect(withServerTimeout('[out:json][timeout:18];', 60_000)).toBe('[out:json][timeout:18];')
    expect(withServerTimeout('[out:json][timeout:18];', 10_000)).toBe('[out:json][timeout:8];')
    expect(withServerTimeout('[out:json][timeout:18];', 2_500)).toBe('[out:json][timeout:1];')
    expect(withServerTimeout('[out:json];', 10_000)).toBe('[out:json];')
  })
})

describe('HTTP 429 et Retry-After', () => {
  it('429 : passe à l\'instance suivante sans attendre', async () => {
    route({ [A]: async () => status(429), [B]: async () => ok() })
    expect(await run({ overpassEndpoints: [A, B] })).toEqual([FLORE])
    expect(calledHosts()).toEqual([A, B])
  })

  it('Retry-After plus long que 2 min : la pause le suit', async () => {
    route({ [A]: async () => status(429, { 'Retry-After': '300' }), [B]: async () => ok() })
    await run({ overpassEndpoints: [A, B] })
    const now = Date.now()
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + OVERPASS_CIRCUIT_PAUSE_MS + 1000)).toBe(true)
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + 300_000 - 1)).toBe(true)
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + 300_000)).toBe(false)
  })

  it('Retry-After d\'une heure : pause plafonnée à 10 min', async () => {
    route({ [A]: async () => status(429, { 'Retry-After': '3600' }), [B]: async () => ok() })
    await run({ overpassEndpoints: [A, B] })
    const now = Date.now()
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + OVERPASS_RETRY_AFTER_MAX_MS - 1)).toBe(true)
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + OVERPASS_RETRY_AFTER_MAX_MS)).toBe(false)
  })

  it('Retry-After plus court que 2 min : la pause reste de 2 min', async () => {
    route({ [A]: async () => status(429, { 'Retry-After': '30' }), [B]: async () => ok() })
    await run({ overpassEndpoints: [A, B] })
    const now = Date.now()
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + 60_000)).toBe(true)
    expect(circuit.isOpen(A, OVERPASS_TIMEOUT_MS, now + OVERPASS_CIRCUIT_PAUSE_MS)).toBe(false)
  })

  it('l\'instance en pause après un 429 est sautée sans appel au tour suivant', async () => {
    route({ [A]: async () => status(429, { 'Retry-After': '300' }), [B]: async () => ok() })
    await run({ overpassEndpoints: [A, B] })
    fetchMock.mockClear()
    vi.advanceTimersByTime(OVERPASS_CIRCUIT_PAUSE_MS + 1000)
    expect(await run({ overpassEndpoints: [A, B] })).toEqual([FLORE])
    expect(calledHosts()).toEqual([B])
  })

  it('parseRetryAfter : secondes, date HTTP, absent ou illisible', () => {
    const now = T0.getTime()
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter(' 5 ', now)).toBe(5_000)
    expect(parseRetryAfter(new Date(now + 90_000).toUTCString(), now)).toBe(90_000)
    expect(parseRetryAfter(new Date(now - 90_000).toUTCString(), now)).toBe(0)
    expect(parseRetryAfter(null, now)).toBeUndefined()
    expect(parseRetryAfter('', now)).toBeUndefined()
    expect(parseRetryAfter('bientôt', now)).toBeUndefined()
    // « -5 » est lu comme une date (an -5) par Date.parse : 0, la pause n'est jamais allongée.
    expect(parseRetryAfter('-5', now) ?? 0).toBe(0)
  })
})

describe('disjoncteur après un délai dépassé', () => {
  async function timeoutOnA(attemptMs: number) {
    route({ [A]: neverAnswers })
    const call = track(run({ overpassEndpoints: [A], overpassDeadlineMs: attemptMs }))
    await vi.advanceTimersByTimeAsync(attemptMs)
    await expect(call.promise).rejects.toBeInstanceOf(OverpassError)
    fetchMock.mockReset()
  }

  it('un essai 1,5× plus long reste permis malgré la pause', async () => {
    await timeoutOnA(10_000)
    route({ [A]: async () => ok(), [B]: async () => ok() })
    expect(await run({ overpassEndpoints: [A, B], overpassDeadlineMs: 10_000 * CIRCUIT_LONGER_ATTEMPT_RATIO })).toEqual([FLORE])
    expect(calledHosts()).toEqual([A])
  })

  it('un essai à peine plus long (moins de 1,5×) est sauté', async () => {
    await timeoutOnA(10_000)
    route({ [A]: async () => ok(), [B]: async () => ok() })
    expect(await run({ overpassEndpoints: [A, B], overpassDeadlineMs: 14_999 })).toEqual([FLORE])
    expect(calledHosts()).toEqual([B])
  })

  it('après une erreur franche (HTTP 504), même un essai plus long est sauté', async () => {
    route({ [A]: async () => status(504), [B]: async () => ok() })
    await run({ overpassEndpoints: [A, B], overpassDeadlineMs: 10_000 })
    fetchMock.mockClear()
    expect(await run({ overpassEndpoints: [A, B], overpassDeadlineMs: 40_000 })).toEqual([FLORE])
    expect(calledHosts()).toEqual([B])
  })

  it('« runtime error » : instance suivante, sans pause', async () => {
    const partial = async () => new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3' }), { status: 200 })
    route({ [A]: partial, [B]: async () => ok() })
    expect(await run({ overpassEndpoints: [A, B] })).toEqual([FLORE])
    expect(circuit.isOpen(A, 1000, Date.now())).toBe(false)
  })
})

describe('instances configurées (OVERPASS_ENDPOINTS)', () => {
  const DEFAULTS = [...OVERPASS_ENDPOINTS]

  it('4 instances par défaut, overpass-api.de en premier', () => {
    expect(DEFAULTS).toHaveLength(4)
    expect(new URL(DEFAULTS[0]!).host).toBe('overpass-api.de')
    expect(DEFAULTS.map(u => new URL(u).host)).toEqual([
      'overpass-api.de', 'maps.mail.ru', 'overpass.private.coffee', 'overpass.kumi.systems',
    ])
  })

  it('absente ou vide : liste par défaut', () => {
    expect(parseOverpassEndpoints(undefined)).toEqual(DEFAULTS)
    expect(parseOverpassEndpoints(null)).toEqual(DEFAULTS)
    expect(parseOverpassEndpoints('')).toEqual(DEFAULTS)
    expect(parseOverpassEndpoints(' , ,')).toEqual(DEFAULTS)
  })

  it('uniquement des entrées invalides : liste par défaut', () => {
    expect(parseOverpassEndpoints('pas une url, ftp://overpass.test/api, javascript:alert(1)')).toEqual(DEFAULTS)
  })

  it('garde les entrées valides dans l\'ordre, sans doublon ni entrée invalide', () => {
    expect(parseOverpassEndpoints(` ${B} ,pas une url,${A},${B},, ftp://x.test `)).toEqual([B, A])
  })

  it('accepte http: (instance locale)', () => {
    expect(parseOverpassEndpoints('http://localhost:12345/api/interpreter')).toEqual(['http://localhost:12345/api/interpreter'])
  })

  it('configuredOverpassEndpoints lit l\'environnement et suit ses changements', () => {
    expect(configuredOverpassEndpoints({})).toEqual(DEFAULTS)
    expect(configuredOverpassEndpoints({ OVERPASS_ENDPOINTS: `${C},${A}` })).toEqual([C, A])
    expect(configuredOverpassEndpoints({ OVERPASS_ENDPOINTS: '' })).toEqual(DEFAULTS)
  })

  it('sans liste injectée, runOverpassQuery utilise OVERPASS_ENDPOINTS', async () => {
    vi.stubEnv('OVERPASS_ENDPOINTS', `${C}`)
    route({ [C]: async () => ok() })
    expect(await runOverpassQuery(QUERY, { fetch: fetchMock, overpassCircuit: circuit })).toEqual([FLORE])
    expect(calledHosts()).toEqual([C])
  })
})
