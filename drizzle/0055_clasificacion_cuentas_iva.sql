CREATE TABLE `informesClasificacionCuentasIva` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`cuenta` varchar(20) NOT NULL,
	`categoria` enum('generado_19','generado_5','descontable_19','descontable_5','transitorio','generado_devolucion_compra_19','generado_devolucion_compra_5','descontable_devolucion_venta_19','descontable_devolucion_venta_5') NOT NULL,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesClasificacionCuentasIva_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesClasificacionCuentasIva_cliente_cuenta_idx` UNIQUE(`clienteId`,`cuenta`)
);
