-- Phase 1 « Données fiables » : cache des lieux (`places`, `fetched_tiles`) et
-- clés étrangères `place_id` → `places.id` pour favoris, avis et alertes.
--
-- Généré par `drizzle-kit generate --name places_cache`, puis complété à la main
-- pour CONVERTIR LES DONNÉES EXISTANTES (le `ALTER COLUMN` généré, propre à libSQL,
-- est remplacé par une recréation de table, portable et sans perte) :
--   1. ids Phase 0 → nouveaux ids : `node-123` → `osm:node:123` (idem `way-`, `relation-`),
--      `demo-1` → `user:demo-1` (lieux de démo du seed) ; ids déjà au nouveau format gardés ;
--   2. une ligne `places` minimale est créée pour chaque lieu présent dans les favoris
--      (nom, lat, lon, catégorie recopiés ; `name_normalized` = lower(nom), recalculé au
--      prochain rafraîchissement ; statut chien `unknown`, `fetched_at` NULL) ;
--   3. favoris, avis et alertes dont le lieu reste inconnu (id illisible, ou aucun favori
--      ne donnait ses coordonnées) sont SUPPRIMÉS : ce sont des données de démo
--      (Phase 0), le seed les recrée ;
--   4. favoris en double (même utilisateur, même lieu) : on garde le plus ancien.
-- Le migrateur libSQL exécute tout dans une transaction, clés étrangères désactivées ;
-- l'ordre ci-dessous garde quand même les références valides.
CREATE TABLE `fetched_tiles` (
	`z` integer NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`z`, `x`, `y`)
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`name` text,
	`name_normalized` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`category` text NOT NULL,
	`osm_dog_policy` text DEFAULT 'unknown' NOT NULL,
	`has_terrace` integer DEFAULT false NOT NULL,
	`dog_status` text DEFAULT 'unknown' NOT NULL,
	`dog_status_info` text,
	`tags` text DEFAULT '{}' NOT NULL,
	`address` text,
	`phone` text,
	`website` text,
	`opening_hours` text,
	`image` text,
	`cuisine` text,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`merged_into` text,
	`created_by` integer,
	`fetched_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `places_lat_lon_idx` ON `places` (`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `places_category_idx` ON `places` (`category`);--> statement-breakpoint
CREATE INDEX `places_name_normalized_idx` ON `places` (`name_normalized`);--> statement-breakpoint
CREATE TABLE `__place_id_map` (
	`old_id` text PRIMARY KEY NOT NULL,
	`new_id` text
);
--> statement-breakpoint
INSERT INTO `__place_id_map` (`old_id`, `new_id`)
SELECT `old_id`, CASE
		WHEN `old_id` GLOB 'osm:node:[1-9]*' OR `old_id` GLOB 'osm:way:[1-9]*' OR `old_id` GLOB 'osm:relation:[1-9]*' OR `old_id` GLOB 'user:?*' THEN `old_id`
		WHEN `old_id` GLOB 'node-[1-9]*' AND substr(`old_id`, 6) NOT GLOB '*[^0-9]*' THEN 'osm:node:' || substr(`old_id`, 6)
		WHEN `old_id` GLOB 'way-[1-9]*' AND substr(`old_id`, 5) NOT GLOB '*[^0-9]*' THEN 'osm:way:' || substr(`old_id`, 5)
		WHEN `old_id` GLOB 'relation-[1-9]*' AND substr(`old_id`, 10) NOT GLOB '*[^0-9]*' THEN 'osm:relation:' || substr(`old_id`, 10)
		WHEN `old_id` GLOB 'demo-?*' AND length(`old_id`) <= 64 AND substr(`old_id`, 6) NOT GLOB '*[^A-Za-z0-9_-]*' THEN 'user:' || `old_id`
		ELSE NULL
	END
FROM (
	SELECT `place_id` AS `old_id` FROM `favorites`
	UNION SELECT `place_id` FROM `reviews`
	UNION SELECT `place_id` FROM `alerts`
);
--> statement-breakpoint
INSERT INTO `places` (`id`, `source`, `name`, `name_normalized`, `lat`, `lon`, `category`, `status`, `verified`, `updated_at`)
SELECT `new_id`,
	CASE WHEN `new_id` GLOB 'osm:*' THEN 'osm' ELSE 'user' END,
	`place_name`,
	lower(`place_name`),
	`place_lat`,
	`place_lon`,
	`place_category`,
	'active',
	CASE WHEN `new_id` GLOB 'osm:*' THEN 1 ELSE 0 END,
	CAST(strftime('%s', 'now') AS integer)
FROM (
	SELECT m.`new_id`, f.`place_name`, f.`place_lat`, f.`place_lon`, f.`place_category`,
		ROW_NUMBER() OVER (PARTITION BY m.`new_id` ORDER BY f.`id` DESC) AS `rn`
	FROM `favorites` f
	JOIN `__place_id_map` m ON m.`old_id` = f.`place_id`
	WHERE m.`new_id` IS NOT NULL
		AND f.`place_lat` BETWEEN -90 AND 90
		AND f.`place_lon` BETWEEN -180 AND 180
		AND f.`place_category` IN ('park', 'dog_park', 'beach', 'restaurant', 'bar', 'cafe', 'vet', 'pet_shop', 'groomer', 'dog_bin')
)
WHERE `rn` = 1;
--> statement-breakpoint
CREATE TABLE `__new_favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`place_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_favorites` (`id`, `user_id`, `place_id`, `created_at`)
SELECT `id`, `user_id`, `new_id`, `created_at`
FROM (
	SELECT f.`id`, f.`user_id`, m.`new_id`, f.`created_at`,
		ROW_NUMBER() OVER (PARTITION BY f.`user_id`, m.`new_id` ORDER BY f.`id`) AS `rn`
	FROM `favorites` f
	JOIN `__place_id_map` m ON m.`old_id` = f.`place_id`
	WHERE m.`new_id` IN (SELECT `id` FROM `places`)
)
WHERE `rn` = 1;
--> statement-breakpoint
DROP TABLE `favorites`;
--> statement-breakpoint
ALTER TABLE `__new_favorites` RENAME TO `favorites`;
--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_user_place_unique` ON `favorites` (`user_id`,`place_id`);
--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`photos` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reviews` (`id`, `place_id`, `user_id`, `rating`, `comment`, `photos`, `created_at`)
SELECT r.`id`, m.`new_id`, r.`user_id`, r.`rating`, r.`comment`, r.`photos`, r.`created_at`
FROM `reviews` r
JOIN `__place_id_map` m ON m.`old_id` = r.`place_id`
WHERE m.`new_id` IN (SELECT `id` FROM `places`);
--> statement-breakpoint
DROP TABLE `reviews`;
--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;
--> statement-breakpoint
CREATE INDEX `reviews_place_id_idx` ON `reviews` (`place_id`);
--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_alerts` (`id`, `place_id`, `user_id`, `type`, `description`, `created_at`)
SELECT a.`id`, m.`new_id`, a.`user_id`, a.`type`, a.`description`, a.`created_at`
FROM `alerts` a
JOIN `__place_id_map` m ON m.`old_id` = a.`place_id`
WHERE m.`new_id` IN (SELECT `id` FROM `places`);
--> statement-breakpoint
DROP TABLE `alerts`;
--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;
--> statement-breakpoint
CREATE INDEX `alerts_place_id_idx` ON `alerts` (`place_id`);
--> statement-breakpoint
DROP TABLE `__place_id_map`;
