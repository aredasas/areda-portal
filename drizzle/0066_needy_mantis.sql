CREATE TABLE `oficinaActividad` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tipo` varchar(40) NOT NULL,
	`userId` int NOT NULL,
	`entityType` varchar(20),
	`entityId` int,
	`detalle` varchar(60),
	`cantidad` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oficinaActividad_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `oficinaActividad_fecha_idx` ON `oficinaActividad` (`createdAt`);