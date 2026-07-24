CREATE TABLE IF NOT EXISTS `rentaDeclaracionAnterior` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaClienteId` int NOT NULL,
	`patrimonioLiquidoAnioAnterior` double,
	`impuestoNetoAnioAnterior` double,
	`saldoAFavorAnterior` double,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rentaDeclaracionAnterior_id` PRIMARY KEY(`id`),
	CONSTRAINT `rentaDeclaracionAnterior_rentaCliente_idx` UNIQUE(`rentaClienteId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rentaDependientes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaClienteId` int NOT NULL,
	`nombre` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rentaDependientes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rentaLiquidacionItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rentaClienteId` int NOT NULL,
	`seccion` enum('activo','pasivo','ingreso','deduccion','rentaExenta') NOT NULL,
	`tipoDeduccion` varchar(60),
	`concepto` varchar(255) NOT NULL,
	`valor` double NOT NULL,
	`origen` enum('exogena','manual') NOT NULL DEFAULT 'manual',
	`exogenaItemId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rentaLiquidacionItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `rentaLiquidacionItems_rentaCliente_idx` ON `rentaLiquidacionItems` (`rentaClienteId`);