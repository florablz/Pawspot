/**
 * Données de démo (fictives) : `npm run db:seed`, après `npm run db:migrate`.
 * Idempotent : relançable sans créer de doublons.
 *
 * Garde-fou : refuse de tourner si `NODE_ENV=production`, ou si `DATABASE_URL`
 * n'est pas une base locale `file:` (sauf `SEED_ALLOW_REMOTE=1`, à n'utiliser
 * que sur une base de test distante, jamais sur la prod).
 */
import './db-env'
import type { NewPlaceRow } from '../server/database/schema'

const seedUrl = process.env.DATABASE_URL || 'file:pawspot.db'
if (process.env.NODE_ENV === 'production') {
  console.error('Seed refusé : NODE_ENV=production. Les données de démo ne vont jamais en prod.')
  process.exit(1)
}
if (!seedUrl.startsWith('file:') && process.env.SEED_ALLOW_REMOTE !== '1') {
  console.error('Seed refusé : DATABASE_URL ne désigne pas une base locale (file:…). '
    + 'Pour une base de test distante, relancer avec SEED_ALLOW_REMOTE=1.')
  process.exit(1)
}

// Imports dynamiques : la connexion à la base n'est ouverte qu'après le garde-fou.
const { and, eq } = await import('drizzle-orm')
const { default: bcrypt } = await import('bcrypt')
const { client, db } = await import('../server/database')
const { alerts, favorites, places, reviews, users } = await import('../server/database/schema')
const { computeDogStatus, parseOsmDogPolicy } = await import('../shared/dogStatus')
const { normalizeName } = await import('../shared/text')

// Mots de passe de démo volontairement évidents — jamais utilisés en prod.
const DEMO_USERS = [
  { email: 'alice@demo.pawspot.fr', username: 'alice_demo', password: 'demo1234' },
  { email: 'bruno@demo.pawspot.fr', username: 'bruno_demo', password: 'demo1234' },
  { email: 'chloe@demo.pawspot.fr', username: 'chloe_demo', password: 'demo1234' },
] as const

// Lieux fictifs à Paris, en `source = 'user'` (ids `user:demo-N`, jamais en collision avec OSM ;
// ils ne sont donc ni écrasés ni marqués « disparus » par le rafraîchissement Overpass).
const DEMO_PLACES = {
  parc: { id: 'user:demo-1', name: 'Parc des Truffes (démo)', lat: 48.8462, lon: 2.3371, category: 'park', tags: { leisure: 'park', dog: 'leashed' } },
  cafe: { id: 'user:demo-2', name: 'Café du Museau (démo)', lat: 48.8635, lon: 2.3622, category: 'cafe', tags: { amenity: 'cafe', outdoor_seating: 'yes' } },
  caniparc: { id: 'user:demo-3', name: 'Caniparc de la Butte (démo)', lat: 48.8867, lon: 2.3431, category: 'dog_park', tags: { leisure: 'dog_park' } },
  resto: { id: 'user:demo-4', name: 'Bistrot des Pattes (démo)', lat: 48.8530, lon: 2.3690, category: 'restaurant', tags: { 'amenity': 'restaurant', 'outdoor_seating': 'yes', 'dog:conditional': 'no @ (12:00-14:00)' } },
} as const satisfies Record<string, { id: string; name: string; lat: number; lon: number; category: NewPlaceRow['category']; tags: Record<string, string> }>

