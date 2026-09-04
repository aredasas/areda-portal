CREATE TABLE `informesDivisionesCuentaIva` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`periodicidad` enum('bimestral','cuatrimestral','anual') NOT NULL,
	`periodo` int NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`orden` int NOT NULL,
	`etiqueta` varchar(100),
	`valor` double NOT NULL,
	`clasificacion` enum('gravado_19','gravado_5','excluido','no_gravado') NOT NULL,
	`facturado` boolean NOT NULL DEFAULT true,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesDivisionesCuentaIva_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesDivisionesCuentaIva_idx` UNIQUE(`clienteId`,`anio`,`periodicidad`,`periodo`,`cuenta`,`orden`)
);
--> statement-breakpoint
ALTER TABLE `informesClasificacionCuentas` ADD `facturado` boolean DEFAULT true NOT NULL;