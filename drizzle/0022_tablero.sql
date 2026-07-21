ALTER TABLE `comments` MODIFY COLUMN `entityType` enum('task','deadline','board_post') NOT NULL;
--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `type` enum('comentario','aprobada','correccion_solicitada','tablero_post') NOT NULL;
--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `entityType` enum('task','deadline','board_post') NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boardPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`obligationId` int,
	`pinned` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boardPosts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `boardPosts_obligation_idx` ON `boardPosts` (`obligationId`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boardAttachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(255) NOT NULL,
	`contentType` varchar(100),
	`fileSize` int,
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boardAttachments_id` PRIMARY KEY(`id`)
);
