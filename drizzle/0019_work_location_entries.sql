CREATE TABLE IF NOT EXISTS `workLocationEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`block` enum('morning','afternoon') NOT NULL,
	`slots` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workLocationEntries_id` PRIMARY KEY(`id`)
);
