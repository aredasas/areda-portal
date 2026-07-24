ALTER TABLE `rentaDependientes` ADD `tipoDocumento` varchar(10) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `rentaDependientes` ADD `numeroDocumento` varchar(20) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `rentaLiquidacionItems` ADD `cedula` enum('trabajo','capital','no_laboral','pensiones','dividendos');