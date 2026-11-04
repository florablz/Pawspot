import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, isRef, onBeforeUnmount, ref, Suspense, toValue, watch } from 'vue'
import type { Place } from '#shared/types'
import IndexPage from '~/pages/index.vue'
import PlacePage from '~/pages/lieu/[id].vue'
import { getApiErrorMessage } from '~/utils/apiError'
import { pickMapQuery } from '~/utils/mapUrl'
import { isValidPlaceId, placeApiUrl, placePath } from '~/utils/placeUrl'
import { makePlace } from '../_helpers'

/**
 * Open Graph et lien canonique (§ partage) : base fixe `runtimeConfig.public.appUrl`,
 * jamais l'URL de la requête (en-tête Host forgeable derrière un proxy → empoisonnement
 * de cache). Pages montées sans Nuxt : `useSeoMeta` / `useHead` sont capturés.
 */
const APP_URL = 'https://pawspot.fr'
/** Hôte forgé : ne doit jamais apparaître dans les métadonnées. */
const FORGED = 'https://evil.example'

let seo: Record<string, unknown> = {}
let head: { link?: Array<{ rel: string, href: string }> } = {}
const useRequestURL = vi.fn(() => new URL(`${FORGED}/lieu/x`))
const data = ref<Place | null>(null)
const fetchError = ref<{ statusCode: number } | null>(null)
const route = { params: { id: '' }, query: {} as Record<string, string> }

beforeEach(() => {
  seo = {}
  head = {}
  data.value = null
  fetchError.value = null
  useRequestURL.mockClear()
  const autoImports = {
    computed, watch, onBeforeUnmount, getApiErrorMessage, pickMapQuery, isValidPlaceId, placeApiUrl, placePath,
  }
  for (const [name, fn] of Object.entries(autoImports)) vi.stubGlobal(name, fn)
  vi.stubGlobal('definePageMeta', () => {})
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { appUrl: APP_URL } }))
  vi.stubGlobal('useRequestURL', useRequestURL)
  vi.stubGlobal('useSeoMeta', (input: Record<string, unknown>) => {
    seo = input
  })
  vi.stubGlobal('useHead', (input: typeof head) => {
    head = input
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('usePlaceSheet', () => ({ selected: ref<Place | null>(null), close: vi.fn() }))
  vi.stubGlobal('usePlaces', () => ({ places: ref<Place[]>([]) }))
  vi.stubGlobal('useFetch', () => ({ data, error: fetchError, status: ref('success'), refresh: vi.fn() }))
  vi.stubGlobal('navigateTo', vi.fn())
  vi.stubGlobal('setResponseStatus', vi.fn())
  vi.stubGlobal('useRequestEvent', () => ({}))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

/** Valeur d'une métadonnée (chaîne, `ref`, `computed` ou fonction). */
const meta = (key: string) => {
  const v = seo[key]
  return typeof v === 'function' || isRef(v) ? toValue(v as () => unknown) : v
}

async function mountPlacePage(id: string) {
  route.params.id = id
  mount(defineComponent({
    render: () => h(Suspense, null, { default: () => h(PlacePage) }),
  }), { global: { stubs: { PlaceSheet: true, PlaceLoadNotice: true } } })
  await flushPromises()
}

describe('URL absolues Open Graph et canonique', () => {
  it('accueil : og:url et og:image sur APP_URL', () => {
    mount(IndexPage)
    expect(meta('ogUrl')).toBe(`${APP_URL}/`)
    expect(meta('ogImage')).toBe(`${APP_URL}/logo.png`)
    expect(useRequestURL).not.toHaveBeenCalled()
  })

  it('fiche d\'un lieu : og:url et lien canonique identiques, sur APP_URL avec l\'id encodé', async () => {
    const id = 'osm:node:42'
    data.value = makePlace({ id, name: 'Plage du Prado', category: 'beach' })
    await mountPlacePage(id)

    const expected = `${APP_URL}${placePath(id)}`
    expect(meta('ogUrl')).toBe(expected)
    expect(head.link).toEqual([{ rel: 'canonical', href: expected }])
    expect(meta('ogImage')).toBe(`${APP_URL}/logo.png`)
    expect(meta('ogTitle')).toBe('Plage du Prado — PawSpot')
    expect(useRequestURL).not.toHaveBeenCalled()
  })

  it('lieu introuvable : mêmes URL fixes, et noindex', async () => {
    fetchError.value = { statusCode: 404 }
    await mountPlacePage('osm:node:999')
    expect(meta('ogUrl')).toBe(`${APP_URL}${placePath('osm:node:999')}`)
    expect(meta('robots')).toBe('noindex')
    expect(useRequestURL).not.toHaveBeenCalled()
  })

  it('aucune métadonnée ne reprend l\'hôte de la requête', async () => {
    data.value = makePlace({ id: 'osm:way:7', name: 'Parc Borély' })
    await mountPlacePage('osm:way:7')
    const values = [...Object.keys(seo).map(meta), ...(head.link ?? []).map(l => l.href)]
    expect(values.some(v => typeof v === 'string' && v.includes('evil.example'))).toBe(false)
  })
})
