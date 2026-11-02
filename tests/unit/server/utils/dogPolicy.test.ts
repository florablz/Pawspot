import { describe, expect, it } from 'vitest'
import { parseDogPolicy, resolveImage } from '../../../../server/utils/dogPolicy'

describe('parseDogPolicy', () => {
  it('renvoie « no » quand dog=no', () => {
    expect(parseDogPolicy({ dog: 'no' })).toEqual({ policy: 'no', source: 'no' })
  })

  it('ignore la casse de dog=NO', () => {
    expect(parseDogPolicy({ dog: 'NO' })).toEqual({ policy: 'no', source: 'no' })
  })

  it('donne priorité à dog=no sur un dog:conditional', () => {
    expect(parseDogPolicy({ 'dog': 'no', 'dog:conditional': 'yes @ night' }).policy).toBe('no')
  })

  it.each(['yes', 'leashed', 'outside'])('renvoie « all_day » avec la valeur en source quand dog=%s', (value) => {
    expect(parseDogPolicy({ dog: value })).toEqual({ policy: 'all_day', source: value })
  })

  it('met la source en minuscules (dog=Yes)', () => {
    expect(parseDogPolicy({ dog: 'Yes' })).toEqual({ policy: 'all_day', source: 'yes' })
  })

  it('donne priorité à dog=yes sur un dog:conditional', () => {
    expect(parseDogPolicy({ 'dog': 'yes', 'dog:conditional': 'no @ (Jun-Sep)' }).policy).toBe('all_day')
  })

  it.each([
    'yes @ night',
    'yes @ (22:00-07:00)',
    'yes @ (23:00-08:00)',
    'yes @ (00:00-09:00)',
    'yes @ (19:30-06:00)',
  ])('renvoie « night_only » pour dog:conditional=%s', (value) => {
    expect(parseDogPolicy({ 'dog:conditional': value })).toEqual({ policy: 'night_only', source: value })
  })

  it('lit aussi access:conditional pour la nuit', () => {
    expect(parseDogPolicy({ 'access:conditional': 'yes @ Night' })).toEqual({ policy: 'night_only', source: 'yes @ Night' })
  })

  it('préfère dog:conditional à access:conditional', () => {
    const result = parseDogPolicy({ 'dog:conditional': 'yes @ night', 'access:conditional': 'no @ (Jun-Sep)' })
    expect(result).toEqual({ policy: 'night_only', source: 'yes @ night' })
  })

  it.each([
    'no @ (Jun-Sep)',
    'no @ (10:00-20:00)',
    'NO @ summer',
  ])('renvoie « restricted » pour un conditionnel contenant « no » : %s', (value) => {
    expect(parseDogPolicy({ 'dog:conditional': value })).toEqual({ policy: 'restricted', source: value })
  })

  it('renvoie « restricted » via access:conditional', () => {
    expect(parseDogPolicy({ 'access:conditional': 'no @ (Jul-Aug)' }).policy).toBe('restricted')
  })

  it.each([
    'yes @ (Oct-May)',
    'leashed @ (Jun-Sep)',
  ])('renvoie « all_day » pour un autre conditionnel : %s', (value) => {
    expect(parseDogPolicy({ 'dog:conditional': value })).toEqual({ policy: 'all_day', source: value })
  })

  it('renvoie « unknown » sans tag chien', () => {
    expect(parseDogPolicy({})).toEqual({ policy: 'unknown', source: undefined })
    expect(parseDogPolicy({ name: 'Parc de la Tête d\'Or', leisure: 'park' })).toEqual({ policy: 'unknown', source: undefined })
  })

  it('renvoie « unknown » pour un dog:conditional vide', () => {
    expect(parseDogPolicy({ 'dog:conditional': '' })).toEqual({ policy: 'unknown', source: undefined })
  })

  describe('comportements suspects connus (bugs, ne pas corriger ici — agent donnees)', () => {
    // BUG : la détection de nuit utilise includes('1:00') / includes('2:00'),
    // qui est vrai pour « 11:00 », « 12:00 » ou « 21:00 ». Une restriction de
    // mi-journée est alors classée « night_only » au lieu de « restricted ».
    it.fails('classe « no @ (11:00-14:00) » en « restricted » (actuellement « night_only »)', () => {
      expect(parseDogPolicy({ 'dog:conditional': 'no @ (11:00-14:00)' }).policy).toBe('restricted')
    })

    it.fails('classe « yes @ (09:00-21:00) » en « all_day » (actuellement « night_only »)', () => {
      expect(parseDogPolicy({ 'dog:conditional': 'yes @ (09:00-21:00)' }).policy).toBe('all_day')
    })

    it.fails('classe « yes @ (Mo-Su 12:00-14:00) » hors « night_only » (actuellement « night_only »)', () => {
      expect(parseDogPolicy({ 'dog:conditional': 'yes @ (Mo-Su 12:00-14:00)' }).policy).not.toBe('night_only')
    })

    // BUG : includes('no') est vrai pour « Nov » / « november » : une
    // autorisation hivernale devient « restricted ».
    it.fails('classe « yes @ (Nov-Mar) » en « all_day » (actuellement « restricted »)', () => {
      expect(parseDogPolicy({ 'dog:conditional': 'yes @ (Nov-Mar)' }).policy).toBe('all_day')
    })

    it.fails('classe « yes @ november » en « all_day » (actuellement « restricted »)', () => {
      expect(parseDogPolicy({ 'dog:conditional': 'yes @ november' }).policy).toBe('all_day')
    })
  })
})

describe('resolveImage', () => {
  it('convertit un lien commons wiki/File: en Special:FilePath', () => {
    expect(resolveImage({ image: 'https://commons.wikimedia.org/wiki/File:Parc_Monceau.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Parc_Monceau.jpg?width=600')
  })

  it('encode les caractères spéciaux du nom de fichier', () => {
    expect(resolveImage({ image: 'https://commons.wikimedia.org/wiki/File:Café de Flore.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Caf%C3%A9%20de%20Flore.jpg?width=600')
  })

  it('renvoie telle quelle une URL directe', () => {
    expect(resolveImage({ image: 'https://example.org/photo.jpg' })).toBe('https://example.org/photo.jpg')
    expect(resolveImage({ image: 'http://example.org/photo.png' })).toBe('http://example.org/photo.png')
  })

  it('construit l\'URL à partir de wikimedia_commons=File:…, espaces remplacés par _', () => {
    expect(resolveImage({ wikimedia_commons: 'File:Jardin du Luxembourg.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Jardin_du_Luxembourg.jpg?width=600')
  })

  it('ignore wikimedia_commons=Category:…', () => {
    expect(resolveImage({ wikimedia_commons: 'Category:Parc des Buttes-Chaumont' })).toBeUndefined()
  })

  it('préfère une URL image à wikimedia_commons', () => {
    expect(resolveImage({ image: 'https://example.org/a.jpg', wikimedia_commons: 'File:B.jpg' })).toBe('https://example.org/a.jpg')
  })

  it('ignore une valeur image qui n\'est pas une URL', () => {
    expect(resolveImage({ image: 'photo.jpg' })).toBeUndefined()
    expect(resolveImage({ image: 'photo.jpg', wikimedia_commons: 'File:B.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/B.jpg?width=600')
  })

  it('renvoie undefined sans tag image', () => {
    expect(resolveImage({})).toBeUndefined()
  })
})
