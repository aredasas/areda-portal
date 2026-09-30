# Cuentas de Cobro para Clientes Generales (prefijo AP)

## Qué se hizo

En el menú **Clientes** (los clientes generales de la firma, no los de Renta
Persona Natural) se agregó una segunda pestaña **"Cuentas de Cobro"**, con la
misma dinámica que ya usan las cuentas de cobro de Renta PN:

- Eliges el cliente, escribes el detalle y el valor, y se genera un PDF de
  cuenta de cobro con el mismo formato que ya usa Arlex (fecha, folio, "Debe
  a" con los datos fijos de Arlex, tabla de detalle/valor, total, el valor en
  letras, la nota del Art. 103/383 ET, los datos de pago y la firma).
- **Prefijo `AP`** (en vez de `R25`, que es el de Renta PN).
- **Numeración**: se retoma la numeración que se llevaba en el sistema
  anterior. El último número usado fue **638**, así que la primera cuenta de
  cobro que se genere aquí sale con el número **639**, y de ahí sigue
  aumentando normalmente (640, 641, ...).
- **Encabezado del cliente en el PDF**: además del nombre y el NIT (que es lo
  único que muestra Renta PN), aquí también se incluyen la **dirección** y el
  **teléfono** del cliente, cuando los tenga registrados.
- Se guarda un historial de todas las cuentas de cobro generadas, con botón
  para descargar el PDF de cada una.
- **Eliminar**: igual que en Renta PN, solo Arlex (por su cédula) puede
  borrar una cuenta de cobro ya generada. Cualquier otro admin puede
  generarlas, pero no borrarlas.

No se tocó nada de la pestaña de Renta PN ni de sus cuentas de cobro — es una
funcionalidad totalmente independiente, aunque comparte el mismo estilo
visual y el mismo PDF.

## Archivos incluidos (carpeta `archivos_modificados/`)

Reemplaza estos archivos en tu repositorio, respetando la misma ruta:

- `client/src/pages/Clientes.tsx` — pestañas "Clientes" / "Cuentas de Cobro"
  y el formulario/listado nuevo.
- `server/db.ts` — funciones nuevas para listar, generar el siguiente
  número (con el piso en 638→639) y guardar/eliminar cuentas de cobro de
  clientes generales.
- `server/routers.ts` — endpoints nuevos `clients.cuentasCobro.listar`,
  `clients.cuentasCobro.siguienteNumero`, `clients.cuentasCobro.guardar` y
  `clients.cuentasCobro.eliminar`.
- `server/clienteCuentaCobroPdf.ts` — **archivo nuevo**, genera el PDF de la
  cuenta de cobro para clientes generales (con dirección y teléfono).
- `drizzle/schema.ts` — se agregó la tabla nueva `cuentasCobroClientes`.
- `drizzle/0063_slow_loki.sql` — **migración nueva**, crea la tabla
  `cuentasCobroClientes`. No modifica ninguna tabla existente.
- `drizzle/meta/0063_snapshot.json` y `drizzle/meta/_journal.json` — archivos
  internos que Drizzle necesita junto con la migración.

## Cómo aplicar los cambios

1. Copia los archivos de `archivos_modificados/` a tu repositorio local, en
   las mismas rutas.
2. Sube los cambios a GitHub:
   ```
   git add client/src/pages/Clientes.tsx server/db.ts server/routers.ts server/clienteCuentaCobroPdf.ts drizzle/schema.ts drizzle/0063_slow_loki.sql drizzle/meta/0063_snapshot.json drizzle/meta/_journal.json
   git commit -m "Agregar cuentas de cobro para clientes generales (prefijo AP)"
   git push
   ```
3. Railway va a desplegar automáticamente al hacer push.
4. **Falta un paso manual**: entra a la Consola de Railway (la misma consola
   donde corriste la migración anterior de "Oficina") y ejecuta:
   ```
   npx drizzle-kit migrate
   ```
   Esto crea la tabla nueva `cuentasCobroClientes` en la base de datos de
   producción. Es una tabla nueva, no modifica ni borra nada existente.

## Validación que se hizo antes de entregar

- `tsc --noEmit`: el proyecto compila con exactamente los mismos 33 errores
  que ya existían antes de este cambio (ninguno nuevo viene de los archivos
  que se tocaron aquí).
- `vite build`: el frontend compila sin errores.
- Se comparó el código contra una copia nueva y limpia del repositorio para
  confirmar que **solo** cambiaron los archivos listados arriba (más la
  migración nueva) — nada más se modificó por accidente.
- La migración se generó con Drizzle Kit y se revisó a mano: es un `CREATE
  TABLE` limpio, no toca ninguna tabla existente.

**Importante**: en este entorno no tengo una base de datos MySQL real para
probar el flujo completo de extremo a extremo (crear, listar, generar el PDF
con datos reales, eliminar). La lógica se revisó con cuidado y sigue
exactamente el mismo patrón que ya funciona en producción para Renta PN, así
que el riesgo es bajo, pero vale la pena que hagas una prueba rápida en
Railway después de desplegar: genera una cuenta de cobro de prueba para
cualquier cliente y confirma que el PDF sale bien, con el número **AP -
0639** en la primera.
