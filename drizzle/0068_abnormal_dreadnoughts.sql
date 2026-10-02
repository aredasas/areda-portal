CREATE TABLE `informesFlujoCalculos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`prefijosEfectivo` varchar(500) NOT NULL,
	`documentos` int NOT NULL,
	`lineas` int NOT NULL,
	`lineasAuxiliar` int NOT NULL,
	`totalDebitos` double NOT NULL,
	`totalCreditos` double NOT NULL,
	`descuadrados` int NOT NULL,
	`observacionesJson` text,
	`cuentasDisponibleJson` text,
	`calculadoPorId` int NOT NULL,
	`calculadoAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesFlujoCalculos_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesFlujoCalculos_periodo_idx` UNIQUE(`clienteId`,`anio`,`mes`)
);
--> statement-breakpoint
CREATE TABLE `informesFlujoConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`prefijosEfectivo` varchar(500) NOT NULL,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesFlujoConfig_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesFlujoConfig_clienteId_unique` UNIQUE(`clienteId`)
);
--> statement-breakpoint
CREATE TABLE `informesFlujoMovimientos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`clase` enum('efectivo','contrapartida','sin_efecto') NOT NULL,
	`cuenta` varchar(20) NOT NULL,
	`tipoDocumento` varchar(20) NOT NULL,
	`debitos` double NOT NULL,
	`creditos` double NOT NULL,
	`documentos` int NOT NULL,
	`lineas` int NOT NULL,
	CONSTRAINT `informesFlujoMovimientos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `informesFlujoSaldos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`anio` int NOT NULL,
	`mes` int NOT NULL,
	`cuenta` varchar(20) NOT NULL,
	`saldoInicial` double,
	`saldoFinal` double,
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesFlujoSaldos_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesFlujoSaldos_periodo_cuenta_idx` UNIQUE(`clienteId`,`anio`,`mes`,`cuenta`)
);
--> statement-breakpoint
CREATE TABLE `informesFlujoSecciones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clienteId` int NOT NULL,
	`cuenta` varchar(12) NOT NULL,
	`seccion` enum('recaudos','egresos_operacion','inversion','financiacion'),
	`nombre` varchar(255),
	`actualizadoPorId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `informesFlujoSecciones_id` PRIMARY KEY(`id`),
	CONSTRAINT `informesFlujoSecciones_cliente_cuenta_idx` UNIQUE(`clienteId`,`cuenta`)
);
--> statement-breakpoint
CREATE INDEX `informesFlujoMovimientos_periodo_idx` ON `informesFlujoMovimientos` (`clienteId`,`anio`,`mes`);