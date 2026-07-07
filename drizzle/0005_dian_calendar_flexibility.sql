-- Widen lastDigitNit to support two-digit ranges ("01-02") or a fixed-date
-- marker ("ALL"), not just a single digit.
ALTER TABLE `taxDeadlines` MODIFY COLUMN `lastDigitNit` varchar(10);
--> statement-breakpoint
ALTER TABLE `dianCalendar` MODIFY COLUMN `lastDigitNit` varchar(10) NOT NULL;
--> statement-breakpoint
-- Support obligations paid in multiple installments within the same year
-- (e.g. Renta Grandes Contribuyentes = 3 cuotas, Personas Jurídicas = 2 cuotas)
ALTER TABLE `taxObligations` ADD `installments` int NOT NULL DEFAULT 1;
--> statement-breakpoint
-- Split the generic "RENTA" placeholder into the real DIAN taxpayer categories,
-- each with its own deadline schedule.
UPDATE `taxObligations`
  SET `code` = 'RENTA_PJ',
      `name` = 'Renta - Personas Jurídicas',
      `description` = 'Declaración de renta para personas jurídicas, pagada en 2 cuotas',
      `installments` = 2
  WHERE `code` = 'RENTA';
--> statement-breakpoint
INSERT INTO `taxObligations` (`code`, `name`, `description`, `frequency`, `installments`, `isActive`) VALUES
('RENTA_PN', 'Renta - Personas Naturales', 'Declaración de renta para personas naturales. Se agrupa por los últimos DOS dígitos del NIT.', 'anual', 1, true),
('RENTA_GC', 'Renta - Grandes Contribuyentes', 'Declaración de renta para grandes contribuyentes, pagada en 3 cuotas', 'anual', 3, false),
('IVA_CUAT', 'IVA - Declaración Cuatrimestral', 'Declaración cuatrimestral de impuesto sobre las ventas (régimen de menor responsabilidad)', 'cuatrimestral', 1, true),
('RST_CONSOLIDADA', 'RST - Declaración Consolidada Anual', 'Declaración anual consolidada del Régimen Simple de Tributación', 'anual', 1, true),
('RST_ANTICIPO', 'RST - Anticipo Bimestral', 'Pago anticipado bimestral del Régimen Simple de Tributación', 'bimestral', 1, true);
--> statement-breakpoint
-- Rename for clarity now that IVA_CUAT exists as a separate option
UPDATE `taxObligations`
  SET `code` = 'IVA_BIM',
      `name` = 'IVA - Declaración Bimestral'
  WHERE `code` = 'IVA';
--> statement-breakpoint
-- Clarify that ICA is a municipal tax, not part of the DIAN calendar
UPDATE `taxObligations`
  SET `description` = 'Declaración bimestral de impuesto de industria y comercio. Es un impuesto MUNICIPAL: no aparece en el calendario tributario de la DIAN, cada municipio publica sus propias fechas.'
  WHERE `code` = 'ICA';
