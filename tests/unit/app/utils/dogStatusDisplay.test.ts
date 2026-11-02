import { describe, expect, it } from 'vitest'
import { DOG_STATUSES, DOG_STATUS_LABELS } from '#shared/dogStatus'
import { DOG_STATUS_MARKER_DOT, DOG_STATUS_TONE, dogStatusAccessibleText } from '~/utils/dogStatusDisplay'

describe('dogStatusAccessibleText', () => {
  it.each(DOG_STATUSES)('%s : phrase complète avec le libellé', (status) => {
    expect(dogStatusAccessibleText(status)).toBe(`Statut chien : ${DOG_STATUS_LABELS[status].label}`)
  })

  it('ajoute le détail puis la source, séparés par des points', () => {
    expect(dogStatusAccessibleText('osm_conditional', 'OpenStreetMap', 'Uniquement la nuit (yes @ (19:00-08:00))'))
      .toBe('Statut chien : Sous conditions. Uniquement la nuit (yes @ (19:00-08:00)). Source : OpenStreetMap')
    expect(dogStatusAccessibleText('confirmed', '3 membres, dernier retour il y a 12 jours'))
      .toBe('Statut chien : Accepté, y compris à l\'intérieur. Source : 3 membres, dernier retour il y a 12 jours')
  })

  it('ignore un détail ou une source vides', () => {
    expect(dogStatusAccessibleText('osm_yes', '', '')).toBe('Statut chien : Accepté (source OpenStreetMap)')
  })
})

describe('teintes du statut chien', () => {
  it('chaque statut a une teinte et une pastille avec un symbole (jamais la couleur seule)', () => {
    for (const status of DOG_STATUSES) {
      const dot = DOG_STATUS_MARKER_DOT[DOG_STATUS_TONE[status]]
      expect(dot.color).toMatch(/^#[0-9A-F]{6}$/i)
      expect(dot.glyph).not.toBe('')
    }
  })

  it('refusé en rouge, « probablement » distinct des statuts confirmés', () => {
    expect(DOG_STATUS_TONE.refused).toBe('red')
    expect(DOG_STATUS_TONE.confirmed).toBe('green')
    expect(DOG_STATUS_TONE.likely_terrace).not.toBe(DOG_STATUS_TONE.confirmed)
    expect(DOG_STATUS_MARKER_DOT[DOG_STATUS_TONE.likely_terrace].glyph)
      .not.toBe(DOG_STATUS_MARKER_DOT[DOG_STATUS_TONE.confirmed].glyph)
  })
})
