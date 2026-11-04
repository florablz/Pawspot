import { describe, expect, it } from 'vitest'
import {
  filtersToQuery,
  mergeMapQuery,
  parseFiltersQuery,
  parseViewQuery,
  pickMapQuery,
  sameQuery,
  URL_MAX_ZOOM,
  URL_MIN_ZOOM,
  viewToQuery,
} from '~/utils/mapUrl'

describe('parseViewQuery — vue de la carte dans l\'URL', () => {
  it('lit le centre et le zoom quand les trois clés sont valides', () => {
    expect(parseViewQuery({ lat: '48.8566', lon: '2.3522', z: '15' })).toEqual({ lat: 48.8566, lng: 2.3522, zoom: 15 })
  })

  it('accepte les espaces autour des nombres et les coordonnées négatives', () => {
    expect(parseViewQuery({ lat: ' 43.2965 ', lon: '-1.5536', z: '12' })).toEqual({ lat: 43.2965, lng: -1.5536, zoom: 12 })
  })

  it('prend la première valeur d\'une clé répétée', () => {
    expect(parseViewQuery({ lat: ['45.76', '0'], lon: '4.835', z: '14' })).toEqual({ lat: 45.76, lng: 4.835, zoom: 14 })
  })

  it.each([
    ['lat seul', { lat: '48.85' }],
    ['lat et lon sans zoom', { lat: '48.85', lon: '2.35' }],
    ['zoom sans centre', { z: '15' }],
    ['lon manquant', { lat: '48.85', z: '15' }],
    ['aucune clé', {}],
  ])('ignore une vue partielle (%s)', (_label, query) => {
    expect(parseViewQuery(query)).toBeNull()
  })

  it.each([
    ['latitude non numérique', { lat: 'abc', lon: '2.35', z: '15' }],
    ['latitude vide', { lat: '', lon: '2.35', z: '15' }],
    ['latitude infinie', { lat: 'Infinity', lon: '2.35', z: '15' }],
    ['valeur nulle', { lat: null, lon: '2.35', z: '15' }],
    ['zoom non entier', { lat: '48.85', lon: '2.35', z: '15.5' }],
  ])('ignore une vue invalide (%s)', (_label, query) => {
    expect(parseViewQuery(query)).toBeNull()
  })

  it('borne la latitude à ±85 et la longitude à ±180', () => {
    expect(parseViewQuery({ lat: '85', lon: '180', z: '5' })).toEqual({ lat: 85, lng: 180, zoom: 5 })
    expect(parseViewQuery({ lat: '-85', lon: '-180', z: '5' })).toEqual({ lat: -85, lng: -180, zoom: 5 })
    expect(parseViewQuery({ lat: '85.01', lon: '2', z: '5' })).toBeNull()
    expect(parseViewQuery({ lat: '-85.01', lon: '2', z: '5' })).toBeNull()
    expect(parseViewQuery({ lat: '48', lon: '180.1', z: '5' })).toBeNull()
    expect(parseViewQuery({ lat: '48', lon: '-180.1', z: '5' })).toBeNull()
  })

  it(`borne le zoom entre ${URL_MIN_ZOOM} et ${URL_MAX_ZOOM}`, () => {
    expect(parseViewQuery({ lat: '48', lon: '2', z: String(URL_MIN_ZOOM) })?.zoom).toBe(URL_MIN_ZOOM)
    expect(parseViewQuery({ lat: '48', lon: '2', z: String(URL_MAX_ZOOM) })?.zoom).toBe(URL_MAX_ZOOM)
    expect(parseViewQuery({ lat: '48', lon: '2', z: String(URL_MIN_ZOOM - 1) })).toBeNull()
    expect(parseViewQuery({ lat: '48', lon: '2', z: String(URL_MAX_ZOOM + 1) })).toBeNull()
  })
})

