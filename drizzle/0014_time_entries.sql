CREATE TABLE IF NOT EXISTS `timeEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('inicio','salida_almuerzo','regreso_almuerzo','fin') NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `timeEntries_id` PRIMARY KEY(`id`)
);
