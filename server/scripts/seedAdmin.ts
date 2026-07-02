// One-off script: creates the first admin collaborator.
// Usage: npx tsx server/scripts/seedAdmin.ts <cedula> <password> "<nombre completo>"
// Run once against production (e.g. via Railway's Console tab), then delete
// or ignore — createCollaborator() rejects a duplicate username on rerun.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { createCollaborator, getUserByUsername } from "../db";

async function main() {
  const [cedula, password, nombre] = process.argv.slice(2);

  if (!cedula || !password || !nombre) {
    console.error(
      'Uso: npx tsx server/scripts/seedAdmin.ts <cedula> <password> "<nombre completo>"'
    );
    process.exit(1);
  }

  const existing = await getUserByUsername(cedula);
  if (existing) {
    console.error(`Ya existe un usuario con la cédula ${cedula}. No se creó nada nuevo.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = await createCollaborator({
    name: nombre,
    username: cedula,
    cedula,
    passwordHash,
    role: "admin",
  });

  console.log(`Administrador creado con éxito (id ${id}). Ya puedes iniciar sesión con la cédula ${cedula}.`);
  process.exit(0);
}

main().catch(err => {
  console.error("Error creando el administrador:", err);
  process.exit(1);
});
