CREATE TABLE `research_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`href` text NOT NULL,
	`added` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_target` ON `research_targets` (`owner`,`href`);