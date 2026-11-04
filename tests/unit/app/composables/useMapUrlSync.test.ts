import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { CategoryKey } from '#shared/categories'
import { useMapUrlSync } from '~/composables/useMapUrlSync'
import type { MapView } from '~/types/map'
import { filtersToQuery, mergeMapQuery, sameQuery, viewToQuery } from '~/utils/mapUrl'

type Query = Record<string, string | undefined>
interface Target { path: string, query: Query, hash: string }

/** Route et routeur simulés : `replace` met à jour la route, les gardes sont appelables à la main. */
const route = reactive<{ path: string, query: Query, hash: string }>({ path: '/', query: {}, hash: '' })
const guards = { before: [] as Array<() => void>, after: [] as Array<() => void> }
const replace = vi.fn((to: Target) => {
  route.path = to.path
  route.query = { ...to.query }
  route.hash = to.hash
})
const router = {
  replace,
  beforeEach: vi.fn((fn: () => void) => {
    guards.before.push(fn)
    return () => { guards.before = guards.before.filter(g => g !== fn) }
  }),
  afterEach: vi.fn((fn: () => void) => {
    guards.after.push(fn)
    return () => { guards.after = guards.after.filter(g => g !== fn) }
  }),
}
const startNavigation = () => guards.before.forEach(g => g())
const endNavigation = () => guards.after.forEach(g => g())

