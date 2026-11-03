import { describe, expect, it } from 'vitest'
import { resolveImage, sanitizeHttpUrl, sanitizeImageUrl, sanitizeWebsite } from '../../../../shared/url'

describe('sanitizeWebsite', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:contact@exemple.fr',
    'ftp://exemple.fr/fichier',
    'tel:+33102030405',
  ])('refuse le schéma non http(s) : %s', (value) => {
    expect(sanitizeWebsite(value)).toBeUndefined()
  })

  it.each([
    'https://user:pass@exemple.fr',
    'https://user@exemple.fr',
    'user:pass@exemple.fr',
  ])('refuse une URL avec identifiants : %s', (value) => {
    expect(sanitizeWebsite(value)).toBeUndefined()
  })

  it.each(['http://localhost', 'localhost:3000', 'https://intranet', 'https://exemple.fr.'])('refuse un hôte sans point : %s', (value) => {
    expect(sanitizeWebsite(value)).toBeUndefined()
  })

  it.each(['https://exemple .fr', 'www.mon site.fr', 'https://exemple.fr/\tmenu'])('refuse une valeur avec des espaces : %s', (value) => {
    expect(sanitizeWebsite(value)).toBeUndefined()
  })

  it.each([undefined, null, '', '   ', ';'])('refuse une valeur vide : %o', (value) => {
    expect(sanitizeWebsite(value)).toBeUndefined()
  })

  it('refuse une URL trop longue', () => {
    expect(sanitizeWebsite(`https://exemple.fr/${'a'.repeat(2100)}`)).toBeUndefined()
  })

  it('ajoute https:// à une valeur sans schéma', () => {
    expect(sanitizeWebsite('www.x.fr')).toBe('https://www.x.fr/')
    expect(sanitizeWebsite('exemple.fr/menu')).toBe('https://exemple.fr/menu')
  })

  it('complète une URL relative au protocole (//x.fr)', () => {
    expect(sanitizeWebsite('//x.fr')).toBe('https://x.fr/')
  })

  it('garde les URL http et https, normalisées', () => {
    expect(sanitizeWebsite('https://www.cafe-de-flore.fr')).toBe('https://www.cafe-de-flore.fr/')
    expect(sanitizeWebsite('  HTTP://Exemple.FR/Menu?x=1  ')).toBe('http://exemple.fr/Menu?x=1')
  })

  it('ne garde que la première de plusieurs valeurs séparées par « ; »', () => {
    expect(sanitizeWebsite('https://a.fr;https://b.fr')).toBe('https://a.fr/')
    expect(sanitizeWebsite('a.fr; b.fr')).toBe('https://a.fr/')
    expect(sanitizeWebsite('javascript:alert(1);https://b.fr')).toBeUndefined()
  })
})

describe('sanitizeHttpUrl', () => {
  it('n\'ajoute pas de schéma', () => {
    expect(sanitizeHttpUrl('exemple.fr')).toBeUndefined()
    expect(sanitizeHttpUrl('https://exemple.fr/a.jpg')).toBe('https://exemple.fr/a.jpg')
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeUndefined()
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

  it('renvoie une URL directe https', () => {
    expect(resolveImage({ image: 'https://example.org/photo.jpg' })).toBe('https://example.org/photo.jpg')
  })

  it('refuse une image en http: (contenu mixte), même sur commons', () => {
    expect(resolveImage({ image: 'http://example.org/photo.png' })).toBeUndefined()
    expect(resolveImage({ image: 'HTTP://example.org/photo.png' })).toBeUndefined()
    expect(resolveImage({ image: 'http://commons.wikimedia.org/wiki/File:A.jpg' })).toBeUndefined()
  })

  it('se replie sur wikimedia_commons quand image est en http:', () => {
    expect(resolveImage({ image: 'http://example.org/a.jpg', wikimedia_commons: 'File:B.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/B.jpg?width=600')
  })

  it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'photo.jpg', 'https://user:pass@exemple.fr/a.jpg'])('refuse image=%s', (image) => {
    expect(resolveImage({ image })).toBeUndefined()
  })

  it('construit l\'URL à partir de wikimedia_commons=File:…, espaces remplacés par _', () => {
    expect(resolveImage({ wikimedia_commons: 'File:Jardin du Luxembourg.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Jardin_du_Luxembourg.jpg?width=600')
  })

  it('ignore wikimedia_commons=Category:…', () => {
    expect(resolveImage({ wikimedia_commons: 'Category:Parc des Buttes-Chaumont' })).toBeUndefined()
  })

  it('préfère une URL image à wikimedia_commons, et se replie sur wikimedia_commons sinon', () => {
    expect(resolveImage({ image: 'https://example.org/a.jpg', wikimedia_commons: 'File:B.jpg' })).toBe('https://example.org/a.jpg')
    expect(resolveImage({ image: 'photo.jpg', wikimedia_commons: 'File:B.jpg' }))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/B.jpg?width=600')
  })

  it('renvoie undefined sans tag image', () => {
    expect(resolveImage({})).toBeUndefined()
  })
})

describe('sanitizeImageUrl', () => {
  it('garde une URL https valide, normalisée', () => {
    expect(sanitizeImageUrl('  https://exemple.fr/photo.jpg ')).toBe('https://exemple.fr/photo.jpg')
    expect(sanitizeImageUrl('HTTPS://Exemple.fr/a.jpg')).toBe('https://exemple.fr/a.jpg')
  })

  it.each([
    'http://exemple.fr/photo.jpg',
    '//exemple.fr/photo.jpg',
    'exemple.fr/photo.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user:pass@exemple.fr/a.jpg',
    'https://localhost/a.jpg',
    '',
  ])('refuse %s', (value) => {
    expect(sanitizeImageUrl(value)).toBeUndefined()
  })

  it('refuse null, undefined et les valeurs non texte', () => {
    expect(sanitizeImageUrl(null)).toBeUndefined()
    expect(sanitizeImageUrl(undefined)).toBeUndefined()
    expect(sanitizeImageUrl(42 as unknown as string)).toBeUndefined()
  })
})
