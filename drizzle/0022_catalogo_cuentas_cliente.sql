CREATE TABLE IF NOT EXISTS `informesCuentasCliente` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`origen` enum('archivo','manual') NOT NULL DEFAULT 'archivo',
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesCuentasCliente_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesCuentasCliente_cliente_cuenta_idx` UNIQUE(`clienteId`,`cuenta`)
);
