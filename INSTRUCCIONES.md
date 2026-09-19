# Fix: Menú Tareas – fila muy ancha por la observación de corrección

## Problema reportado
Cuando una tarea se devuelve "para corrección" o "para completar", la observación
(`task.reviewNotes`) se mostraba completa dentro del badge, sin límite de ancho.
Esto hacía que la fila de la tabla se estirara muchísimo, empujando los botones
de acción (Editar, Subir soporte, Cancelar, etc.) muy lejos hacia la derecha.
Como la barra de desplazamiento horizontal pertenece a todo el contenedor de la
tabla, terminaba ubicada al final de todo el listado (abajo del todo), siendo
incómodo encontrarla para poder ver esos botones.

## Solución aplicada
Archivo modificado: `client/src/pages/Tareas.tsx`

1. **Observación truncada dentro del badge**: el texto de `reviewNotes` ahora
   se corta con `truncate` y un ancho máximo (`max-w-[140px]`) dentro del badge.
   El texto completo sigue disponible pasando el mouse por encima (`title` con
   tooltip nativo del navegador), incluyendo ahora también el propio texto de
   la observación (antes el tooltip solo mostraba quién la escribió).

2. **Columna "Acciones" siempre visible (sticky)**: tanto el encabezado como
   cada celda de la columna "Acciones" ahora usan `sticky right-0`, por lo que
   quedan ancladas al borde derecho de la tabla y permanecen visibles sin
   necesidad de desplazarse horizontalmente, sin importar cuánto contenido
   tengan las demás columnas. Se agregó una sombra sutil a la izquierda de la
   columna para diferenciarla visualmente del resto de la fila al hacer scroll.

3. Los botones de esa columna ahora pueden pasar a una segunda línea
   (`flex-wrap`) dentro de un ancho máximo, en vez de estirarse indefinidamente
   hacia la derecha.

## Resultado
- La fila ya no se estira de forma descontrolada por observaciones largas.
- Los botones de acción (Ver detalle, Editar, Subir soporte, Reabrir, Cancelar)
  quedan siempre visibles en el borde derecho de la tabla, sin tener que buscar
  la barra de desplazamiento al final del listado.
- La observación completa se sigue pudiendo consultar dejando el mouse sobre
  el badge correspondiente.

## Validación realizada
- `tsc --noEmit`: mismo número de errores preexistentes (33) antes y después
  del cambio — no se introdujeron errores nuevos de TypeScript.
- `diff` contra el repositorio original: solo se modificó `Tareas.tsx`, sin
  cambios accidentales en otros archivos.
- Se incluye el diff completo (`Tareas.tsx.diff`) para revisión.

## Cómo aplicar
1. Reemplaza el archivo `client/src/pages/Tareas.tsx` de tu repositorio por el
   que está en este paquete (misma ruta: `client/src/pages/Tareas.tsx`).
2. Confirma los cambios y súbelos:
   ```
   git add client/src/pages/Tareas.tsx
   git commit -m "Fix Tareas: truncar observacion de correccion y fijar columna de acciones"
   git push
   ```
3. Railway desplegará automáticamente al detectar el push.

No se requieren cambios de base de datos ni variables de entorno nuevas.
