CREATE TABLE `cuentasCobroClientes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`prefijo` varchar(10) NOT NULL DEFAULT 'AP',
	`numero` int NOT NULL,
	`fecha` timestamp NOT NULL DEFAULT (now()),
	`detalle` text NOT NULL,
	`valor` double NOT NULL,
	`fileKey` varchar(500),
	`generadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cuentasCobroClientes_id` PRIMARY KEY(`id`),
	CONSTRAINT `cuentasCobroClientes_numero_idx` UNIQUE(`prefijo`,`numero`)
);
--> statement-breakpoint
CREATE INDEX `cuentasCobroClientes_client_idx` ON `cuentasCobroClientes` (`clientId`);