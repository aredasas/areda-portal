CREATE TABLE `rentaCuentasCobro` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaClienteId` int NOT NULL,
	`prefijo` varchar(10) NOT NULL DEFAULT 'R25',
	`numero` int NOT NULL,
	`fecha` timestamp NOT NULL DEFAULT (now()),
	`detalle` text NOT NULL,
	`valor` double NOT NULL,
	`totalIngresosReferencia` double,
	`fileKey` varchar(500),
	`generadoPorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rentaCuentasCobro_id` PRIMARY KEY(`id`),
	CONSTRAINT `rentaCuentasCobro_numero_idx` UNIQUE(`prefijo`,`numero`)
);
--> statement-breakpoint
CREATE INDEX `rentaCuentasCobro_rentaCliente_idx` ON `rentaCuentasCobro` (`rentaClienteId`);