import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle, Loader2, Send, RefreshCw, Volume2, VolumeX, Check, X,
  MessageSquare, Inbox, Settings, Sparkles, Mail, AtSign, ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { BandejaCorreoTab, BuzonesCorreoTab } from "@/components/oficina/CorreoAgente";

const VOZ_KEY = "oficina-voz-activa";
const VOZ_VISTOS_KEY = "oficina-voz-vistos";

/** Lee/escribe en voz alta las solicitudes nuevas de los agentes mientras
 * esta pestaña siga abierta — usa la síntesis de voz del navegador (Web
 * Speech API), sin costo ni cuenta externa. Compara contra los IDs ya
 * anunciados (persistidos en localStorage) para no repetir en cada
 * refresco ni al recargar la página. */
function useVozOficina(solicitudesPendientes: { id: number; titulo: string; severidad: string }[] | undefined) {
  const [vozActiva, setVozActiva] = useState(() => {
    try { return localStorage.getItem(VOZ_KEY) === "1"; } catch { return false; }
  });
  const vistosRef = useRef<Set<number>>(new Set());
  const inicializado = useRef(false);

  useEffect(() => {
    try {
      const guardados = JSON.parse(localStorage.getItem(VOZ_VISTOS_KEY) || "[]");
      vistosRef.current = new Set(guardados);
    } catch { /* ignora */ }
  }, []);

  useEffect(() => {
    if (!solicitudesPendientes) return;
    // La primera carga solo marca como "vistas" las que ya existían —
    // evita que al abrir la página se lean en voz alta todas de golpe.
    if (!inicializado.current) {
      inicializado.current = true;
      for (const s of solicitudesPendientes) vistosRef.current.add(s.id);
      guardarVistos();
      return;
    }
    const nuevas = solicitudesPendientes.filter(s => !vistosRef.current.has(s.id));
    if (nuevas.length === 0) return;
    for (const s of nuevas) vistosRef.current.add(s.id);
    guardarVistos();

    if (!vozActiva) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const texto = nuevas.length === 1
      ? `Nueva alerta de la Oficina: ${nuevas[0].titulo}`
      : `La Oficina tiene ${nuevas.length} alertas nuevas. La más reciente: ${nuevas[nuevas.length - 1].titulo}`;
    const utterance = new SpeechSynthesisUtterance(texto);
    utterance.lang = "es-CO";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }, [solicitudesPendientes, vozActiva]);

  function guardarVistos() {
    try { localStorage.setItem(VOZ_VISTOS_KEY, JSON.stringify(Array.from(vistosRef.current))); } catch { /* ignora */ }
  }

  const toggleVoz = () => {
    setVozActiva(v => {
      const nuevo = !v;
      try { localStorage.setItem(VOZ_KEY, nuevo ? "1" : "0"); } catch { /* ignora */ }
      if (nuevo && typeof window !== "undefined" && "speechSynthesis" in window) {
        // Una frase corta al activar — confirma que el navegador sí puede
        // hablar y "desbloquea" el audio (algunos navegadores exigen una
        // interacción del usuario antes de permitir voz).
        const u = new SpeechSynthesisUtterance("Notificaciones de voz activadas.");
        u.lang = "es-CO";
        window.speechSynthesis.speak(u);
      }
      return nuevo;
    });
  };

  return { vozActiva, toggleVoz };
}

const esfuerzoLabels: Record<string, string> = { low: "Piensa poco", medium: "Equilibrado", high: "Piensa mucho" };
const severidadColors: Record<string, string> = {
  info: "bg-blue-50 text-blue-700 border-blue-200",
  atencion: "bg-amber-50 text-amber-700 border-amber-200",
  urgente: "bg-red-50 text-red-700 border-red-200",
};
const severidadLabels: Record<string, string> = { info: "Info", atencion: "Atención", urgente: "Urgente" };

