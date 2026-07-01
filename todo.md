# Areda Work - TODO

## Autenticación y Roles
- [x] Login seguro con autenticación local (cédula/usuario + contraseña)
- [x] Solo el administrador puede crear nuevos colaboradores
- [x] Cuatro roles: Administrador, Contador Senior, Contador Junior, Asistente
- [x] Cambio de contraseña por el usuario
- [x] Permitir mismo email para múltiples usuarios (login por username/cédula)
- [x] Creación de colaboradores por el administrador (formulario completo con username, cédula, password)
- [x] Filtros por rol y estado en listado de colaboradores
- [x] Desactivar/reactivar colaboradores

## Gestión de Clientes
- [x] CRUD de clientes con datos básicos
- [x] Carga del RUT (PDF o imagen)
- [x] Extracción automática de datos del RUT por IA (razón social, NIT, dirección, actividad económica)
- [x] Selección de obligaciones integrada en formulario de crear/editar cliente
- [x] Asignación de manager (colaborador responsable) al cliente
- [x] Búsqueda por nombre o NIT

## Obligaciones Tributarias
- [x] Lista predefinida de obligaciones colombianas (IVA bimestral, cuatrimestral, anual, Retención, ICA, Renta, INC, etc.)
- [x] Rete ICA Bimestral agregado
- [x] Asignación de obligaciones por cliente
- [x] Generación automática de vencimientos según calendario tributario

## Calendario de Vencimientos
- [x] Calendario global mensual con navegación
- [x] Vista semanal con navegación y toggle Mes/Semana
- [x] Vista de calendario mensual por cliente con selector de mes/año
- [x] Solo mostrar vencimientos del mes seleccionado (tabla filtrada)
- [x] Tooltips con detalle de obligaciones por día
- [x] Actualización de estado de vencimientos (pendiente/completado/vencido)

## Tareas
- [x] Crear tareas vinculadas a cliente con título, descripción, responsable, fecha límite, prioridad
- [x] Adjuntar archivos (Excel, Word, PDF, imágenes) al crear o durante la tarea
- [x] Completar tarea requiere confirmación + subir evidencia obligatoria
- [x] Admin puede reabrir tareas completadas por error
- [x] Filtros por estado (Pendientes, En Progreso, Completadas, Vencidas)
- [x] Vista de detalle con adjuntos y evidencia

## Dashboard
- [x] KPIs de tareas (pendientes, en progreso, completadas, vencidas)
- [x] Tareas agrupadas por estado en listado del dashboard
- [x] Carga de trabajo por colaborador
- [x] Próximo Mes: vencimientos tributarios y tareas con fecha límite

## Documentos
- [x] Sección Documentos con enlace a carpeta de Google Drive
- [x] Admin configura la URL de la carpeta de Drive
- [x] Colaboradores pueden abrir Drive directamente

## Configuración
- [x] Calendario DIAN configurable (admin sube CSV con fechas oficiales)
- [x] Parseo de CSV con vista previa antes de cargar
- [x] Configuración general (días de anticipación para alertas y tareas automáticas)

## Alertas y Automatización
- [x] Endpoint de alertas diarias listo para activar post-deploy
- [x] Tareas automáticas de impuestos generadas 10 días antes del vencimiento (configurable)

## Diseño Visual
- [x] Paleta de colores oficial (#42302E, #EDA011, #A9AD94, #F6DAAB, #FFFFFF)
- [x] Logo oficial de Areda integrado en sidebar y login
- [x] Tema global con CSS variables OKLCH

## Pruebas
- [x] Tests unitarios de autenticación (logout)
- [x] Tests de control de acceso por roles (admin vs non-admin)
- [x] Tests de acceso protegido a módulos (clientes, tareas, obligaciones, dashboard, settings, DIAN)
- [x] 16 tests pasando correctamente

## Arquitectura Futura (preparada, no implementada)
- [ ] Acceso de clientes al portal (arquitectura lista con campo clientAccessEnabled)
- [ ] Notificaciones por email a colaboradores
- [ ] Vista de calendario semanal detallada con drag-and-drop
