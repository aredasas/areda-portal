ALTER TABLE `rentaClientes` ADD `driveFolderUrl` text;--> statement-breakpoint
ALTER TABLE `rentaClientes` ADD `estadoRevision` enum('solicitada','aprobada','rechazada');--> statement-breakpoint
ALTER TABLE `rentaClientes` ADD `revisionSolicitadaPorId` int;--> statement-breakpoint
ALTER TABLE `rentaClientes` ADD `revisionSolicitadaAt` timestamp;--> statement-breakpoint
ALTER TABLE `rentaClientes` ADD `revisionComentario` text;--> statement-breakpoint
ALTER TABLE `rentaClientes` ADD `declaracionFileKey` varchar(500);