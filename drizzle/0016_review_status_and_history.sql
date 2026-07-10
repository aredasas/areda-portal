ALTER TABLE `tasks` ADD `reviewStatus` enum('aprobado','correccion');
--> statement-breakpoint
ALTER TABLE `taxDeadlines` ADD `reviewStatus` enum('aprobado','correccion');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historyEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('task','deadline') NOT NULL,
	`entityId` int NOT NULL,
	`eventType` enum('creada','completada','correccion_solicitada','aprobada','reabierta','cancelada') NOT NULL,
	`userId` int NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historyEvents_id` PRIMARY KEY(`id`)
);
