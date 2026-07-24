-- Migración de datos segura: primero se AMPLÍA el enum de `seccion` (sin
-- quitar los valores viejos todavía), se agrega `tipoValor`, se migran los
-- datos existentes, y solo AL FINAL se reduce el enum a su forma final —
-- así ninguna fila que ya se haya cargado con el modelo anterior
-- (seccion: ingreso/deduccion/rentaExenta) se pierde o queda inválida a
-- mitad de camino.
ALTER TABLE `rentaLiquidacionItems` MODIFY COLUMN `seccion` enum('activo','pasivo','ingreso','deduccion','rentaExenta','cedula') NOT NULL;
--> statement-breakpoint
ALTER TABLE `rentaLiquidacionItems` MODIFY COLUMN `cedula` enum('trabajo','trabajo_honorarios','capital','no_laboral','pensiones','dividendos');
--> statement-breakpoint
ALTER TABLE `rentaLiquidacionItems` ADD `tipoValor` enum('ingreso_bruto','ingreso_no_constitutivo','costo_deduccion_procedente','renta_exenta','deduccion');
--> statement-breakpoint
UPDATE `rentaLiquidacionItems` SET `tipoValor` = 'ingreso_bruto' WHERE `seccion` = 'ingreso';
--> statement-breakpoint
UPDATE `rentaLiquidacionItems` SET `tipoValor` = 'renta_exenta' WHERE `seccion` = 'rentaExenta';
--> statement-breakpoint
UPDATE `rentaLiquidacionItems` SET `tipoValor` = 'deduccion' WHERE `seccion` = 'deduccion';
--> statement-breakpoint
UPDATE `rentaLiquidacionItems` SET `seccion` = 'cedula' WHERE `seccion` IN ('ingreso', 'deduccion', 'rentaExenta');
--> statement-breakpoint
ALTER TABLE `rentaLiquidacionItems` MODIFY COLUMN `seccion` enum('activo','pasivo','cedula') NOT NULL;
