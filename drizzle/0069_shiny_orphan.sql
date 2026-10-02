CREATE TABLE `informesBalanceCargas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`nombreArchivo` varchar(255) NOT NULL,
	`fileKey` varchar(500),
	`cuentasDetalle` int NOT NULL,
	`porTercero` boolean NOT NULL DEFAULT false,
	`diferenciaEcuacion` double NOT NULL,
	`diferenciaMovimiento` double NOT NULL,
	`cuentasInconsistentes` int NOT NULL DEFAULT 0,
	`cargadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesBalanceCargas_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesBalanceCargas_periodo_idx` UNIQUE(`clienteId`,`anio`,`mes`)
);
--> statement-breakpoint
CREATE TABLE `informesBalanceNotas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`cuenta` varchar(20) NOT NULL,
	`estado` enum('OK','PE','RE'),
	`observacion` text,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesBalanceNotas_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesBalanceNotas_cliente_cuenta_idx` UNIQUE(`clienteId`,`cuenta`)
);
--> statement-breakpoint
CREATE TABLE `informesBalanceSaldos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`cuenta` varchar(20) NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`saldoInicial` double NOT NULL,
	`debitos` double NOT NULL,
	`creditos` double NOT NULL,
	`saldoFinal` double NOT NULL,
	`esDetalle` boolean NOT NULL,
	CONSTRAINT `informesBalanceSaldos_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesBalanceSaldos_periodo_cuenta_idx` UNIQUE(`clienteId`,`anio`,`mes`,`cuenta`)
);
