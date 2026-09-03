CREATE TABLE `informesIvaConciliacion` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`periodicidad` enum('bimestral','cuatrimestral','anual') NOT NULL,
	`periodo` int NOT NULL,
	`estadoJson` text,
	`actualizadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesIvaConciliacion_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesIvaConciliacion_cliente_periodo_idx` UNIQUE(`clienteId`,`anio`,`periodicidad`,`periodo`)
);
