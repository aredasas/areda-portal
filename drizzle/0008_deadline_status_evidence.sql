ALTER TABLE `taxDeadlines` MODIFY COLUMN `status` enum('pendiente','en_progreso','completado','vencido') NOT NULL DEFAULT 'pendiente';
--> statement-breakpoint
ALTER TABLE `taxDeadlines` ADD `evidenceFileUrl` text;
--> statement-breakpoint
ALTER TABLE `taxDeadlines` ADD `evidenceFileKey` text;
