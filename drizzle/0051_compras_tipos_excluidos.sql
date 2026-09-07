CREATE TABLE `informesComprasTiposExcluidos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`tipoComprobante` varchar(20) NOT NULL,
	`actualizadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesComprasTiposExcluidos_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesComprasTiposExcluidos_cliente_tipo_idx` UNIQUE(`clienteId`,`tipoComprobante`)
);
