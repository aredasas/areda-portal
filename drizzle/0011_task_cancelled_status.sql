ALTER TABLE `tasks` MODIFY COLUMN `status` enum('pendiente','en_progreso','completada','vencida','cancelada') NOT NULL DEFAULT 'pendiente';
