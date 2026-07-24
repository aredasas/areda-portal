CREATE TABLE IF NOT EXISTS `rentaExogena` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaClienteId` int NOT NULL,
	`nombreArchivo` varchar(255) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`topeIngresos` double,
	`topePatrimonio` double,
	`topeConsumoTC` double,
	`topeMovimiento` double,
	`topeCompras` double,
	`uploadedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rentaExogena_id` PRIMARY KEY(`id`),
	CONSTRAINT `rentaExogena_rentaCliente_idx` UNIQUE(`rentaClienteId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rentaExogenaItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaExogenaId` int NOT NULL,
	`nitTercero` varchar(20),
	`nombreTercero` varchar(255),
	`detalle` text,
	`valor` double NOT NULL,
	`renglon` varchar(10),
	`categoria` enum('ingreso','patrimonio','deuda','otro') NOT NULL DEFAULT 'otro',
	`infoAdicional` text,
	CONSTRAINT `rentaExogenaItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `rentaExogenaItems_rentaExogena_idx` ON `rentaExogenaItems` (`rentaExogenaId`);