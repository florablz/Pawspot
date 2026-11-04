import * as L from 'leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOG_STATUS_MARKER } from '~/utils/dogStatusDisplay'
import {
  clusterCountText,
  clusterIcon,
  clusterLabel,
  clusterSize,
  MARKER_HIT_SIZE,
  placeIcon,
} from '~/utils/markerIcons'

// Auto-import Nuxt utilisé par `placeIcon` (pastille du statut chien).
beforeEach(() => {
  vi.stubGlobal('DOG_STATUS_MARKER', DOG_STATUS_MARKER)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clusterLabel', () => {
  it('singulier pour un lieu', () => {
    expect(clusterLabel(1)).toBe('1 lieu, zoomer pour les voir')
  })

  it('pluriel au-delà', () => {
    expect(clusterLabel(2)).toBe('2 lieux, zoomer pour les voir')
    expect(clusterLabel(12)).toBe('12 lieux, zoomer pour les voir')
  })
})

describe('clusterSize', () => {
  it.each([1, 2, 99, 100, 999, 1000, 25_000])('%i lieux : zone cliquable d\'au moins 44 px', (count) => {
    expect(clusterSize(count)).toBeGreaterThanOrEqual(MARKER_HIT_SIZE)
    expect(MARKER_HIT_SIZE).toBeGreaterThanOrEqual(44)
  })

  it('grandit avec le nombre de lieux', () => {
    expect(clusterSize(100)).toBeGreaterThan(clusterSize(99))
    expect(clusterSize(1000)).toBeGreaterThan(clusterSize(999))
  })
})

describe('clusterCountText', () => {
  it('nombre brut jusqu\'à 9 999', () => {
    expect(clusterCountText(7)).toBe('7')
    expect(clusterCountText(9999)).toBe('9999')
  })

  it('« k » au-delà, à la française (virgule)', () => {
    expect(clusterCountText(12_345)).toBe('12,3 k')
    expect(clusterCountText(10_000)).toBe('10 k')
  })
})

describe('clusterIcon', () => {
  it('pose l\'aria-label sur l\'élément créé ; le nombre visible est masqué aux lecteurs d\'écran', () => {
    const el = clusterIcon(L, 12).createIcon()
    expect(el.getAttribute('aria-label')).toBe('12 lieux, zoomer pour les voir')
    const disc = el.querySelector('.paw-cluster__disc')!
    expect(disc.textContent).toBe('12')
    expect(disc.getAttribute('aria-hidden')).toBe('true')
    expect(el.classList.contains('paw-cluster')).toBe(true)
  })

  it('réutilise l\'élément existant et y remet l\'aria-label', () => {
    const icon = clusterIcon(L, 1)
    const old = document.createElement('div')
    const el = icon.createIcon(old)
    expect(el).toBe(old)
    expect(el.getAttribute('aria-label')).toBe('1 lieu, zoomer pour les voir')
  })

  it('taille de l\'icône = clusterSize, ancrée au centre', () => {
    const options = clusterIcon(L, 150).options
    expect(options.iconSize).toEqual([52, 52])
    expect(options.iconAnchor).toEqual([26, 26])
  })
})

describe('placeIcon', () => {
  it('même catégorie, même statut, même état : même icône (cache)', () => {
    const a = placeIcon(L, { category: 'park', dogStatus: 'confirmed' }, false)
    const b = placeIcon(L, { category: 'park', dogStatus: 'confirmed' }, false)
    expect(b).toBe(a)
  })

  it('icône distincte si la catégorie, le statut ou la sélection change', () => {
    const base = placeIcon(L, { category: 'cafe', dogStatus: 'unknown' }, false)
    expect(placeIcon(L, { category: 'cafe', dogStatus: 'unknown' }, true)).not.toBe(base)
    expect(placeIcon(L, { category: 'cafe', dogStatus: 'refused' }, false)).not.toBe(base)
    expect(placeIcon(L, { category: 'bar', dogStatus: 'unknown' }, false)).not.toBe(base)
  })

  it('zone cliquable d\'au moins 44 px, sélectionné ou non', () => {
    for (const selected of [false, true]) {
      const [w, h] = placeIcon(L, { category: 'restaurant', dogStatus: 'osm_yes' }, selected).options.iconSize as [number, number]
      expect(w).toBeGreaterThanOrEqual(44)
      expect(h).toBeGreaterThanOrEqual(44)
    }
  })
})
