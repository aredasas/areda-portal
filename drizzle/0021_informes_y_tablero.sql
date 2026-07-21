CREATE TABLE IF NOT EXISTS `boardAttachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(255) NOT NULL,
	`contentType` varchar(100),
	`fileSize` int,
	`uploadedById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boardAttachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boardPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`obligationId` int,
	`pinned` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boardPosts_id` PRIMARY KEY(`id`)
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
CREATE TABLE IF NOT EXISTS `informesCentrosCosto` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`codigo` varchar(4) NOT NULL,
	`nombre` varchar(120) NOT NULL,
	`activo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `informesCentrosCosto_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesCentrosCosto_cliente_codigo_idx` UNIQUE(`clienteId`,`codigo`)
);
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
	CONSTRAINT `informesSaldosMensuales_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesSaldos_periodo_centro_cuenta_idx` UNIQUE(`clienteId`,`anio`,`mes`,`centroCodigo`,`cuenta`)
);
--> statement-breakpoint
ALTER TABLE `comments` MODIFY COLUMN `entityType` enum('task','deadline','board_post') NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `type` enum('comentario','aprobada','correccion_solicitada','tablero_post') NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `entityType` enum('task','deadline','board_post') NOT NULL;--> statement-breakpoint
ALTER TABLE `workLocationEntries` MODIFY COLUMN `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `taskRecurrences` MODIFY COLUMN `priority` enum('baja','media','alta','urgente') NOT NULL DEFAULT 'media';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `boardPosts_obligation_idx` ON `boardPosts` (`obligationId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `informesCargas_cliente_anioMes_idx` ON `informesCargas` (`clienteId`,`anio`,`mes`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `informesReportes_cliente_anio_idx` ON `informesReportes` (`clienteId`,`anio`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `informesSaldos_cliente_anio_idx` ON `informesSaldosMensuales` (`clienteId`,`anio`);