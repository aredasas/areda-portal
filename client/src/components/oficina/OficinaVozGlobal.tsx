import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { alHacerClic, hablar, puedeHablar, vozActivada } from "@/lib/vozOficina";

/** Avisos de voz de la Oficina, activos en CUALQUIER página del portal (se
 * monta en el DashboardLayout, solo para el usuario de la Oficina).
 *
 * Cada medio minuto pregunta qué hizo el equipo desde la última vez —
 * quién envió una tarea a revisión, quién comentó, quién leyó un mensaje o
 * una observación — y lo dice en voz alta ("Jessica terminó la tarea …").
 * También anuncia las alertas nuevas de los agentes.
 *
 * Para que ningún aviso se pierda:
 *   - Lo que hay por decir se guarda en una lista compartida entre las
 *     pestañas del portal (localStorage). Una pestaña averigua las
 *     novedades; las dice la que pueda hablar.
 *   - El navegador solo deja hablar a una página en la que ya se hizo clic.
 *     Si todavía no se ha hecho, el aviso se queda en la lista y se dice
 *     con el primer clic o tecla, en vez de perderse.
 *   - Si una frase falla, se reintenta; nada se da por dicho hasta que el
 *     navegador confirma que la dijo.
 *
 * La memoria de qué ya se anunció también vive en localStorage, porque este
 * componente se vuelve a montar al cambiar de página. */

const CURSOR_KEY = "oficina-voz-cursor";
const ANUNCIADOS_KEY = "oficina-voz-anunciados";
const SOLICITUDES_VISTAS_KEY = "oficina-voz-vistos";
const PENDIENTES_KEY = "oficina-voz-pendientes";
const CADA_MS = 30_000;
/** Más avisos juntos que estos se resumen en una sola frase (ej. al volver
 * a abrir el portal después de un rato). */
const MAX_AVISOS_SEGUIDOS = 4;
/** Un aviso que lleva más de esto sin poder decirse ya no es novedad. */
const VIGENCIA_MS = 12 * 60 * 60 * 1000;
const MAX_INTENTOS = 3;
const TOAST_ESPERA = "oficina-voz-espera";

type Pendiente = { id: string; texto: string; cuando: number; intentos: number };

