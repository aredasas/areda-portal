CREATE TABLE `clientObligations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`obligationId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clientObligations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`razonSocial` varchar(255) NOT NULL,
	`nit` varchar(20) NOT NULL,
	`digitoVerificacion` varchar(1),
	`direccion` text,
	`ciudad` varchar(100),
	`departamento` varchar(100),
	`telefono` varchar(20),
	`email` varchar(320),
	`actividadEconomica` varchar(255),
	`codigoCIIU` varchar(10),
	`representanteLegal` varchar(255),
	`rutFileUrl` text,
	`rutFileKey` varchar(255),
	`isActive` boolean NOT NULL DEFAULT true,
	`notes` text,
	`createdById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`clientId` int NOT NULL,
	`assignedToId` int,
	`createdById` int NOT NULL,
	`dueDate` timestamp,
	`status` enum('pendiente','en_progreso','completada','vencida') NOT NULL DEFAULT 'pendiente',
	`priority` enum('baja','media','alta','urgente') NOT NULL DEFAULT 'media',
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taxDeadlines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`obligationId` int NOT NULL,
	`period` varchar(20) NOT NULL,
	`dueDate` timestamp NOT NULL,
	`lastDigitNit` varchar(1),
	`status` enum('pendiente','completado','vencido') NOT NULL DEFAULT 'pendiente',
	`completedAt` timestamp,
	`completedById` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `taxDeadlines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taxObligations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`frequency` enum('mensual','bimestral','cuatrimestral','anual') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	CONSTRAINT `taxObligations_id` PRIMARY KEY(`id`),
	CONSTRAINT `taxObligations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','contador_senior','contador_junior','asistente') NOT NULL DEFAULT 'asistente';--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `position` varchar(100);