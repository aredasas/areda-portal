CREATE TABLE `comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('task','deadline') NOT NULL,
	`entityId` int NOT NULL,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
