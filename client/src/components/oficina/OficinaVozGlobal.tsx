import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { hablar, puedeHablar, vozActivada } from "@/lib/vozOficina";

/** Avisos de voz de la Oficina, activos en CUALQUIER página del portal (se
 * monta en el DashboardLayout, solo para el usuario de la Oficina).
 *
 * Cada medio minuto pregunta qué hizo el equipo desde la última vez —
 * quién subió una tarea para revisión, quién comentó, quién leyó una
 * observación — y lo dice en voz alta ("Jessica terminó la tarea …").
 * También anuncia las solicitudes nuevas de los agentes. Sigue funcionando
 * aunque el portal esté en una pestaña que no se está mirando.
 *
 * La memoria de qué ya se anunció vive en localStorage, porque este
 * componente se vuelve a montar al cambiar de página y porque puede haber
 * varias pestañas del portal abiertas: así nada se dice dos veces. */

const CURSOR_KEY = "oficina-voz-cursor";
const ANUNCIADOS_KEY = "oficina-voz-anunciados";
const SOLICITUDES_VISTAS_KEY = "oficina-voz-vistos";
const CADA_MS = 30_000;
/** Más novedades juntas que estas se resumen en una sola frase (ej. al
 * volver a abrir el portal después de un rato). */
const MAX_AVISOS_SEGUIDOS = 4;

function leerLista<T>(clave: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(clave) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function guardarLista<T>(clave: string, lista: T[], max: number) {
  try { localStorage.setItem(clave, JSON.stringify(lista.slice(-max))); } catch { /* sin almacenamiento */ }
}

export default function OficinaVozGlobal() {
  const utils = trpc.useUtils();
  const enCurso = useRef(false);

  useEffect(() => {
    let vivo = true;

    const revisar = async () => {
      if (!vivo || enCurso.current) return;
      enCurso.current = true;
      try {
        const frases: string[] = [];

        // ---- 1. Actividad del equipo ----
        let cursor: string | null = null;
        try { cursor = localStorage.getItem(CURSOR_KEY); } catch { /* sin almacenamiento */ }
        if (!cursor) {
          // Primera vez en este navegador: se empieza a contar desde ahora,
          // sin leer en voz alta lo que ya había pasado.
          try { localStorage.setItem(CURSOR_KEY, new Date().toISOString()); } catch { /* sin almacenamiento */ }
        } else {
          const eventos = await utils.oficina.actividad.nuevas.fetch({ desde: cursor }, { staleTime: 0 });
          const anunciados = leerLista<string>(ANUNCIADOS_KEY);
          const yaDichos = new Set(anunciados);
          const nuevos = eventos.filter(e => !yaDichos.has(e.clave));
          if (nuevos.length > 0) {
            // Se dan por anunciados aunque la voz esté apagada: al
            // encenderla después no debe soltar todo lo acumulado.
            guardarLista(ANUNCIADOS_KEY, [...anunciados, ...nuevos.map(e => e.clave)], 300);
            const ultimo = nuevos.reduce((max, e) => Math.max(max, new Date(e.cuando).getTime()), new Date(cursor).getTime());
            try { localStorage.setItem(CURSOR_KEY, new Date(ultimo).toISOString()); } catch { /* sin almacenamiento */ }
            if (vozActivada()) {
              if (nuevos.length <= MAX_AVISOS_SEGUIDOS) {
                for (const e of nuevos) { frases.push(e.voz); toast(e.texto, { duration: 8000 }); }
              } else {
                const resumen = `Hay ${nuevos.length} novedades del equipo. Pide el informe para escucharlas.`;
                frases.push(resumen);
                toast(resumen, { duration: 8000 });
              }
            }
            utils.oficina.estadista.informe.invalidate();
          }
        }

        // ---- 2. Solicitudes nuevas de los agentes ----
        const solicitudes = await utils.oficina.solicitudes.listar.fetch({}, { staleTime: 0 });
        const pendientes = solicitudes.filter(s => s.estado === "pendiente");
        const vistasGuardadas = localStorage.getItem(SOLICITUDES_VISTAS_KEY);
        const vistas = new Set(leerLista<number>(SOLICITUDES_VISTAS_KEY));
        const solicitudesNuevas = pendientes.filter(s => !vistas.has(s.id));
        if (solicitudesNuevas.length > 0) {
          guardarLista(SOLICITUDES_VISTAS_KEY, [...Array.from(vistas), ...solicitudesNuevas.map(s => s.id)], 500);
          // La primera vez (nada guardado) solo se toma nota de las que ya
          // existían, sin leerlas todas de golpe.
          if (vistasGuardadas !== null && vozActivada()) {
            frases.push(solicitudesNuevas.length === 1
              ? `Nueva alerta de la Oficina: ${solicitudesNuevas[0].titulo}`
              : `La Oficina tiene ${solicitudesNuevas.length} alertas nuevas. La más reciente: ${solicitudesNuevas[solicitudesNuevas.length - 1].titulo}`);
          }
          utils.oficina.agentes.list.invalidate();
          utils.oficina.solicitudes.listar.invalidate();
        } else if (vistasGuardadas === null) {
          guardarLista(SOLICITUDES_VISTAS_KEY, [] as number[], 500);
        }

        if (frases.length > 0 && puedeHablar()) hablar(frases, { quien: "avisos" });
      } catch {
        // Sin conexión o sesión vencida: se reintenta en el siguiente ciclo.
      } finally {
        enCurso.current = false;
      }
    };

    // Con varias pestañas del portal abiertas, solo una revisa a la vez
    // (si el navegador no tiene Web Locks, igual se evita repetir por la
    // lista de anunciados compartida).
    const tick = () => {
      const locks = (navigator as any).locks;
      if (locks?.request) locks.request("oficina-voz", { ifAvailable: true }, async (lock: unknown) => { if (lock) await revisar(); });
      else revisar();
    };

    const primero = window.setTimeout(tick, 4000);
    const intervalo = window.setInterval(tick, CADA_MS);
    return () => { vivo = false; window.clearTimeout(primero); window.clearInterval(intervalo); };
  }, [utils]);

  return null;
}
