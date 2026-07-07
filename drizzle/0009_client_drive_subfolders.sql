ALTER TABLE `taxDeadlines` ADD `driveSubfolder` varchar(150);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `driveSubfolder` varchar(150);
--> statement-breakpoint
CREATE TABLE `clientDriveSubfolders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`name` varchar(150) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clientDriveSubfolders_id` PRIMARY KEY(`id`)
);
