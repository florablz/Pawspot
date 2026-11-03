import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive } from 'vue'
import { useLoginLink } from '~/composables/useLoginLink'
import { AUTH_PATHS, safeRedirect } from '~/utils/redirect'

/** Route actuelle simulée (`useRoute` de Nuxt). */
const route = reactive<{ path: string, fullPath: string, query: Record<string, string | string[] | undefined> }>({ path: '/', fullPath: '/', query: {} })

function goTo(fullPath: string) {
  const url = new URL(fullPath, 'http://localhost')
  route.path = url.pathname
  route.fullPath = fullPath
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key)
    query[key] = all.length > 1 ? all : all[0]!
  }
  route.query = query
}

beforeEach(() => {
  goTo('/')
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('AUTH_PATHS', AUTH_PATHS)
  vi.stubGlobal('safeRedirect', safeRedirect)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useLoginLink', () => {
  it('depuis l\'accueil : liens simples, sans ?redirect', () => {
    const { redirect, loginLink, registerLink } = useLoginLink()
    expect(redirect.value).toBe('/')
    expect(loginLink.value).toBe('/login')
    expect(registerLink.value).toBe('/register')
  })

  it('depuis une fiche ou une page : ramène à la route complète', () => {
    goTo('/?place=osm%3Anode%3A1')
    const { loginLink, registerLink } = useLoginLink()
    expect(loginLink.value).toEqual({ path: '/login', query: { redirect: '/?place=osm%3Anode%3A1' } })
    expect(registerLink.value).toEqual({ path: '/register', query: { redirect: '/?place=osm%3Anode%3A1' } })
  })

  it('suit les changements de route', () => {
    const { loginLink } = useLoginLink()
    goTo('/favorites?x=1')
    expect(loginLink.value).toEqual({ path: '/login', query: { redirect: '/favorites?x=1' } })
  })

  it('depuis /login : transmet le redirect reçu (pas /login lui-même)', () => {
    goTo('/login?redirect=%2Ffavorites')
    const { redirect, registerLink } = useLoginLink()
    expect(redirect.value).toBe('/favorites')
    expect(registerLink.value).toEqual({ path: '/register', query: { redirect: '/favorites' } })
  })

  it('depuis /register avec un redirect externe : retour à l\'accueil', () => {
    goTo('/register?redirect=%2F%2Fexemple.fr')
    const { redirect, loginLink } = useLoginLink()
    expect(redirect.value).toBe('/')
    expect(loginLink.value).toBe('/login')
  })

  it('depuis /login sans redirect : liens simples', () => {
    goTo('/login')
    expect(useLoginLink().registerLink.value).toBe('/register')
  })
})
