import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // Módulo Informes: el libro auxiliar/movimiento puede pesar 50-100mb+
  // (cientos de miles de filas), así que se sube como binario crudo en su
  // propia ruta con un límite más alto, en vez de base64 dentro del JSON
  // global de 50mb. Restringido a la misma cédula autorizada para Informes.
  app.post(
    "/api/informes/upload",
    express.raw({ limit: "200mb", type: () => true }),
    async (req, res) => {
      try {
        const { sdk } = await import("./sdk");
        const user = await sdk.authenticateRequest(req);
        const { INFORMES_AUTHORIZED_CEDULA } = await import("../routers");
        if (!user || user.cedula !== INFORMES_AUTHORIZED_CEDULA) {
          return res.status(403).json({ error: "No autorizado" });
        }
        const clienteId = parseInt(String(req.query.clienteId));
        const nombreArchivo = String(req.query.nombreArchivo || "libro_auxiliar.xlsx");
        if (!clienteId) {
          return res.status(400).json({ error: "clienteId es requerido" });
        }

        const informesDb = await import("../informesDb");
        const cuentasConocidas = new Set((await informesDb.getCuentasPucConocidas()).keys());
        const { porPeriodo, filasPorPeriodo, totalFilas, filasOmitidas, cuentasNuevas, columnasPorIA } =
          await informesDb.parseLibroAuxiliar(req.body as Buffer, cuentasConocidas);

        if (cuentasNuevas.size > 0) {
          await informesDb.clasificarCuentasNuevas(Array.from(cuentasNuevas));
        }

        const clavesPeriodo = Object.keys(porPeriodo).sort();
        if (clavesPeriodo.length === 0) {
          return res.status(400).json({
            error: "No se encontró ninguna fila con fecha y cuenta contable válidas en el archivo.",
          });
        }

        // Un mismo archivo puede traer uno o varios meses (ej. un semestre
        // completo) — se crea una carga independiente por cada periodo
        // detectado, y cada una reemplaza los valores previos de ese
        // periodo si ya existían (mismo comportamiento que antes, ahora
        // por cada mes en vez de uno solo fijo).
        //
        // Cada periodo se procesa en su propio try/catch: si uno falla
        // (ej. un valor que no cabe en una columna, un error de conexión a
        // la base de datos), esa carga queda marcada como "error" con el
        // motivo, en vez de quedarse en "Procesando" para siempre sin
        // explicación — y los demás periodos del mismo archivo se siguen
        // procesando normalmente.
        const periodos: { anio: number; mes: number; cargaId: number; filas: number; error?: string }[] = [];
        for (const clave of clavesPeriodo) {
          const [anioStr, mesStr] = clave.split("-");
          const anio = Number(anioStr), mes = Number(mesStr);
          const filas = filasPorPeriodo[clave] || 0;
          let cargaId: number | null = null;
          try {
            cargaId = await informesDb.crearCarga({ clienteId, anio, mes, nombreArchivo, cargadoPorId: user.id });
            await informesDb.guardarSaldosMensuales(cargaId, clienteId, anio, mes, porPeriodo[clave]);
            await informesDb.marcarCargaCompletada(cargaId, filas);
            periodos.push({ anio, mes, cargaId, filas });
          } catch (errorPeriodo: any) {
            console.error(`[Informes] Error guardando periodo ${clave}:`, errorPeriodo);
            const mensaje = String(errorPeriodo?.message || errorPeriodo);
            if (cargaId) await informesDb.marcarCargaError(cargaId, mensaje);
            periodos.push({ anio, mes, cargaId: cargaId || 0, filas, error: mensaje });
          }
        }

        return res.json({
          success: true, totalFilas, filasOmitidas, columnasPorIA, periodos,
          cuentasNuevas: Array.from(cuentasNuevas),
        });
      } catch (error: any) {
        console.error("[Informes] Error al procesar carga:", error);
        return res.status(500).json({ error: error?.message || "Error al procesar el archivo" });
      }
    },
  );

  // Scheduled endpoint for deadline notifications AND auto-task generation
  app.post("/api/scheduled/deadline-alerts", async (req, res) => {
    try {
      const { sdk } = await import("./sdk");
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: "cron-only" });
      }

      const db = await import("../db");
      const { notifyOwner } = await import("./notification");

      // 1. Get the auto_task_days_before setting (default 10)
      const daysSetting = await db.getSetting("auto_task_days_before");
      const daysBeforeDeadline = daysSetting?.value ? parseInt(daysSetting.value) : 10;

      // 2. Get deadlines due within the configured days
      const upcomingDeadlines = await db.getUpcomingDeadlines(daysBeforeDeadline);
      const pendingDeadlines = upcomingDeadlines.filter((d: any) => d.status === "pendiente");

      // 3. Auto-generate tasks for deadlines that don't already have one
      let tasksCreated = 0;
      for (const deadline of pendingDeadlines) {
        // Check if a task already exists for this deadline
        const existingTasks = await db.getTasksByDeadlineId(deadline.id);
        if (existingTasks.length > 0) continue;

        // Get the client to find the manager
        const client = await db.getClientById(deadline.clientId);
        if (!client || !client.managerId) continue;

        // Create auto-generated task assigned to the client's manager
        await db.createTask({
          title: `${deadline.obligationName} - ${deadline.clientName}`,
          description: `Tarea autogenerada: Preparar y presentar ${deadline.obligationName} para ${deadline.clientName} (NIT: ${deadline.clientNit}). Per\u00edodo: ${deadline.period}. Vence: ${new Date(deadline.dueDate).toLocaleDateString("es-CO")}.`,
          clientId: deadline.clientId,
          assignedToId: client.managerId,
          createdById: -1, // System-generated
          dueDate: new Date(deadline.dueDate),
          status: "pendiente",
          priority: "alta",
          isAutoGenerated: true,
          taxDeadlineId: deadline.id,
        });
        tasksCreated++;
      }

      // 4. Send notification to owner about upcoming deadlines
      if (pendingDeadlines.length > 0) {
        const deadlineList = pendingDeadlines.slice(0, 10).map((d: any) => {
          const dueDate = new Date(d.dueDate);
          const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return `\u2022 ${d.obligationName} - ${d.clientName} (${daysLeft <= 0 ? "HOY" : daysLeft + " d\u00edas"}) - ${dueDate.toLocaleDateString("es-CO")}`;
        }).join("\n");

        const title = `\u26A0\uFE0F ${pendingDeadlines.length} vencimiento(s) tributario(s) pr\u00f3ximo(s)`;
        const content = `Los siguientes vencimientos tributarios est\u00e1n por vencer en los pr\u00f3ximos ${daysBeforeDeadline} d\u00edas:\n\n${deadlineList}${pendingDeadlines.length > 10 ? `\n\n... y ${pendingDeadlines.length - 10} m\u00e1s` : ""}\n\nTareas autogeneradas: ${tasksCreated}`;

        await notifyOwner({ title, content });
      }

      res.json({ ok: true, notified: pendingDeadlines.length, tasksCreated });
    } catch (error: any) {
      console.error("[Scheduled] deadline-alerts error:", error);
      res.status(500).json({
        error: error.message || "Unknown error",
        stack: error.stack,
        context: { url: req.url, taskUid: "unknown" },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
