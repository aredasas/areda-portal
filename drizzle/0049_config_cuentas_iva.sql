CREATE TABLE `informesConfigCuentasIva` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`tipoIva` enum('generado_19','generado_5','descontable_19','descontable_5','transitorio') NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesConfigCuentasIva_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesConfigCuentasIva_cliente_tipo_idx` UNIQUE(`clienteId`,`tipoIva`)
);
