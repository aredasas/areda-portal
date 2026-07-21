CREATE TABLE IF NOT EXISTS `informesCentrosCosto` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`codigo` varchar(4) NOT NULL,
	`nombre` varchar(120) NOT NULL,
	`activo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesCentrosCosto_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `informesCentrosCosto_cliente_codigo_idx` ON `informesCentrosCosto` (`clienteId`,`codigo`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `informesCuentasPuc` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`descripcion` varchar(255),
	`tipo` enum('ingreso','costo','gasto','descuento_pp') NOT NULL,
	`clasificadoPorIA` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesCuentasPuc_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesCuentasPuc_cuenta_unique` UNIQUE(`cuenta`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `informesCargas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`nombreArchivo` varchar(255) NOT NULL,
	`fileKey` varchar(500),
	`totalFilas` int,
	`estado` enum('procesando','completado','error') NOT NULL DEFAULT 'procesando',
	`mensajeError` text,
	`cargadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesCargas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `informesCargas_cliente_anioMes_idx` ON `informesCargas` (`clienteId`,`anio`,`mes`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `informesSaldosMensuales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cargaId` int NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`centroCodigo` varchar(4) NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`tipo` enum('ingreso','costo','gasto','descuento_pp') NOT NULL,
	`valor` double NOT NULL,
	CONSTRAINT `informesSaldosMensuales_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `informesSaldos_periodo_centro_cuenta_idx` ON `informesSaldosMensuales` (`clienteId`,`anio`,`mes`,`centroCodigo`,`cuenta`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `informesSaldos_cliente_anio_idx` ON `informesSaldosMensuales` (`clienteId`,`anio`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `informesReportes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int,
	`tipo` varchar(40) NOT NULL DEFAULT 'ERM',
	`nivel` enum('resumen','detalle') NOT NULL DEFAULT 'resumen',
	`fileKey` varchar(500) NOT NULL,
	`generadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesReportes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `informesReportes_cliente_anio_idx` ON `informesReportes` (`clienteId`,`anio`);
