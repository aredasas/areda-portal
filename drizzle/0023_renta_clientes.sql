CREATE TABLE IF NOT EXISTS `rentaClientes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`cedula` varchar(20) NOT NULL,
	`anioGravable` int NOT NULL,
	`noObligado` boolean NOT NULL DEFAULT false,
	`terminado` boolean NOT NULL DEFAULT false,
	`createdById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rentaClientes_id` PRIMARY KEY(`id`),
	CONSTRAINT `rentaClientes_cedula_anio_idx` UNIQUE(`cedula`,`anioGravable`)
);
