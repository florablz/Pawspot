import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'
import type { CategoryKey } from '../../shared/categories'
import type { DogStatus, DogStatusInfo, OsmDogPolicyKind } from '../../shared/dogStatus'
import type { PlaceSource, PlaceStatus } from '../../shared/types'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

/**
 * Lieux : cache des lieux OSM (`source = 'osm'`, rafraîchis par tuiles) et lieux
 * ajoutés par la communauté (`source = 'user'`). Voir CAHIER_DES_CHARGES.md §4.1.
 */
export const places = sqliteTable('places', {
  /** `osm:node:123` / `osm:way:…` / `osm:relation:…` / `user:<nanoid>`. */
  id: text('id').primaryKey(),
  source: text('source').$type<PlaceSource>().notNull(),
  /** `null` si le lieu n'a pas de nom dans OSM. */
  name: text('name'),
  /** `normalizeName(name)` (shared/text.ts). */
  nameNormalized: text('name_normalized'),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  category: text('category').$type<CategoryKey>().notNull(),
  /** Résumé de `dog` / `dog:conditional` (`parseOsmDogPolicy(tags).policy`). */
  osmDogPolicy: text('osm_dog_policy').$type<OsmDogPolicyKind>().notNull().default('unknown'),
  /** `outdoor_seating=yes`. */
  hasTerrace: integer('has_terrace', { mode: 'boolean' }).notNull().default(false),
  /** Statut chien calculé par `computeDogStatus` (dénormalisé pour les filtres / marqueurs). */
  dogStatus: text('dog_status').$type<DogStatus>().notNull().default('unknown'),
  /** `DogStatusInfo` en JSON (source du statut, décomptes). */
  dogStatusInfo: text('dog_status_info', { mode: 'json' }).$type<DogStatusInfo>(),
  /** Tags OSM utiles (liste blanche), en JSON. */
  tags: text('tags', { mode: 'json' }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
  address: text('address'),
  phone: text('phone'),
  /** Déjà passé par `sanitizeWebsite`. */
  website: text('website'),
  openingHours: text('opening_hours'),
  /** Déjà passé par `resolveImage` (http(s) uniquement). */
  image: text('image'),
  cuisine: text('cuisine'),
  description: text('description'),
  status: text('status').$type<PlaceStatus>().notNull().default('active'),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  mergedInto: text('merged_into'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** Dernière lecture depuis Overpass (`null` pour un lieu `user`). */
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('places_lat_lon_idx').on(t.lat, t.lon),
  index('places_category_idx').on(t.category),
  index('places_name_normalized_idx').on(t.nameNormalized),
])

/** Tuiles slippy (zoom 12) déjà chargées depuis Overpass. */
export const fetchedTiles = sqliteTable('fetched_tiles', {
  z: integer('z').notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
}, t => [
  primaryKey({ columns: [t.z, t.x, t.y] }),
])

export const reviews = sqliteTable('reviews', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  placeId: text('place_id').notNull().references(() => places.id),
  userId: integer('user_id').notNull().references(() => users.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  photos: text('photos'), // JSON array of base64 data URIs
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('reviews_place_id_idx').on(t.placeId),
])

export const favorites = sqliteTable('favorites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  placeId: text('place_id').notNull().references(() => places.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, t => [
  uniqueIndex('favorites_user_place_unique').on(t.userId, t.placeId),
])

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  placeId: text('place_id').notNull().references(() => places.id),
  userId: integer('user_id').notNull().references(() => users.id),
  type: text('type').notNull(), // 'closed' | 'change' (nouveaux types en Phase 3, §3.10)
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('alerts_place_id_idx').on(t.placeId),
])

export type PlaceRow = typeof places.$inferSelect
export type NewPlaceRow = typeof places.$inferInsert
