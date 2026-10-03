CREATE TABLE `informesGestionNotas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`puntosJson` text,
	`planJson` text,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesGestionNotas_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesGestionNotas_periodo_idx` UNIQUE(`clienteId`,`anio`,`mes`)
);
