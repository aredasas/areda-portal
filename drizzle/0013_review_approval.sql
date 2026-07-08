ALTER TABLE `tasks` ADD `reviewNotes` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `reviewedById` int;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `reviewedAt` timestamp;
--> statement-breakpoint
ALTER TABLE `taxDeadlines` ADD `reviewNotes` text;
--> statement-breakpoint
ALTER TABLE `taxDeadlines` ADD `reviewedById` int;
--> statement-breakpoint
ALTER TABLE `taxDeadlines` ADD `reviewedAt` timestamp;
