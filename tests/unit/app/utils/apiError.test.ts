import { describe, expect, it } from 'vitest'
import { getApiErrorMessage } from '~/utils/apiError'

const FALLBACK = 'Message de repli'

describe('getApiErrorMessage', () => {
  it('renvoie data.message en priorité', () => {
    const err = { data: { message: 'Email déjà utilisé' }, statusMessage: 'Conflict' }
    expect(getApiErrorMessage(err, FALLBACK)).toBe('Email déjà utilisé')
  })

  it('renvoie statusMessage quand data.message est absent', () => {
    expect(getApiErrorMessage({ data: {}, statusMessage: 'Le service de cartes est saturé' }, FALLBACK))
      .toBe('Le service de cartes est saturé')
    expect(getApiErrorMessage({ statusMessage: 'Non autorisé' }, FALLBACK)).toBe('Non autorisé')
  })

  it('ignore un data.message vide ou non textuel', () => {
    expect(getApiErrorMessage({ data: { message: '' }, statusMessage: 'Statut' }, FALLBACK)).toBe('Statut')
    expect(getApiErrorMessage({ data: { message: 42 }, statusMessage: 'Statut' }, FALLBACK)).toBe('Statut')
  })

  it('ignore un data qui n\'est pas un objet', () => {
    expect(getApiErrorMessage({ data: 'texte brut', statusMessage: 'Statut' }, FALLBACK)).toBe('Statut')
    expect(getApiErrorMessage({ data: null }, FALLBACK)).toBe(FALLBACK)
  })

  it('renvoie le repli quand statusMessage est vide ou non textuel', () => {
    expect(getApiErrorMessage({ statusMessage: '' }, FALLBACK)).toBe(FALLBACK)
    expect(getApiErrorMessage({ statusMessage: 500 }, FALLBACK)).toBe(FALLBACK)
  })

  it('renvoie le repli pour une Error standard (message interne non exposé)', () => {
    expect(getApiErrorMessage(new Error('ECONNREFUSED 127.0.0.1'), FALLBACK)).toBe(FALLBACK)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['une chaîne', 'boom'],
    ['un nombre', 404],
    ['un booléen', true],
  ])('renvoie le repli pour %s', (_label, value) => {
    expect(getApiErrorMessage(value, FALLBACK)).toBe(FALLBACK)
  })
})
