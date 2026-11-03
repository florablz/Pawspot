CREATE TABLE `geocode_cache` (
	`query` text PRIMARY KEY NOT NULL,
	`results` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `geocode_cache_created_at_idx` ON `geocode_cache` (`created_at`);