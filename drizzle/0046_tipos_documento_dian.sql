CREATE TABLE `informesTiposDocumentoConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`tipoDocumentoDian` varchar(100) NOT NULL,
	`grupo` enum('Emitido','Recibido') NOT NULL,
	`categoria` enum('ingreso','nomina','honorarios_servicios','otro_gasto','excluir') NOT NULL,
	`tiposComprobanteContable` text,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesTiposDocumentoConfig_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesTiposDocumentoConfig_cliente_tipo_grupo_idx` UNIQUE(`clienteId`,`tipoDocumentoDian`,`grupo`)
);
