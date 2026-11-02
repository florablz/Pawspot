import { describe, expect, it } from 'vitest'
import { formatTimeAgo } from '~/utils/timeAgo'

const NOW = new Date('2026-11-02T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatTimeAgo', () => {
  it.each([
    ['0 s', 0, 'à l\'instant'],
    ['59 s', 59_000, 'à l\'instant'],
    ['une date future', -5 * MIN, 'à l\'instant'],
    ['1 min', MIN, 'il y a 1 min'],
    ['59 min', 59 * MIN + 59_000, 'il y a 59 min'],
    ['1 h', HOUR, 'il y a 1 h'],
    ['23 h', 23 * HOUR + 59 * MIN, 'il y a 23 h'],
    ['1 j', DAY, 'il y a 1 j'],
    ['29 j', 29 * DAY, 'il y a 29 j'],
  ])('%s → texte relatif', (_label, delta, expected) => {
    expect(formatTimeAgo(ago(delta), NOW)).toBe(expected)
  })

  it('à partir de 30 jours : la date au format français', () => {
    const date = new Date('2026-09-15T12:00:00Z')
    expect(formatTimeAgo(date, NOW)).toBe(date.toLocaleDateString('fr-FR'))
    expect(formatTimeAgo(date, NOW)).toMatch(/^15\/09\/2026$/)
  })

  it('accepte une chaîne ISO ou un objet Date', () => {
    const d = new Date(NOW - 3 * HOUR)
    expect(formatTimeAgo(d, NOW)).toBe(formatTimeAgo(d.toISOString(), NOW))
  })
})
