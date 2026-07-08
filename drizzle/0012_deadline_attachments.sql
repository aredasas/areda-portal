CREATE TABLE `deadlineAttachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deadlineId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(255) NOT NULL,
	`contentType` varchar(100),
	`fileSize` int,
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deadlineAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `taskAttachments` ADD `isEvidence` boolean NOT NULL DEFAULT false;