export default function Oficina() {
  const { user } = useAuth();
  // Menú completo restringido a Arlex puntualmente — ni siquiera a
  // "cualquier administrador" (a diferencia de Renta PN), por pedido
  // explícito suyo.
  const isAuthorized = user?.cedula === "5820262";

  const utils = trpc.useUtils();
  const agentesQuery = trpc.oficina.agentes.list.useQuery(undefined, {
    enabled: isAuthorized,
    refetchInterval: 45000,
  });
  const solicitudesQuery = trpc.oficina.solicitudes.listar.useQuery({}, {
    enabled: isAuthorized,
    refetchInterval: 45000,
  });

  const solicitudesPendientes = (solicitudesQuery.data || []).filter((s: any) => s.estado === "pendiente");
  const { vozActiva, toggleVoz } = useVozOficina(isAuthorized ? solicitudesPendientes : undefined);

  const [agenteAbiertoId, setAgenteAbiertoId] = useState<number | null>(null);

  // "Revisar ahora" pone a trabajar a los dos agentes a la vez. Cada uno
  // reporta por su cuenta: si uno falla, el otro igual entrega su resultado.
  const revisarTareasMutation = trpc.oficina.estadista.revisarAhora.useMutation();
  const revisarCorreoMutation = trpc.oficina.correo.revisarAhora.useMutation();
  const revisando = revisarTareasMutation.isPending || revisarCorreoMutation.isPending;

  const handleRevisarAhora = async () => {
    const [tareas, correo] = await Promise.allSettled([
      revisarTareasMutation.mutateAsync(),
      revisarCorreoMutation.mutateAsync(),
    ]);
    utils.oficina.agentes.list.invalidate();
    utils.oficina.solicitudes.listar.invalidate();
    utils.oficina.correo.listar.invalidate();
    utils.oficina.correo.buzones.listar.invalidate();

    const partes: string[] = [];
    if (tareas.status === "fulfilled") {
      partes.push(tareas.value.solicitudesCreadas > 0 ? `Tareas: ${tareas.value.solicitudesCreadas} hallazgo(s) nuevo(s)` : "Tareas: sin novedades");
    } else {
      toast.error(`Tareas: ${tareas.reason?.message || "no se pudo completar la revisión"}`);
    }
    if (correo.status === "fulfilled") {
      partes.push(correo.value.correosNuevos > 0
        ? `Correo: ${correo.value.correosNuevos} nuevo(s), ${correo.value.solicitudesCreadas} para atender`
        : "Correo: sin correos nuevos");
      if (correo.value.buzonesConError > 0) toast.warning("Correo: algún buzón no se pudo leer — abre el Agente de Correo para ver el detalle");
    } else if (!/no hay buzones/i.test(correo.reason?.message || "")) {
      // Que aún no haya buzones conectados no es un error de la revisión.
      toast.error(`Correo: ${correo.reason?.message || "no se pudo revisar"}`);
    }
    if (partes.length > 0) toast.success(`Revisión completa — ${partes.join(" · ")}`);
  };

  if (!isAuthorized) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <h2 className="text-lg font-medium mb-2">Acceso Restringido</h2>
            <p className="text-muted-foreground">Esta sección no está disponible para tu usuario.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const agentes = agentesQuery.data || [];
  const estadista = agentes.find((a: any) => a.tipo === "estadista_tareas");
  const agenteCorreo = agentes.find((a: any) => a.tipo === "correo" && a.activo);
  const nombreAgente = new Map<number, string>(agentes.map((a: any) => [a.id, a.nombre]));
  const agenteAbierto = agentes.find((a: any) => a.id === agenteAbiertoId) || null;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Oficina</h1>
            <p className="text-muted-foreground text-sm">
              Tus agentes de IA — visible solo para tu usuario. Haz clic en un agente para hablarle o ver su trabajo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm" onClick={toggleVoz}
              className={vozActiva ? "border-[#EDA011] text-[#EDA011]" : ""}
              title="Notificaciones de voz mientras esta pestaña esté abierta"
            >
              {vozActiva ? <Volume2 className="w-4 h-4 mr-1.5" /> : <VolumeX className="w-4 h-4 mr-1.5" />}
              Voz {vozActiva ? "activada" : "desactivada"}
            </Button>
          </div>
        </div>

        {/* ---- Escena de la oficina ---- */}
        <div
          className="relative w-full rounded-lg overflow-hidden border select-none"
          style={{ aspectRatio: "1586 / 992", backgroundImage: "url(/oficina/oficina-fondo.png)", backgroundSize: "cover", backgroundPosition: "center" }}
        >
          {/* Decoración fija */}
          <img src="/oficina/planta-grande.png" alt="" className="absolute pointer-events-none" style={{ left: "1%", bottom: "2%", width: "9%" }} />
          <img src="/oficina/planta-pequena.png" alt="" className="absolute pointer-events-none" style={{ right: "2%", top: "4%", width: "6%" }} />
          <img src="/oficina/archivador.png" alt="" className="absolute pointer-events-none" style={{ right: "1%", bottom: "3%", width: "8%" }} />
          <img src="/oficina/biblioteca.png" alt="" className="absolute pointer-events-none" style={{ left: "40%", top: "1%", width: "9%" }} />

          {/* Escritorio 1 — Estadista de Tareas (activo) */}
          {estadista && (
            <EscritorioAgente
              agente={estadista}
              left="16%"
              onAbrir={() => setAgenteAbiertoId(estadista.id)}
            />
          )}

          {/* Escritorio 2 — Agente de Correo */}
          {agenteCorreo ? (
            <EscritorioAgente
              agente={agenteCorreo}
              left="46%"
              sprite="correo"
              onAbrir={() => setAgenteAbiertoId(agenteCorreo.id)}
            />
          ) : (
            <EscritorioProximamente left="48%" label="Agente de Correo" />
          )}

          {/* Escritorio "próximamente" */}
          <EscritorioProximamente left="72%" label="Monitor de Desarrollo" />
        </div>

        {/* ---- Panel de solicitudes pendientes (todas, cualquier agente) ---- */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Inbox className="w-4 h-4" /> Solicitudes pendientes
              {solicitudesPendientes.length > 0 && (
                <Badge className="bg-red-100 text-red-800 border-red-200">{solicitudesPendientes.length}</Badge>
              )}
            </CardTitle>
            {estadista && (
              <Button
                size="sm" onClick={handleRevisarAhora} disabled={revisando}
                className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
                title="Pone a revisar a todos los agentes: tareas y correo"
              >
                {revisando ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                {revisando ? "Revisando…" : "Revisar ahora"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {solicitudesQuery.isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : solicitudesPendientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nada pendiente por ahora — todo al día.</p>
            ) : (
              <div className="space-y-2">
                {solicitudesPendientes.map((s: any) => (
                  <SolicitudRow
                    key={s.id} solicitud={s} agenteNombre={nombreAgente.get(s.agenteId)}
                    onAbrirAgente={s.tipo === "correo" ? () => setAgenteAbiertoId(s.agenteId) : undefined}
                  />
                ))}
              </div>
            )}
            {(estadista?.ultimaRevisionAt || agenteCorreo?.ultimaRevisionAt) && (
              <p className="text-xs text-muted-foreground mt-3">
                Última revisión —{" "}
                {[
                  estadista?.ultimaRevisionAt ? `tareas: ${new Date(estadista.ultimaRevisionAt).toLocaleString("es-CO")}` : null,
                  agenteCorreo?.ultimaRevisionAt ? `correo: ${new Date(agenteCorreo.ultimaRevisionAt).toLocaleString("es-CO")}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {agenteAbierto && (
        <AgenteDialog agente={agenteAbierto} onClose={() => setAgenteAbiertoId(null)} />
      )}
    </DashboardLayout>
  );
}

function EscritorioAgente({ agente, left, onAbrir, sprite: personaje = "administrativo" }: {
  agente: any; left: string; onAbrir: () => void;
  /** Prefijo de las imágenes del personaje en /oficina (…-normal.png y
   * …-mano-levantada.png). */
  sprite?: "administrativo" | "correo";
}) {
  const tieneAtencion = agente.solicitudesPendientes > 0;
  const sprite = `${personaje}-${tieneAtencion ? "mano-levantada" : "normal"}.png`;
  return (
    <button
      onClick={onAbrir}
      title={`Abrir a ${agente.nombre}`}
      className="absolute bottom-0 flex flex-col items-center group"
      style={{ left, width: "20%" }}
    >
      <img
        src={`/oficina/${sprite}`} alt={agente.nombre}
        className="w-full drop-shadow-md transition-transform group-hover:-translate-y-1"
        style={{ imageRendering: "pixelated" }}
      />
      <img src="/oficina/escritorio.png" alt="" className="w-[115%] -mt-[38%] pointer-events-none" />
      <div className="mt-1 flex flex-col items-center gap-1">
        <span className="text-xs font-medium bg-white/90 px-2 py-0.5 rounded-full border shadow-sm">{agente.nombre}</span>
        {/* Fila de alto fijo: el personaje no sube ni baja según tenga
            pendientes o error, y todos los agentes quedan alineados. */}
        <div className="flex h-[18px] items-center gap-1">
          {tieneAtencion && (
            <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] px-1.5 py-0">
              {agente.solicitudesPendientes} pendiente{agente.solicitudesPendientes > 1 ? "s" : ""}
            </Badge>
          )}
          {agente.estado === "error" && (
            <Badge className="bg-red-600 text-white border-red-700 text-[10px] px-1.5 py-0">Error</Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function EscritorioProximamente({ left, label }: { left: string; label: string }) {
  return (
    <div className="absolute bottom-0 flex flex-col items-center opacity-40" style={{ left, width: "20%" }}>
      <div style={{ height: "34%" }} />
      <img src="/oficina/escritorio.png" alt="" className="w-[115%] pointer-events-none grayscale" />
      <span className="mt-1 text-xs font-medium bg-white/80 px-2 py-0.5 rounded-full border">{label} — próximamente</span>
    </div>
  );
}

function SolicitudRow({ solicitud, agenteNombre, onAbrirAgente }: {
  solicitud: any; agenteNombre?: string;
  /** Si viene, la solicitud se puede abrir en el diálogo de su agente
   * (las de correo: para redactar el borrador o crear la tarea). */
  onAbrirAgente?: () => void;
}) {
  const utils = trpc.useUtils();
  const resolverMutation = trpc.oficina.solicitudes.resolver.useMutation({
    onSuccess: () => {
      utils.oficina.solicitudes.listar.invalidate();
      utils.oficina.agentes.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo actualizar la solicitud"),
  });

  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={`${severidadColors[solicitud.severidad]} text-[10px] px-1.5 py-0`}>
            {severidadLabels[solicitud.severidad]}
          </Badge>
          <p className="font-medium break-words min-w-0">{solicitud.titulo}</p>
        </div>
        {solicitud.detalle && <p className="text-xs text-muted-foreground mt-0.5 break-words">{solicitud.detalle}</p>}
        {agenteNombre && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{agenteNombre}</p>}
      </div>
      <div className="flex gap-1 shrink-0">
        {onAbrirAgente && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onAbrirAgente} title="Abrir en el Agente de Correo para redactar el borrador o crear la tarea">
            <ArrowUpRight className="w-3.5 h-3.5 mr-1" /> Abrir
          </Button>
        )}
        <Button
          size="sm" variant="outline" className="h-7 px-2"
          onClick={() => resolverMutation.mutate({ id: solicitud.id, accion: "atender" })}
          disabled={resolverMutation.isPending}
          title="Marcar como atendida"
        >
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm" variant="outline" className="h-7 px-2 text-muted-foreground"
          onClick={() => resolverMutation.mutate({ id: solicitud.id, accion: "descartar" })}
          disabled={resolverMutation.isPending}
          title="Descartar"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AgenteDialog({ agente, onClose }: { agente: any; onClose: () => void }) {
  const esCorreo = agente.tipo === "correo";
  // El Agente de Correo abre en su Bandeja (ahí están sus pendientes, cada
  // uno con borrador y tarea) en lugar de la lista genérica de solicitudes.
  const [pestana, setPestana] = useState(esCorreo ? "bandeja" : "chat");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`${esCorreo ? "sm:max-w-3xl" : "sm:max-w-2xl"} max-h-[88vh] min-w-0 overflow-y-auto overflow-x-hidden`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#EDA011]" /> {agente.nombre}
            {agente.estado === "error" && <Badge className="bg-red-600 text-white border-red-700 text-[10px] px-1.5 py-0">Error</Badge>}
          </DialogTitle>
        </DialogHeader>
        {agente.estado === "error" && agente.ultimoErrorMensaje && (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-800 leading-relaxed">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>Su última revisión falló: {agente.ultimoErrorMensaje}</span>
          </p>
        )}
        <Tabs value={pestana} onValueChange={setPestana} className="min-w-0">
          {/* En pantallas angostas las pestañas se desplazan de lado en vez de ensanchar el diálogo. */}
          <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
            {esCorreo && (
              <TabsTrigger value="bandeja" className="gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Bandeja
                {agente.solicitudesPendientes > 0 && <Badge className="bg-red-100 text-red-800 border-red-200 ml-1 text-[10px] px-1.5 py-0">{agente.solicitudesPendientes}</Badge>}
              </TabsTrigger>
            )}
            <TabsTrigger value="chat" className="gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Chat</TabsTrigger>
            {!esCorreo && (
              <TabsTrigger value="solicitudes" className="gap-1.5">
                <Inbox className="w-3.5 h-3.5" /> Solicitudes
                {agente.solicitudesPendientes > 0 && <Badge className="bg-red-100 text-red-800 border-red-200 ml-1 text-[10px] px-1.5 py-0">{agente.solicitudesPendientes}</Badge>}
              </TabsTrigger>
            )}
            {esCorreo && <TabsTrigger value="buzones" className="gap-1.5"><AtSign className="w-3.5 h-3.5" /> Buzones</TabsTrigger>}
            <TabsTrigger value="config" className="gap-1.5"><Settings className="w-3.5 h-3.5" /> Configuración</TabsTrigger>
          </TabsList>
          {esCorreo && (
            <TabsContent value="bandeja" className="mt-4 min-w-0">
              <BandejaCorreoTab onIrABuzones={() => setPestana("buzones")} />
            </TabsContent>
          )}
          <TabsContent value="chat" className="mt-4">
            <ChatTab agenteId={agente.id} />
          </TabsContent>
          {!esCorreo && (
            <TabsContent value="solicitudes" className="mt-4">
              <SolicitudesTab agenteId={agente.id} />
            </TabsContent>
          )}
          {esCorreo && (
            <TabsContent value="buzones" className="mt-4 min-w-0">
              <BuzonesCorreoTab />
            </TabsContent>
          )}
          <TabsContent value="config" className="mt-4">
            <ConfiguracionTab agente={agente} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ChatTab({ agenteId }: { agenteId: number }) {
  const utils = trpc.useUtils();
  const [texto, setTexto] = useState("");
  const mensajesQuery = trpc.oficina.chat.listar.useQuery({ agenteId });
  const enviarMutation = trpc.oficina.chat.enviar.useMutation({
    onSuccess: () => { setTexto(""); utils.oficina.chat.listar.invalidate({ agenteId }); },
    onError: (err) => toast.error(err.message || "No se pudo enviar el mensaje"),
  });

  const handleEnviar = () => {
    if (!texto.trim()) return;
    enviarMutation.mutate({ agenteId, mensaje: texto.trim() });
  };

  return (
    <div className="space-y-3">
      <ScrollArea className="h-72 rounded-md border p-3">
        {mensajesQuery.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !mensajesQuery.data || mensajesQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Todavía no has hablado con este agente — escríbele algo.</p>
        ) : (
          <div className="space-y-3">
            {mensajesQuery.data.map((m: any) => (
              <div key={m.id} className={`flex ${m.rol === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.rol === "user" ? "bg-[#EDA011] text-white" : "bg-muted"}`}>
                  {m.contenido}
                </div>
              </div>
            ))}
            {enviarMutation.isPending && (
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 text-sm bg-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /></div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
      <div className="flex gap-2">
        <Textarea
          value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
          placeholder="Escríbele al agente..." className="text-sm"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
        />
        <Button onClick={handleEnviar} disabled={enviarMutation.isPending || !texto.trim()} className="self-end">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function SolicitudesTab({ agenteId }: { agenteId: number }) {
  const query = trpc.oficina.solicitudes.listar.useQuery({ agenteId });
  const filas = query.data || [];
  if (query.isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (filas.length === 0) return <p className="text-sm text-muted-foreground">Este agente no ha generado solicitudes todavía.</p>;
  return (
    <div className="space-y-2 max-h-72 overflow-y-auto">
      {filas.map((s: any) => (
        <div key={s.id} className="border-b pb-2 last:border-b-0 text-sm">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={`${severidadColors[s.severidad]} text-[10px] px-1.5 py-0`}>{severidadLabels[s.severidad]}</Badge>
            <p className="font-medium">{s.titulo}</p>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{s.estado}</Badge>
          </div>
          {s.detalle && <p className="text-xs text-muted-foreground mt-0.5">{s.detalle}</p>}
        </div>
      ))}
    </div>
  );
}

function ConfiguracionTab({ agente }: { agente: any }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    nombre: agente.nombre || "",
    personalidad: agente.personalidad || "",
    objetivo: agente.objetivo || "",
    especialidad: agente.especialidad || "",
    criterioTerminado: agente.criterioTerminado || "",
    esfuerzo: agente.esfuerzo || "medium",
  });

  const actualizarMutation = trpc.oficina.agentes.actualizar.useMutation({
    onSuccess: () => { toast.success("Perfil actualizado"); utils.oficina.agentes.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo guardar"),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Nombre</Label>
        <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} className="h-9 text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Personalidad y voz</Label>
        <Textarea value={form.personalidad} onChange={(e) => setForm(f => ({ ...f, personalidad: e.target.value }))} rows={2} className="text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Objetivo</Label>
        <Textarea value={form.objetivo} onChange={(e) => setForm(f => ({ ...f, objetivo: e.target.value }))} rows={2} className="text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{agente.tipo === "correo" ? "Criterios para priorizar el correo" : "Especialidad"}</Label>
        <Textarea value={form.especialidad} onChange={(e) => setForm(f => ({ ...f, especialidad: e.target.value }))} rows={agente.tipo === "correo" ? 3 : 2} className="text-sm" />
        {agente.tipo === "correo" && (
          <p className="text-[11px] text-muted-foreground">El agente aplica estos criterios al clasificar cada correo: qué es urgente, qué requiere atención y qué se puede ignorar.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Cuándo considera un encargo terminado</Label>
        <Textarea value={form.criterioTerminado} onChange={(e) => setForm(f => ({ ...f, criterioTerminado: e.target.value }))} rows={2} className="text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Esfuerzo de razonamiento</Label>
        <Select value={form.esfuerzo} onValueChange={(v) => setForm(f => ({ ...f, esfuerzo: v }))}>
          <SelectTrigger className="h-9 text-sm w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(esfuerzoLabels).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button
        onClick={() => actualizarMutation.mutate({ id: agente.id, ...form })}
        disabled={actualizarMutation.isPending}
        className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
      >
        {actualizarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Guardar
      </Button>
    </div>
  );
}
