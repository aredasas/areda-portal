# Fix: ícono para eliminar cuentas de cobro (Renta PN → pestaña CTA), solo para Arlex

## Qué se agregó
En la pestaña **CTA** de Renta Persona Natural, cada cuenta de cobro generada
ahora muestra un ícono de eliminar (🗑) al final de la fila, junto al botón de
descarga. Al hacer clic pide confirmación y borra el registro definitivamente.

**El ícono solo aparece para Arlex** — no para cualquier otro administrador
que también tenga acceso al módulo Renta PN. Se usó la misma cédula con la
que ya está restringida la pestaña "Asistencia" y la "Zona de riesgo" de
limpiar datos de Liquidación, así que no se creó ningún mecanismo nuevo de
identificación.

## Dónde quedó la restricción (dos capas, no solo visual)
1. **Frontend** (`RentaPersonaNatural.tsx`): el botón no se renderiza si el
   usuario logueado no tiene la cédula de Arlex — así ni siquiera lo ve otro
   administrador.
2. **Backend** (`routers.ts`, endpoint `renta.cuentasCobro.eliminar`): aunque
   alguien intente llamar la API directamente, el servidor vuelve a validar
   la misma cédula y rechaza la solicitud si no coincide. Esta es la
   protección real — la del frontend es solo para que la opción ni se
   muestre.

## Archivos modificados
- `client/src/pages/RentaPersonaNatural.tsx` — botón "Eliminar" en la lista
  de cuentas de cobro (visible solo para Arlex), con confirmación antes de
  borrar.
- `server/routers.ts` — nuevo endpoint `renta.cuentasCobro.eliminar`,
  restringido a la cédula de Arlex.
- `server/db.ts` — nueva función `eliminarRentaCuentaCobro(id)`.

Se incluye `cambios.diff` con el detalle línea por línea si quieres revisarlo
antes de aplicar.

## Importante
- Solo se borra el **registro** de la cuenta de cobro (deja de aparecer en el
  listado y se libera su número de folio para reutilizarse). El PDF ya
  generado queda igual en el almacenamiento — no se borra el archivo, igual
  que pasa con el resto de documentos de la aplicación.
- La acción es irreversible: una vez confirmado el borrado, no hay forma de
  recuperar el registro desde la aplicación.
- No requiere ninguna migración de base de datos — no se tocó el esquema.

## Validación realizada
- `tsc --noEmit`: mismo número de errores preexistentes (33) antes y después
  del cambio — no se introdujeron errores nuevos de TypeScript.
- `diff` contra el repositorio original: solo se modificaron los 3 archivos
  listados arriba, sin cambios accidentales en ningún otro lugar.

## Cómo aplicar
1. Reemplaza estos 3 archivos en tu repositorio por los de este paquete
   (mismas rutas):
   - `client/src/pages/RentaPersonaNatural.tsx`
   - `server/db.ts`
   - `server/routers.ts`
2. Confirma los cambios y súbelos:
   ```
   git add client/src/pages/RentaPersonaNatural.tsx server/db.ts server/routers.ts
   git commit -m "Fead Renta PN, icono para eliminar cuentas de cobro restringido a Arlex"
   git push
   ```
3. Railway desplegará automáticamente al detectar el push. No hace falta
   correr ninguna migración en la consola de Railway.
