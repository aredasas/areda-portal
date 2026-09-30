# Módulo Oficina — Fase 1: Estadista de Tareas

Primera entrega del módulo **Oficina** que hablamos: un menú nuevo, **visible
solo para tu usuario** (cédula 5.820.262 — el mismo control que ya usan
Asistencia y "eliminar cuenta de cobro"), con la escena gráfica del kit de
Pulpo Starter y el primer agente funcionando de verdad: el **Estadista de
Tareas**.

Los otros dos agentes (Correo y Monitor de Desarrollo) ya aparecen como
escritorios "próximamente" en la oficina, para que la escena se vea completa,
pero todavía no hacen nada — van en la siguiente entrega, como acordamos.

## Qué puedes hacer ya

1. Entra a **Oficina** en el menú lateral (solo tú la ves).
2. Verás la oficina con el escritorio del Estadista al frente. Haz clic
   sobre el personaje o el escritorio para abrir su ventana, con 3 pestañas:
   - **Chat**: puedes preguntarle directamente, ej. *"¿qué tareas están
     represadas ahora mismo?"* — responde con IA (Claude, la misma que ya usa
     el resto del portal) basándose en los hallazgos reales de la última
     revisión.
   - **Solicitudes**: historial de todo lo que este agente ha encontrado.
   - **Configuración**: puedes cambiarle el nombre, la personalidad, el
     objetivo, la especialidad, y su "esfuerzo de razonamiento" (Piensa
     poco / Equilibrado / Piensa mucho) — igual que planteaba el kit
     original.
3. Botón **"Revisar ahora"**: corre el análisis en el momento. Revisa TODAS
   las tareas activas de Areda Work y detecta:
   - **Vencidas**: no completadas y con fecha límite ya pasada.
   - **Represadas**: devueltas para corrección o para completar, y sin
     movimiento hace más de 5 días — se quedaron "colgadas".
   - **Olvidadas**: sin fecha límite, pendientes o en progreso, sin tocarse
     hace más de 10 días.
   - Además calcula el **% de cumplimiento a tiempo por colaborador**
     (se lo puedes preguntar en el chat, o pedírselo en el resumen).
4. Cada hallazgo nuevo aparece como una **solicitud pendiente** — el
   personaje levanta la mano en la oficina y también se ve en el panel de
   abajo. Puedes marcarla como **atendida** (✓) o **descartarla** (✗). Si el
   problema sigue existiendo en la próxima revisión, vuelve a aparecer —
   atender o descartar aquí no cambia nada en Tareas, es solo para que no te
   pierdas el hallazgo.
5. **Notificaciones de voz**: botón arriba a la derecha, "Voz
   desactivada/activada". Actívalo y, mientras dejes esa pestaña de Areda
   Work abierta (aunque esté minimizada o en segundo plano), el navegador
   leerá en voz alta cada hallazgo NUEVO que aparezca — sin costo ni cuenta
   externa, usa la voz integrada de Chrome. Por ahora solo suena si tienes la
   pestaña abierta cuando "Revisar ahora" se ejecuta (todavía no hay revisión
   automática en segundo plano — ver "Pendiente" abajo).

## Cómo aplicar

1. Reemplaza/agrega estos archivos en tu repositorio (mismas rutas):
   - `drizzle/schema.ts`
   - `drizzle/0062_colossal_victor_mancha.sql` (archivo nuevo)
   - `drizzle/meta/0062_snapshot.json` (archivo nuevo)
   - `drizzle/meta/_journal.json`
   - `server/routers.ts`
   - `server/oficinaDb.ts` (archivo nuevo)
   - `client/src/App.tsx`
   - `client/src/components/DashboardLayout.tsx`
   - `client/src/pages/Oficina.tsx` (archivo nuevo)
   - `client/public/oficina/*.png` (9 imágenes nuevas — la carpeta completa)
2. Confirma y sube los cambios:
   ```
   git add drizzle client/src/App.tsx client/src/components/DashboardLayout.tsx client/src/pages/Oficina.tsx client/public/oficina server/routers.ts server/oficinaDb.ts
   git commit -m "Modulo Oficina: agente Estadista de Tareas (fase 1)"
   git push
   ```
3. **Corre la migración en la consola de Railway** (crea las 4 tablas nuevas —
   no toca ninguna tabla existente):
   ```
   npx drizzle-kit migrate
   ```
4. No hace falta ninguna variable de entorno nueva — el agente usa el mismo
   `ANTHROPIC_API_KEY` que ya está configurado y que usa el resto del portal
   (Asistente IA, extracción DIAN, etc.).

## Validación realizada

- `tsc --noEmit`: mismo número de errores preexistentes (33) antes y después
  — no se introdujo ningún error nuevo.
- `vite build`: compila limpio, sin advertencias nuevas.
- Migración generada con `drizzle-kit generate`: 100% aditiva — solo crea
  tablas nuevas (`oficinaAgentes`, `oficinaMensajes`, `oficinaSolicitudes`,
  `oficinaRevisiones`), no modifica ninguna existente.
- `diff` contra el repositorio original: confirma que solo cambiaron los
  archivos listados arriba, sin tocar nada del resto de la aplicación.
- No pude levantar una base de datos real en este entorno para probar el
  flujo de punta a punta contra MySQL (sin acceso a Docker/apt aquí) — la
  lógica se revisó a mano con cuidado, pero te recomiendo darle "Revisar
  ahora" una primera vez después de desplegar y confirmar que los hallazgos
  se vean coherentes con lo que tienes hoy en Tareas.

## Qué falta (siguiente entrega, como acordamos)

- **Revisión automática programada** (cron): por ahora el análisis solo
  corre cuando tú le das "Revisar ahora". El backend ya tiene el patrón para
  un job periódico (igual al que ya usan los recordatorios de vencimientos),
  pero registrar ese cron contra tu servidor de Railway ya desplegado es un
  paso aparte que prefiero hacer una vez confirmes que esta primera versión
  funciona bien — así no dejamos algo corriendo solo sin que lo hayas visto
  primero.
- **Agente de Correo** (contacto@ e ibague@aredasas.com): pendiente de que
  actives la delegación de dominio en Google Workspace para el Service
  Account, como quedamos — te aviso cuando estemos listos para ese paso.
- **Monitor de Desarrollo**: se conecta como tarea programada de Claude Code,
  aparte de este módulo — entrega independiente.
- Por ahora el Estadista analiza `tasks` (tareas) — si quieres que también
  desglose `taxDeadlines` (vencimientos) por separado, dímelo y lo sumamos
  (hoy los vencimientos con tarea generada automáticamente ya quedan
  cubiertos indirectamente a través de esa tarea).
