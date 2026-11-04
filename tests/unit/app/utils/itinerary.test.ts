import { describe, expect, it } from 'vitest'
import {
  detectItineraryPlatform,
  ITINERARY_APP_LABELS,
  itineraryApps,
  itineraryUrl,
  type ItineraryApp,
} from '~/utils/itinerary'

/** Lieu au nom piégeux : accents, esperluette, guillemets, apostrophe. */
const BISTROT = { name: 'Café « L\'Étoile » & "Chiens"', lat: 48.8738, lon: 2.295 }

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ se présente comme un Mac (pas de « iPad » dans le UA).
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

describe('itineraryUrl', () => {
  it('Google Maps : destination seule, sans nom ni origine', () => {
    expect(itineraryUrl('google', BISTROT)).toBe('https://www.google.com/maps/dir/?api=1&destination=48.8738,2.295')
  })

  it('Apple Plans : destination + nom encodé (accents, &, guillemets)', () => {
    const url = itineraryUrl('apple', BISTROT)
    expect(url).toBe(`https://maps.apple.com/?daddr=48.8738,2.295&q=${encodeURIComponent(BISTROT.name)}`)
    // Le nom ne casse pas la requête : un seul `&` séparateur, aucun guillemet brut.
    expect(url).not.toContain('"')
    expect(url).not.toContain(' ')
    const params = new URL(url).searchParams
    expect([...params.keys()]).toEqual(['daddr', 'q'])
    expect(params.get('q')).toBe(BISTROT.name)
  })

  it('Waze : destination et navigation directe', () => {
    expect(itineraryUrl('waze', BISTROT)).toBe('https://waze.com/ul?ll=48.8738,2.295&navigate=yes')
  })

  it('arrondit les coordonnées à 6 décimales', () => {
    const place = { name: 'Parc', lat: 48.856614123456, lon: 2.352221987654 }
    expect(itineraryUrl('google', place)).toContain('destination=48.856614,2.352222')
    expect(itineraryUrl('waze', place)).toContain('ll=48.856614,2.352222')
  })

  it('jamais de notation exponentielle (coordonnées proches de 0, négatives)', () => {
    const url = itineraryUrl('google', { name: 'Équateur', lat: 0.0000004, lon: -0.000001 })
    expect(url).toContain('destination=0,-0.000001')
    expect(url).not.toMatch(/e-/)
    // Outre-mer (hémisphère sud, longitude ouest).
    expect(itineraryUrl('waze', { name: 'Plage', lat: -21.1151, lon: 55.5364 })).toContain('ll=-21.1151,55.5364')
  })

  it.each<ItineraryApp>(['google', 'apple', 'waze'])('%s : aucune position d\'origine dans le lien', (app) => {
    const params = new URL(itineraryUrl(app, BISTROT)).searchParams
    for (const key of ['origin', 'saddr', 'from', 'sll']) expect(params.has(key)).toBe(false)
  })
})

describe('detectItineraryPlatform', () => {
  it('iPhone → apple', () => {
    expect(detectItineraryPlatform(UA.iphone)).toBe('apple')
  })

  it('iPad en mode bureau (« Macintosh » tactile) → apple', () => {
    expect(detectItineraryPlatform(UA.ipadDesktop, 'MacIntel')).toBe('apple')
  })

  it('Android → android, même si la plateforme ressemble à Linux', () => {
    expect(detectItineraryPlatform(UA.android, 'Linux armv8l')).toBe('android')
  })

  it('Windows → other', () => {
    expect(detectItineraryPlatform(UA.windows, 'Win32')).toBe('other')
    expect(detectItineraryPlatform(UA.windows, 'Windows')).toBe('other')
  })

  it('plateforme seule (UA réduit) : iPhone → apple, Linux → other', () => {
    expect(detectItineraryPlatform('Mozilla/5.0', 'iPhone')).toBe('apple')
    expect(detectItineraryPlatform(UA.linux, 'Linux x86_64')).toBe('other')
  })

  it('UA vide → other', () => {
    expect(detectItineraryPlatform('')).toBe('other')
  })
})

describe('itineraryApps', () => {
  it('Apple : Apple Plans en premier', () => {
    expect(itineraryApps('apple')).toEqual(['apple', 'google', 'waze'])
  })

  it('Android et autres : Google Maps en premier', () => {
    expect(itineraryApps('android')).toEqual(['google', 'waze', 'apple'])
    expect(itineraryApps('other')).toEqual(['google', 'waze', 'apple'])
  })

  it('libellés en français pour chaque application', () => {
    expect(ITINERARY_APP_LABELS).toEqual({ google: 'Google Maps', apple: 'Apple Plans', waze: 'Waze' })
  })
})
