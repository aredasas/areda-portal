CREATE TABLE `informesIvaTransitorioCuentas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`cuenta` varchar(20) NOT NULL,
	`actualizadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesIvaTransitorioCuentas_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesIvaTransitorioCuentas_cliente_cuenta_idx` UNIQUE(`clienteId`,`cuenta`)
);
