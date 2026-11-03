CREATE TABLE `osm_lookup_misses` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `osm_lookup_misses_checked_at_idx` ON `osm_lookup_misses` (`checked_at`);