CREATE TABLE `oficinaBuzones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`nombre` varchar(120) NOT NULL,
	`firma` text,
	`activo` boolean NOT NULL DEFAULT true,
	`ultimaConexionAt` timestamp,
	`ultimaRevisionAt` timestamp,
	`ultimoError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oficinaBuzones_id` PRIMARY KEY(`id`),
	CONSTRAINT `oficinaBuzones_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `oficinaCorreos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`buzonId` int NOT NULL,
	`gmailId` varchar(32) NOT NULL,
	`threadId` varchar(32) NOT NULL,
	`remitenteNombre` varchar(255),
	`remitenteEmail` varchar(320) NOT NULL,
	`asunto` varchar(500) NOT NULL DEFAULT '',
	`fechaCorreo` timestamp NOT NULL,
	`snippet` text,
	`categoria` varchar(30) NOT NULL DEFAULT 'otro',
	`prioridad` enum('urgente','atencion','info','ninguna') NOT NULL DEFAULT 'info',
	`resumen` text,
	`accionSugerida` text,
	`clientId` int,
	`estado` enum('pendiente','gestionado','descartado') NOT NULL DEFAULT 'pendiente',
	`borradorId` varchar(64),
	`borradorTexto` text,
	`borradorAt` timestamp,
	`taskId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oficinaCorreos_id` PRIMARY KEY(`id`),
	CONSTRAINT `oficinaCorreos_buzon_gmail_idx` UNIQUE(`buzonId`,`gmailId`)
);
--> statement-breakpoint
CREATE INDEX `oficinaCorreos_fecha_idx` ON `oficinaCorreos` (`fechaCorreo`);--> statement-breakpoint
CREATE INDEX `oficinaCorreos_estado_idx` ON `oficinaCorreos` (`estado`,`prioridad`);