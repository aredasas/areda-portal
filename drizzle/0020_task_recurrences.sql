ALTER TABLE `tasks` ADD `recurrenceId` int;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `taskRecurrences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`clientId` int NOT NULL,
	`assignedToId` int,
	`priority` enum('baja','media','alta','urgente') NOT NULL DEFAULT 'media',
	`createdById` int NOT NULL,
	`recurrenceType` enum('semanal','quincenal','mensual') NOT NULL,
	`dayOfWeek` int,
	`dayOfMonth` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastGeneratedPeriod` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `taskRecurrences_id` PRIMARY KEY(`id`)
);
