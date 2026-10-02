CREATE TABLE `oficinaCarpetasCliente` (
	`id` int AUTO_INCREMENT NOT NULL,
	`buzonId` int NOT NULL,
	`clientId` int NOT NULL,
	`carpetaId` varchar(64) NOT NULL,
	`carpetaNombre` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oficinaCarpetasCliente_id` PRIMARY KEY(`id`),
	CONSTRAINT `oficinaCarpetasCliente_buzon_cliente_idx` UNIQUE(`buzonId`,`clientId`)
);
--> statement-breakpoint
ALTER TABLE `oficinaBuzones` ADD `permisoCompleto` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `oficinaBuzones` ADD `firmaGmail` text;--> statement-breakpoint
ALTER TABLE `oficinaCorreos` ADD `carpeta` varchar(255);--> statement-breakpoint
ALTER TABLE `oficinaCorreos` ADD `enPapeleraAt` timestamp;