const view = ref<MapView | null>(null)
const settled = ref(false)
/** Carte centrée sur la position de l'utilisateur (vue retirée de l'URL). */
const centeredOnUser = ref(false)
const categories = ref<CategoryKey[]>([])
const confirmedOnly = ref(false)

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(route, { path: '/', query: {}, hash: '' })
  guards.before = []
  guards.after = []
  replace.mockClear()
  view.value = null
  settled.value = false
  centeredOnUser.value = false
  categories.value = []
  confirmedOnly.value = false
  for (const [name, fn] of Object.entries({ watch, onBeforeUnmount, viewToQuery, filtersToQuery, mergeMapQuery, sameQuery })) {
    vi.stubGlobal(name, fn)
  }
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('useMapView', () => ({ view, settled, centeredOnUser }))
  vi.stubGlobal('useFilters', () => ({ categories, confirmedOnly }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

function start() {
  return mount(defineComponent({
    setup() {
      useMapUrlSync()
      return () => h('div')
    },
  }))
}

const PARIS: MapView = { center: { lat: 48.856614, lng: 2.3522219 }, zoom: 15, bbox: '2.33,48.84,2.37,48.87' }
const LYON: MapView = { center: { lat: 45.764, lng: 4.8357 }, zoom: 14, bbox: '4.81,45.75,4.86,45.78' }

/** Laisse les observateurs Vue réagir, puis avance le temps. */
async function wait(ms: number) {
  await nextTick()
  vi.advanceTimersByTime(ms)
}

describe('useMapUrlSync — vue de la carte', () => {
  it('recopie la vue en replace 400 ms après la fin du déplacement', async () => {
    start()
    settled.value = true
    view.value = PARIS
    await wait(399)
    expect(replace).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith({ path: '/', query: { lat: '48.857', lon: '2.352', z: '15' }, hash: '' })
  })

  it('déplacements rapprochés : une seule écriture, avec la dernière vue', async () => {
    start()
    settled.value = true
    view.value = PARIS
    await wait(300)
    view.value = LYON
    await wait(300)
    expect(replace).not.toHaveBeenCalled()
    await wait(100)
    expect(replace).toHaveBeenCalledOnce()
    expect(route.query).toMatchObject({ lat: '45.764', lon: '4.836', z: '14' })
  })

  it('n\'écrit pas la vue tant que la position de départ n\'est pas trouvée', async () => {
    start()
    view.value = PARIS
    await wait(1000)
    expect(replace).not.toHaveBeenCalled()
  })

  it('n\'écrit rien si l\'URL contient déjà cette vue', async () => {
    route.query = { lat: '48.857', lon: '2.352', z: '15' }
    start()
    settled.value = true
    view.value = PARIS
    await wait(400)
    expect(replace).not.toHaveBeenCalled()
  })

  it('garde le chemin, le hash et les autres clés de l\'URL', async () => {
    Object.assign(route, { path: '/lieu/osm%3Anode%3A1', query: { ref: 'partage' }, hash: '#avis' })
    start()
    settled.value = true
    view.value = PARIS
    await wait(400)
    expect(replace).toHaveBeenCalledWith({
      path: '/lieu/osm%3Anode%3A1',
      query: { ref: 'partage', lat: '48.857', lon: '2.352', z: '15' },
      hash: '#avis',
    })
  })

  it('n\'utilise jamais push (aucune entrée d\'historique ajoutée)', async () => {
    const push = vi.fn()
    Object.assign(router, { push })
    start()
    settled.value = true
    view.value = PARIS
    categories.value = ['park']
    await wait(400)
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalled()
    Reflect.deleteProperty(router, 'push')
  })
})

describe('useMapUrlSync — position de l\'utilisateur jamais dans l\'URL', () => {
  it('carte centrée sur la géolocalisation : aucune vue écrite', async () => {
    start()
    settled.value = true
    centeredOnUser.value = true
    view.value = PARIS
    await wait(400)
    expect(route.query).not.toHaveProperty('lat')
    expect(route.query).not.toHaveProperty('lon')
    expect(route.query).not.toHaveProperty('z')
  })

  it('« Me localiser » après une vue partagée : lat / lon / z retirés de l\'URL', async () => {
    route.query = { lat: '48.857', lon: '2.352', z: '15', ref: 'partage' }
    start()
    settled.value = true
    view.value = PARIS
    centeredOnUser.value = true
    await wait(0)
    expect(replace).toHaveBeenCalled()
    expect(route.query).toEqual({ ref: 'partage' })
  })

  it('déplacée ensuite par l\'utilisateur : la vue redevient partageable', async () => {
    start()
    settled.value = true
    centeredOnUser.value = true
    view.value = PARIS
    await wait(400)
    centeredOnUser.value = false
    await wait(400)
    expect(route.query).toMatchObject({ lat: '48.857', lon: '2.352', z: '15' })
  })
})

describe('useMapUrlSync — filtres', () => {
  it('recopie les filtres tout de suite', async () => {
    start()
    categories.value = ['park', 'cafe']
    confirmedOnly.value = true
    await wait(0)
    expect(replace).toHaveBeenCalledOnce()
    expect(route.query).toEqual({ cat: 'park,cafe', confirmes: '1' })
  })

  it('retire les clés des filtres désactivés', async () => {
    route.query = { cat: 'park', confirmes: '1', z: '15', lat: '48.8', lon: '2.3' }
    categories.value = ['park']
    confirmedOnly.value = true
    start()
    categories.value = []
    confirmedOnly.value = false
    await wait(0)
    expect(route.query).toEqual({ z: '15', lat: '48.8', lon: '2.3' })
  })

  it('suit une modification en place de la liste des catégories', async () => {
    start()
    categories.value.push('vet')
    await wait(0)
    expect(route.query).toEqual({ cat: 'vet' })
  })

  it('un filtre changé pendant l\'attente de la vue écrit vue et filtres ensemble', async () => {
    start()
    settled.value = true
    view.value = PARIS
    await wait(100)
    categories.value = ['beach']
    await wait(0)
    expect(replace).toHaveBeenCalledOnce()
    expect(route.query).toEqual({ lat: '48.857', lon: '2.352', z: '15', cat: 'beach' })
  })
})

describe('useMapUrlSync — navigations', () => {
  it('ne remplace jamais l\'URL pendant une navigation, puis reprend après', async () => {
    start()
    settled.value = true
    view.value = PARIS
    await wait(100)
    startNavigation()
    await wait(300)
    expect(replace).not.toHaveBeenCalled()
    await wait(2000)
    expect(replace).not.toHaveBeenCalled()
    endNavigation()
    await wait(400)
    expect(replace).toHaveBeenCalledOnce()
  })

  it('après un changement de page, remet la vue actuelle dans la nouvelle URL', async () => {
    route.query = { lat: '48.857', lon: '2.352', z: '15' }
    view.value = PARIS
    settled.value = true
    start()
    // « Retour » vers une entrée dont la query date : la vue actuelle y est remise aussitôt.
    startNavigation()
    Object.assign(route, { path: '/lieu/osm%3Anode%3A7', query: { lat: '45', lon: '4', z: '10' } })
    endNavigation()
    await wait(0)
    expect(replace).toHaveBeenCalledWith({ path: '/lieu/osm%3Anode%3A7', query: { lat: '48.857', lon: '2.352', z: '15' }, hash: '' })
  })

  it('au démontage : plus d\'écriture et gardes du routeur retirées', async () => {
    const wrapper = start()
    expect(guards.before).toHaveLength(1)
    expect(guards.after).toHaveLength(1)
    settled.value = true
    view.value = PARIS
    await nextTick()
    wrapper.unmount()
    vi.advanceTimersByTime(1000)
    expect(replace).not.toHaveBeenCalled()
    expect(guards.before).toHaveLength(0)
    expect(guards.after).toHaveLength(0)
  })
})
