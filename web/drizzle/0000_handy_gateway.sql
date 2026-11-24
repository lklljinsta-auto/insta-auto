CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`handle` text NOT NULL,
	`alias` text NOT NULL,
	`guide` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_handle` ON `accounts` (`owner`,`handle`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`account` text NOT NULL,
	`title` text NOT NULL,
	`caption` text NOT NULL,
	`format` text NOT NULL,
	`source` text NOT NULL,
	`schedule` text,
	`updated` text NOT NULL,
	FOREIGN KEY (`account`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`draft` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`updated` text NOT NULL,
	`objectKey` text NOT NULL,
	FOREIGN KEY (`draft`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE no action
);
