CREATE TABLE `oficinaAgentes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(40) NOT NULL,
	`nombre` varchar(100) NOT NULL,
	`tipo` enum('estadista_tareas','correo','desarrollo') NOT NULL,
	`estado` enum('libre','trabajando','esperando','error') NOT NULL DEFAULT 'libre',
	`personalidad` text,
	`objetivo` text,
	`especialidad` text,
	`criterioTerminado` text,
	`esfuerzo` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`activo` boolean NOT NULL DEFAULT true,
	`ultimaRevisionAt` timestamp,
	`ultimoErrorMensaje` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oficinaAgentes_id` PRIMARY KEY(`id`),
	CONSTRAINT `oficinaAgentes_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `oficinaMensajes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agenteId` int NOT NULL,
	`rol` enum('user','assistant') NOT NULL,
	`contenido` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oficinaMensajes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oficinaRevisiones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agenteId` int NOT NULL,
	`iniciadaAt` timestamp NOT NULL DEFAULT (now()),
	`finalizadaAt` timestamp,
	`estado` enum('ok','error') NOT NULL DEFAULT 'ok',
	`resumen` text,
	`solicitudesCreadas` int NOT NULL DEFAULT 0,
	`error` text,
	CONSTRAINT `oficinaRevisiones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oficinaSolicitudes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agenteId` int NOT NULL,
	`tipo` varchar(60) NOT NULL,
	`refId` int,
	`titulo` varchar(255) NOT NULL,
	`detalle` text,
	`severidad` enum('info','atencion','urgente') NOT NULL DEFAULT 'info',
	`estado` enum('pendiente','atendida','descartada') NOT NULL DEFAULT 'pendiente',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resueltaAt` timestamp,
	CONSTRAINT `oficinaSolicitudes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `oficinaMensajes_agente_idx` ON `oficinaMensajes` (`agenteId`);--> statement-breakpoint
CREATE INDEX `oficinaRevisiones_agente_idx` ON `oficinaRevisiones` (`agenteId`);--> statement-breakpoint
CREATE INDEX `oficinaSolicitudes_agente_idx` ON `oficinaSolicitudes` (`agenteId`);--> statement-breakpoint
CREATE INDEX `oficinaSolicitudes_tipoRef_idx` ON `oficinaSolicitudes` (`tipo`,`refId`);