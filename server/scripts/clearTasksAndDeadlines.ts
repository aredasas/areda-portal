// One-off script: wipes ALL tasks and tax deadlines (plus their attachments
// and comments) to start real tracking with a clean slate.
//
// Deliberately does NOT touch: clients, the obligations catalog,
// client-obligation assignments, collaborators, or the DIAN calendar — all
// of that is real master data you'll need afterward to regenerate July's
// deadlines per client (Vencimientos → Generar Calendario) and to create
// real tasks.
//
// Usage (Railway Console): npx tsx server/scripts/clearTasksAndDeadlines.ts CONFIRMAR
// The exact word CONFIRMAR is required — running it without an argument, or
// with anything else, does nothing and just prints what it would have done.

import "dotenv/config";
import { clearAllTasksAndDeadlines } from "../db";

async function main() {
  const confirmation = process.argv[2];

  if (confirmation !== "CONFIRMAR") {
    console.log("Este script BORRA todas las tareas y vencimientos tributarios actuales.");
    console.log("No toca clientes, obligaciones, colaboradores ni el calendario DIAN.");
    console.log("");
    console.log("Para ejecutarlo de verdad, corre:");
    console.log("  npx tsx server/scripts/clearTasksAndDeadlines.ts CONFIRMAR");
    process.exit(0);
  }

  console.log("Borrando tareas y vencimientos...");
  const result = await clearAllTasksAndDeadlines();
  console.log(`Listo. Se eliminaron ${result.tasksDeleted} tarea(s) y ${result.deadlinesDeleted} vencimiento(s), junto con sus adjuntos y comentarios.`);
  console.log("");
  console.log("Siguiente paso: ve a Vencimientos, selecciona cada cliente, y dale 'Generar Calendario' para crear los vencimientos reales de julio.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error al limpiar:", err);
  process.exit(1);
});
