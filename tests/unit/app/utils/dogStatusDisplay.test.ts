import { describe, expect, it } from 'vitest'
import { DOG_STATUSES, DOG_STATUS_LABELS } from '#shared/dogStatus'
import { DOG_STATUS_MARKER, DOG_STATUS_TONE, dogStatusAccessibleText } from '~/utils/dogStatusDisplay'

/** Rapport de contraste WCAG 2.x entre deux couleurs `#RRGGBB`. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('dogStatusAccessibleText', () => {
  it.each(DOG_STATUSES)('%s : phrase complète avec le libellé', (status) => {
    expect(dogStatusAccessibleText(status)).toBe(`Statut chien : ${DOG_STATUS_LABELS[status].label}`)
  })

  it('ajoute le détail puis la source, séparés par des points', () => {
    expect(dogStatusAccessibleText('osm_conditional', 'OpenStreetMap', 'Chiens acceptés de 19 h à 8 h seulement'))
      .toBe('Statut chien : Sous conditions. Chiens acceptés de 19 h à 8 h seulement. Source : OpenStreetMap')
    expect(dogStatusAccessibleText('confirmed', '3 membres, dernier retour il y a 12 jours'))
      .toBe('Statut chien : Accepté, y compris à l\'intérieur. Source : 3 membres, dernier retour il y a 12 jours')
  })

  it('ignore un détail ou une source vides', () => {
    expect(dogStatusAccessibleText('osm_yes', '', '')).toBe('Statut chien : Accepté')
  })

  it('statut inconnu : invitation au vouvoiement', () => {
    expect(dogStatusAccessibleText('unknown')).toBe('Statut chien : Info non disponible : soyez le premier à nous le dire !')
  })
})

describe('pastilles des marqueurs (DOG_STATUS_MARKER)', () => {
  it.each(DOG_STATUSES)('%s : couleur, symbole et contraste du symbole ≥ 4,5:1', (status) => {
    const marker = DOG_STATUS_MARKER[status]
    expect(marker.color).toMatch(/^#[0-9A-F]{6}$/i)
    expect(marker.glyphColor).toMatch(/^#[0-9A-F]{6}$/i)
    expect(marker.glyph.trim()).not.toBe('')
    expect(typeof marker.dashed).toBe('boolean')
    expect(contrast(marker.color, marker.glyphColor)).toBeGreaterThanOrEqual(4.5)
  })

  it('un symbole distinct par niveau de certitude (jamais la couleur seule)', () => {
    const { confirmed, confirmed_outside_only, osm_yes, osm_conditional, likely_terrace, unknown, refused } = DOG_STATUS_MARKER
    expect(confirmed.glyph).toBe(confirmed_outside_only.glyph)
    const levels = [confirmed, osm_yes, osm_conditional, likely_terrace, unknown, refused].map(m => m.glyph)
    expect(new Set(levels).size).toBe(levels.length)
  })

  it('seul « probablement en terrasse » a une bordure en pointillés', () => {
    expect(DOG_STATUSES.filter(s => DOG_STATUS_MARKER[s].dashed)).toEqual(['likely_terrace'])
  })

  it('les verts confirmé et OSM partagent la couleur mais pas le symbole', () => {
    expect(DOG_STATUS_MARKER.osm_yes.color).toBe(DOG_STATUS_MARKER.confirmed.color)
    expect(DOG_STATUS_MARKER.osm_yes.glyph).not.toBe(DOG_STATUS_MARKER.confirmed.glyph)
  })
})

describe('teintes du badge', () => {
  it('refusé en rouge, « probablement » distinct des statuts confirmés', () => {
    expect(DOG_STATUS_TONE.refused).toBe('red')
    expect(DOG_STATUS_TONE.confirmed).toBe('green')
    expect(DOG_STATUS_TONE.likely_terrace).not.toBe(DOG_STATUS_TONE.confirmed)
    expect(DOG_STATUS_MARKER.likely_terrace.color).not.toBe(DOG_STATUS_MARKER.confirmed.color)
  })
})
