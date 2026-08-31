ALTER TABLE `timeEntries` ADD `deviceType` enum('pc','movil','tablet','desconocido');--> statement-breakpoint
ALTER TABLE `timeEntries` ADD `latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `timeEntries` ADD `longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `timeEntries` ADD `locationAccuracy` int;