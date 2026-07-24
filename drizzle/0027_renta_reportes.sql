CREATE TABLE IF NOT EXISTS `rentaReportes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaClienteId` int NOT NULL,
	`tipo` varchar(40) NOT NULL DEFAULT 'BORRADOR_210',
	`fileKey` varchar(500) NOT NULL,
	`generadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rentaReportes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `rentaReportes_rentaCliente_idx` ON `rentaReportes` (`rentaClienteId`);