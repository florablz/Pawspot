import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_PHOTO_MAX_LENGTH } from '~~/shared/schemas'
import { fetchMock, setupApi } from './_setup'
import type { ApiBench } from './_setup'

interface ApiErrorBody { statusCode: number; message: string }
interface Review {
  id: number
  placeId: string
  rating: number
  comment: string | null
  photos: string[]
  username: string
  avatarUrl: string | null
  createdAt: string
}

let api: ApiBench
let alice: { id: number; email: string; session: string }
let bob: { id: number; email: string; session: string }
const PLACE = 'user:demo-1'
const PHOTO = 'data:image/webp;base64,UklGRiQAAABXRUJQ'

function bigPhoto(length: number) {
  const prefix = 'data:image/jpeg;base64,'
  return prefix + 'A'.repeat(length - prefix.length)
}

beforeAll(async () => {
  api = await setupApi()
  await api.insertPlace({ id: PLACE, name: 'Café démo' })
  alice = await api.createUser('alice')
  bob = await api.createUser('bob')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  fetchMock.mockReset()
  await api.db.delete(api.schema.reviews)
})

const post = (body: unknown, session = alice.session) => api.request<Review & ApiErrorBody>('POST', '/api/reviews', { session, body })

describe('POST /api/reviews — refus', () => {
  it('sans session : 401', async () => {
    const res = await api.request('POST', '/api/reviews', { body: { placeId: PLACE, rating: 5 } })
    expect(res.status).toBe(401)
  })

  it.each([
    ['note 7', { placeId: PLACE, rating: 7 }, 'Note entre 1 et 5 requise'],
    ['note 0', { placeId: PLACE, rating: 0 }, 'Note entre 1 et 5 requise'],
    ['note 3.5', { placeId: PLACE, rating: 3.5 }, 'La note doit être un nombre entier'],
    ['note en texte', { placeId: PLACE, rating: '5' }, 'Note entre 1 et 5 requise'],
    ['sans note', { placeId: PLACE }, 'Note entre 1 et 5 requise'],
    ['photo https://', { placeId: PLACE, rating: 5, photos: ['https://exemple.fr/chien.jpg'] }, 'Photo invalide : image JPEG, PNG ou WebP attendue'],
    ['photo SVG', { placeId: PLACE, rating: 5, photos: ['data:image/svg+xml;base64,PHN2Zz4='] }, 'Photo invalide : image JPEG, PNG ou WebP attendue'],
    ['6 photos', { placeId: PLACE, rating: 5, photos: Array.from({ length: 6 }, () => PHOTO) }, '5 photos maximum'],
    ['commentaire de 1001 caractères', { placeId: PLACE, rating: 5, comment: 'a'.repeat(1001) }, 'Commentaire trop long (1000 caractères maximum)'],
    ['placeId invalide', { placeId: 'node-1', rating: 5 }, 'Identifiant de lieu invalide'],
  ])('%s : 400', async (_label, body, message) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, message })
  })

  it(`photo de plus de ${REVIEW_PHOTO_MAX_LENGTH} caractères : 400`, async () => {
    const res = await post({ placeId: PLACE, rating: 5, photos: [bigPhoto(REVIEW_PHOTO_MAX_LENGTH + 1)] })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Photo trop lourde (2 Mo maximum)')
  })

  it.each([
    ['corps vide', undefined, 'Corps de la requête manquant ou invalide'],
    ['corps null', 'null', 'Corps de la requête manquant ou invalide'],
    ['JSON cassé', '{"placeId": "user:demo-1", "rating": ', 'Corps de la requête illisible (JSON attendu)'],
  ])('%s : 400', async (_label, body, message) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ statusCode: 400, message })
  })

  it('lieu inconnu : 404', async () => {
    const res = await post({ placeId: 'user:inconnu', rating: 4 })
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Lieu introuvable')
  })

  it('aucun avis enregistré après ces refus', async () => {
    await post({ placeId: PLACE, rating: 7 })
    expect(await api.db.select().from(api.schema.reviews).all()).toHaveLength(0)
  })
})

describe('POST /api/reviews puis GET /api/reviews/:placeId', () => {
  it('accepte un avis valide aux limites (1000 caractères, 5 photos, photo de taille maximale)', async () => {
    const photos = [...Array.from({ length: 4 }, () => PHOTO), bigPhoto(REVIEW_PHOTO_MAX_LENGTH)]
    const res = await post({ placeId: PLACE, rating: 1, comment: 'a'.repeat(1000), photos })
    expect(res.status).toBe(200)
    expect(res.body.photos).toHaveLength(5)
  })

  it('enregistre un avis valide et le relit, plus récents d\'abord', async () => {
    // Avis plus ancien, inséré directement.
    await api.db.insert(api.schema.reviews).values({
      placeId: PLACE, userId: bob.id, rating: 3, comment: 'Ancien avis', createdAt: new Date('2025-01-01T12:00:00Z'),
    })

    const res = await post({ placeId: PLACE, rating: 5, comment: '  Très bon accueil, gamelle d\'eau  ', photos: [PHOTO] })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      placeId: PLACE,
      rating: 5,
      comment: 'Très bon accueil, gamelle d\'eau',
      photos: [PHOTO],
      username: 'alice',
      avatarUrl: null,
    })
    expect(typeof res.body.id).toBe('number')
    expect(res.body).not.toHaveProperty('userId')

    const list = await api.request<Review[]>('GET', `/api/reviews/${encodeURIComponent(PLACE)}`)
    expect(list.status).toBe(200)
    expect(list.body.map(r => r.comment)).toEqual(['Très bon accueil, gamelle d\'eau', 'Ancien avis'])
    expect(list.body[0]).toMatchObject({ id: res.body.id, rating: 5, photos: [PHOTO], username: 'alice' })
    expect(list.body[1]).toMatchObject({ username: 'bob', photos: [] })
    for (const review of list.body) expect(review).not.toHaveProperty('userId')
  })

  it('commentaire vide ou absent : enregistré à null', async () => {
    const res = await post({ placeId: PLACE, rating: 4, comment: '   ' })
    expect(res.status).toBe(200)
    expect(res.body.comment).toBeNull()
    expect(res.body.photos).toEqual([])
  })

  it('GET ne renvoie ni passwordHash ni email', async () => {
    await post({ placeId: PLACE, rating: 4 })
    await post({ placeId: PLACE, rating: 2 }, bob.session)
    const list = await api.request<Review[]>('GET', `/api/reviews/${encodeURIComponent(PLACE)}`)
    expect(list.body).toHaveLength(2)
    for (const review of list.body) {
      expect(review).not.toHaveProperty('passwordHash')
      expect(review).not.toHaveProperty('email')
    }
    expect(list.text).not.toMatch(/hash-secret|@exemple\.fr|password/i)
  })

  it('GET d\'un lieu sans avis : liste vide ; id invalide : 400', async () => {
    expect((await api.request('GET', '/api/reviews/user%3Aautre')).body).toEqual([])
    expect((await api.request('GET', '/api/reviews/pas-un-id')).status).toBe(400)
  })
})