describe('parseFiltersQuery — filtres dans l\'URL', () => {
  it('sans clé : aucun filtre', () => {
    expect(parseFiltersQuery({})).toEqual({ categories: [], confirmedOnly: false })
  })

  it('lit les catégories séparées par des virgules, sans doublon', () => {
    expect(parseFiltersQuery({ cat: 'park, cafe,park' }).categories).toEqual(['park', 'cafe'])
  })

  it('ignore les catégories inconnues et les morceaux vides', () => {
    expect(parseFiltersQuery({ cat: 'park,piscine,,constructor,CAFE,vet' }).categories).toEqual(['park', 'vet'])
  })

  it('« confirmes » n\'est actif qu\'avec la valeur 1', () => {
    expect(parseFiltersQuery({ confirmes: '1' }).confirmedOnly).toBe(true)
    expect(parseFiltersQuery({ confirmes: '0' }).confirmedOnly).toBe(false)
    expect(parseFiltersQuery({ confirmes: 'true' }).confirmedOnly).toBe(false)
    expect(parseFiltersQuery({ confirmes: '' }).confirmedOnly).toBe(false)
  })
})

describe('viewToQuery / filtersToQuery — écriture dans l\'URL', () => {
  it('arrondit les coordonnées à 3 décimales (≈ 100 m, pas de domicile dans un lien) sans zéros inutiles et le zoom à l\'entier', () => {
    expect(viewToQuery({ lat: 48.856614, lng: 2.3522219, zoom: 15 })).toEqual({ lat: '48.857', lon: '2.352', z: '15' })
    expect(viewToQuery({ lat: -21.11519, lng: 55.53639, zoom: 14 })).toEqual({ lat: '-21.115', lon: '55.536', z: '14' })
    expect(viewToQuery({ lat: 45.5, lng: 4, zoom: 12.4 })).toEqual({ lat: '45.5', lon: '4', z: '12' })
  })

  it('aller-retour : la vue écrite se relit à l\'identique', () => {
    const view = { lat: 43.297, lng: 5.37, zoom: 14 }
    expect(parseViewQuery(viewToQuery(view))).toEqual(view)
  })

  it('retire les clés des filtres inactifs', () => {
    expect(filtersToQuery({ categories: [], confirmedOnly: false })).toEqual({ cat: undefined, confirmes: undefined })
    expect(filtersToQuery({ categories: ['park', 'cafe'], confirmedOnly: true })).toEqual({ cat: 'park,cafe', confirmes: '1' })
  })
})

describe('pickMapQuery', () => {
  it('ne garde que les clés de la carte (première valeur)', () => {
    expect(pickMapQuery({ lat: '48.8', lon: '2.3', z: '15', cat: ['park', 'cafe'], confirmes: '1', utm_source: 'x', redirect: '/' }))
      .toEqual({ lat: '48.8', lon: '2.3', z: '15', cat: 'park', confirmes: '1' })
  })

  it('omet les clés absentes ou nulles', () => {
    expect(pickMapQuery({ cat: 'park', z: null })).toEqual({ cat: 'park' })
  })
})

describe('mergeMapQuery', () => {
  it('remplace les clés du patch et garde les autres clés de l\'URL', () => {
    expect(mergeMapQuery({ lat: '1', lon: '2', z: '3', ref: 'partage' }, { lat: '48.8', lon: '2.3', z: '15' }))
      .toEqual({ lat: '48.8', lon: '2.3', z: '15', ref: 'partage' })
  })

  it('retire les clés du patch valant undefined', () => {
    expect(mergeMapQuery({ cat: 'park', confirmes: '1', z: '15' }, { cat: undefined, confirmes: undefined }))
      .toEqual({ z: '15' })
  })

  it('ne modifie pas la query d\'origine', () => {
    const query = { cat: 'park' }
    mergeMapQuery(query, { cat: undefined, z: '12' })
    expect(query).toEqual({ cat: 'park' })
  })
})

describe('sameQuery', () => {
  it('ignore l\'ordre des clés', () => {
    expect(sameQuery({ lat: '1', lon: '2' }, { lon: '2', lat: '1' })).toBe(true)
  })

  it('ignore les clés valant undefined', () => {
    expect(sameQuery({ lat: '1', cat: undefined }, { lat: '1' })).toBe(true)
  })

  it('distingue une valeur ou une clé différente', () => {
    expect(sameQuery({ lat: '1' }, { lat: '2' })).toBe(false)
    expect(sameQuery({ lat: '1' }, { lat: '1', z: '3' })).toBe(false)
  })
})