function leerLista<T>(clave: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(clave) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function guardarLista<T>(clave: string, lista: T[], max: number) {
  try { localStorage.setItem(clave, JSON.stringify(lista.slice(-max))); } catch { /* sin almacenamiento */ }
}
const leerPendientes = () => leerLista<Pendiente>(PENDIENTES_KEY).filter(p => p && typeof p.texto === "string" && Date.now() - p.cuando < VIGENCIA_MS);
function encolar(textos: string[], intentos = 0) {
  if (textos.length === 0) return;
  const ahora = Date.now();
  guardarLista(PENDIENTES_KEY, [...leerPendientes(), ...textos.map((texto, i) => ({ id: `${ahora}-${i}-${Math.random().toString(36).slice(2, 7)}`, texto, cuando: ahora, intentos }))], 60);
}

export default function OficinaVozGlobal() {
  const utils = trpc.useUtils();
  const enCurso = useRef(false);
  /** El navegador rechazó la voz por falta de un clic en ESTA pestaña. */
  const esperandoClic = useRef(false);

  useEffect(() => {
    let vivo = true;

    /** Dice lo que haya en la lista compartida, si esta pestaña puede. */
    const decirPendientes = () => {
      if (!puedeHablar() || !vozActivada()) {
        // Con la voz apagada no se acumula nada para soltarlo después.
        if (leerLista(PENDIENTES_KEY).length > 0) guardarLista(PENDIENTES_KEY, [], 60);
        toast.dismiss(TOAST_ESPERA);
        return;
      }
      if (esperandoClic.current) return; // otra pestaña que sí pueda los dirá; esta, al primer clic
      const pendientes = leerPendientes();
      if (pendientes.length === 0) { toast.dismiss(TOAST_ESPERA); return; }
      // Se toman todos de una vez: así ninguna otra pestaña repite los mismos.
      guardarLista(PENDIENTES_KEY, [], 60);
      const intentos = Math.max(...pendientes.map(p => p.intentos));
      const textos = pendientes.length <= MAX_AVISOS_SEGUIDOS
        ? pendientes.map(p => p.texto)
        : [`Hay ${pendientes.length} novedades del equipo. Pide el informe para escucharlas.`];
      hablar(textos, {
        quien: "avisos",
        alFallar: (texto, motivo) => {
          if (motivo === "not-allowed") {
            // Falta un clic en esta pestaña: el aviso vuelve a la lista y
            // se dice apenas se haga clic (aquí o en otra pestaña del portal).
            esperandoClic.current = true;
            encolar([texto], intentos);
            toast("Hay avisos de voz en espera", {
              id: TOAST_ESPERA, duration: Infinity,
              description: "El navegador solo deja hablar después de un clic en la página. Haz clic en cualquier parte para escucharlos.",
            });
          } else if (intentos + 1 < MAX_INTENTOS) {
            encolar([texto], intentos + 1);
          }
        },
      });
    };

    const revisar = async () => {
      if (!vivo || enCurso.current) return;
      enCurso.current = true;
      try {
        const frases: string[] = [];
        const activa = vozActivada();

        // ---- 1. Actividad del equipo ----
        let cursor: string | null = null;
        try { cursor = localStorage.getItem(CURSOR_KEY); } catch { /* sin almacenamiento */ }
        const { ahora, eventos } = await utils.oficina.actividad.nuevas.fetch({ desde: cursor }, { staleTime: 0 });
        const horaServidor = new Date(ahora).getTime();
        if (!cursor || new Date(cursor).getTime() > horaServidor) {
          // Primera vez en este navegador (o el reloj del computador va
          // adelantado): se empieza a contar desde la hora del servidor,
          // sin leer en voz alta lo que ya había pasado.
          try { localStorage.setItem(CURSOR_KEY, new Date(horaServidor).toISOString()); } catch { /* sin almacenamiento */ }
        } else {
          const anunciados = leerLista<string>(ANUNCIADOS_KEY);
          const yaDichos = new Set(anunciados);
          const nuevos = eventos.filter(e => !yaDichos.has(e.clave));
          if (nuevos.length > 0) {
            // Se dan por anunciados aunque la voz esté apagada: al
            // encenderla después no debe soltar todo lo acumulado.
            guardarLista(ANUNCIADOS_KEY, [...anunciados, ...nuevos.map(e => e.clave)], 300);
            const ultimo = nuevos.reduce((max, e) => Math.max(max, new Date(e.cuando).getTime()), new Date(cursor).getTime());
            try { localStorage.setItem(CURSOR_KEY, new Date(ultimo).toISOString()); } catch { /* sin almacenamiento */ }
            if (activa) {
              // La misma frase no se repite (ej. varias notificaciones de una misma tarea).
              const unicos = nuevos.filter((e, i) => nuevos.findIndex(x => x.voz === e.voz) === i);
              for (const e of unicos) frases.push(e.voz);
              if (unicos.length <= MAX_AVISOS_SEGUIDOS) for (const e of unicos) toast(e.texto, { duration: 8000 });
              else toast(`Hay ${unicos.length} novedades del equipo`, { duration: 8000 });
            }
            utils.oficina.estadista.informe.invalidate();
          }
        }

        // ---- 2. Alertas nuevas de los agentes ----
        const solicitudes = await utils.oficina.solicitudes.listar.fetch({}, { staleTime: 0 });
        const pendientes = solicitudes.filter(s => s.estado === "pendiente");
        const vistasGuardadas = localStorage.getItem(SOLICITUDES_VISTAS_KEY);
        const vistas = new Set(leerLista<number>(SOLICITUDES_VISTAS_KEY));
        const solicitudesNuevas = pendientes.filter(s => !vistas.has(s.id));
        if (solicitudesNuevas.length > 0) {
          guardarLista(SOLICITUDES_VISTAS_KEY, [...Array.from(vistas), ...solicitudesNuevas.map(s => s.id)], 500);
          // La primera vez (nada guardado) solo se toma nota de las que ya
          // existían, sin leerlas todas de golpe.
          if (vistasGuardadas !== null && activa) {
            frases.push(solicitudesNuevas.length === 1
              ? `Nueva alerta de la Oficina: ${solicitudesNuevas[0].titulo}`
              : `La Oficina tiene ${solicitudesNuevas.length} alertas nuevas. La más reciente: ${solicitudesNuevas[solicitudesNuevas.length - 1].titulo}`);
          }
          utils.oficina.agentes.list.invalidate();
          utils.oficina.solicitudes.listar.invalidate();
        } else if (vistasGuardadas === null) {
          guardarLista(SOLICITUDES_VISTAS_KEY, [] as number[], 500);
        }

        if (activa) encolar(frases);
      } catch {
        // Sin conexión o sesión vencida: se reintenta en el siguiente ciclo.
      } finally {
        enCurso.current = false;
      }
      if (vivo) decirPendientes();
    };

    // Con varias pestañas del portal abiertas, solo una trabaja a la vez
    // (sin Web Locks igual no se repite nada: las listas son compartidas).
    const conTurno = (tarea: () => void | Promise<void>) => {
      const locks = (navigator as any).locks;
      if (locks?.request) locks.request("oficina-voz", { ifAvailable: true }, async (lock: unknown) => { if (lock) await tarea(); });
      else tarea();
    };
    const tick = () => conTurno(revisar);

    const primero = window.setTimeout(tick, 4000);
    const intervalo = window.setInterval(tick, CADA_MS);

    // Primer clic o tecla: ya se puede hablar; se dice lo que estaba en espera.
    const quitarClic = alHacerClic(() => {
      if (!esperandoClic.current) return;
      esperandoClic.current = false;
      toast.dismiss(TOAST_ESPERA);
      conTurno(decirPendientes);
    });
    // Otra pestaña dejó avisos en la lista (ella no puede hablar): los dice esta.
    const alCambiarLista = (e: StorageEvent) => { if (e.key === PENDIENTES_KEY && e.newValue && e.newValue !== "[]") conTurno(decirPendientes); };
    window.addEventListener("storage", alCambiarLista);
    // Al volver a mirar el portal se revisa de una vez, sin esperar el ciclo
    // (en segundo plano el navegador espacia los relojes de la página).
    const alVolver = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", alVolver);

    // Una página que sostiene un "lock" no es congelada por el navegador
    // cuando lleva rato en segundo plano; así los avisos siguen llegando.
    let soltar: (() => void) | null = null;
    try {
      (navigator as any).locks?.request?.("oficina-voz-despierta", { mode: "shared" }, () => new Promise<void>(resolver => { soltar = resolver; }));
    } catch { /* navegador sin Web Locks */ }

    return () => {
      vivo = false;
      window.clearTimeout(primero);
      window.clearInterval(intervalo);
      quitarClic();
      window.removeEventListener("storage", alCambiarLista);
      document.removeEventListener("visibilitychange", alVolver);
      soltar?.();
    };
  }, [utils]);

  return null;
}