async function upsertDemoPlaces() {
  const now = new Date()
  for (const p of Object.values(DEMO_PLACES)) {
    const tags: Record<string, string> = p.tags
    const hasTerrace = tags.outdoor_seating === 'yes'
    const dog = computeDogStatus({ tags, hasTerrace, now })
    const row: NewPlaceRow = {
      id: p.id,
      source: 'user',
      name: p.name,
      nameNormalized: normalizeName(p.name),
      lat: p.lat,
      lon: p.lon,
      category: p.category,
      osmDogPolicy: parseOsmDogPolicy(tags).policy,
      hasTerrace,
      dogStatus: dog.status,
      dogStatusInfo: dog.info,
      tags,
      address: 'Paris (adresse fictive)',
      status: 'active',
      verified: true,
      updatedAt: now,
    }
    const { id: _id, ...update } = row
    await db.insert(places).values(row).onConflictDoUpdate({ target: places.id, set: update })
  }
  console.log(`Lieux de démo : ${Object.keys(DEMO_PLACES).length} à jour.`)
}

async function upsertUser(u: (typeof DEMO_USERS)[number]) {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email)).get()
  if (existing) return existing.id
  const passwordHash = await bcrypt.hash(u.password, 10)
  const [created] = await db.insert(users)
    .values({ email: u.email, username: u.username, passwordHash })
    .returning({ id: users.id })
  return created!.id
}

async function main() {
  await upsertDemoPlaces()
  const [alice, bruno, chloe] = await Promise.all(DEMO_USERS.map(upsertUser)) as [number, number, number]

  const demoReviews = [
    { userId: alice, placeId: DEMO_PLACES.parc.id, rating: 5, comment: 'Grandes pelouses, gamelle d\'eau près de l\'entrée.' },
    { userId: bruno, placeId: DEMO_PLACES.parc.id, rating: 4, comment: 'Très bien, mais monde le week-end.' },
    { userId: bruno, placeId: DEMO_PLACES.cafe.id, rating: 5, comment: 'Chien accepté en terrasse et à l\'intérieur, accueil adorable.' },
    { userId: chloe, placeId: DEMO_PLACES.caniparc.id, rating: 3, comment: 'Espace clôturé un peu petit.' },
    { userId: chloe, placeId: DEMO_PLACES.resto.id, rating: 4, comment: 'Accepté en terrasse uniquement.' },
  ]
  let added = 0
  for (const r of demoReviews) {
    const exists = await db.select({ id: reviews.id }).from(reviews)
      .where(and(eq(reviews.userId, r.userId), eq(reviews.placeId, r.placeId))).get()
    if (!exists) {
      await db.insert(reviews).values(r)
      added++
    }
  }
  console.log(`Avis : ${added} ajouté(s).`)

  const demoFavorites = [
    { userId: alice, place: DEMO_PLACES.parc },
    { userId: alice, place: DEMO_PLACES.cafe },
    { userId: bruno, place: DEMO_PLACES.caniparc },
  ]
  added = 0
  for (const { userId, place } of demoFavorites) {
    const exists = await db.select({ id: favorites.id }).from(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.placeId, place.id))).get()
    if (!exists) {
      await db.insert(favorites).values({ userId, placeId: place.id })
      added++
    }
  }
  console.log(`Favoris : ${added} ajouté(s).`)

  const demoAlerts = [
    { userId: chloe, placeId: DEMO_PLACES.caniparc.id, type: 'change', description: 'Portillon cassé, fermer à la main.' },
    { userId: alice, placeId: DEMO_PLACES.resto.id, type: 'closed', description: 'Fermé pour travaux jusqu\'à fin du mois.' },
  ]
  added = 0
  for (const a of demoAlerts) {
    const exists = await db.select({ id: alerts.id }).from(alerts)
      .where(and(eq(alerts.userId, a.userId), eq(alerts.placeId, a.placeId), eq(alerts.type, a.type))).get()
    if (!exists) {
      await db.insert(alerts).values(a)
      added++
    }
  }
  console.log(`Alertes : ${added} ajoutée(s).`)
  console.log(`Comptes de démo : ${DEMO_USERS.map(u => u.email).join(', ')} (mot de passe : demo1234).`)
}

try {
  await main()
}
catch (error) {
  console.error('Échec du seed :', error)
  process.exitCode = 1
}
finally {
  client.close()
}
