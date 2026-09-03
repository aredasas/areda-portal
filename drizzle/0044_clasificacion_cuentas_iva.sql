CREATE TABLE `informesClasificacionCuentas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`clasificacion` enum('gravado_19','gravado_5','excluido','no_gravado') NOT NULL,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesClasificacionCuentas_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesClasificacionCuentas_cliente_cuenta_idx` UNIQUE(`clienteId`,`cuenta`)
);
--> statement-breakpoint
ALTER TABLE `informesReportes` ADD `totalEmitidoDian` double;--> statement-breakpoint
ALTER TABLE `informesReportes` ADD `totalRecibidoDian` double;