import { useState } from "react";
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
  MessageSquare, Inbox, Settings, Sparkles, Mail, AtSign, ArrowUpRight, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { BandejaCorreoTab, BuzonesCorreoTab } from "@/components/oficina/CorreoAgente";
import InformeEquipo, { BotonEscucharInforme } from "@/components/oficina/InformeEquipo";
import MensajesSinLeer from "@/components/oficina/MensajesSinLeer";
import { hablar, setVozActivada, useVozActivada } from "@/lib/vozOficina";

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
  // Los avisos de voz los dice OficinaVozGlobal (montado en todas las
  // páginas); aquí solo está el interruptor.
  const vozActiva = useVozActivada();
  const toggleVoz = () => {
    const nueva = !vozActiva;
    setVozActivada(nueva);
    // Una frase corta al activar: confirma que el navegador sí puede hablar
    // y "desbloquea" el audio (exige un clic antes de permitir voz).
    if (nueva) hablar(["Avisos de voz activados."], { interrumpir: true });
  };

  const [agenteAbiertoId, setAgenteAbiertoId] = useState<number | null>(null);
  // Al abrir el Agente de Correo desde el aviso de publicidad, su bandeja
  // se abre directamente en esa vista.
  const [correoEnPublicidad, setCorreoEnPublicidad] = useState(false);

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
            <BotonEscucharInforme compacto />
            <Button
              variant="outline" size="sm" onClick={toggleVoz}
              className={vozActiva ? "border-[#EDA011] text-[#EDA011]" : ""}
              title="Avisos de voz: el agente dice en voz alta cuando alguien entrega una tarea, comenta o lee una observación, en cualquier página del portal"
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
          {/* La planta y el archivador van al fondo, contra la pared: adelante
              el espacio es de los escritorios. */}
          <img src="/oficina/planta-grande.png" alt="" className="absolute pointer-events-none" style={{ left: "9.5%", bottom: "61%", width: "6.5%" }} />
          <img src="/oficina/planta-pequena.png" alt="" className="absolute pointer-events-none" style={{ right: "2%", top: "4%", width: "6%" }} />
          <img src="/oficina/archivador.png" alt="" className="absolute pointer-events-none" style={{ right: "10%", bottom: "61%", width: "6%" }} />
          <img src="/oficina/biblioteca.png" alt="" className="absolute pointer-events-none" style={{ left: "40%", top: "1%", width: "9%" }} />

          {/* Escritorio 1 — Estadista de Tareas (activo) */}
          {estadista && (
            <EscritorioAgente
              agente={estadista}
              left={PUESTOS[0]}
              personaje="estadista"
              onAbrir={() => setAgenteAbiertoId(estadista.id)}
            />
          )}

          {/* Escritorio 2 — Agente de Correo */}
          {agenteCorreo ? (
            <EscritorioAgente
              agente={agenteCorreo}
              left={PUESTOS[1]}
              personaje="correo"
              onAbrir={() => setAgenteAbiertoId(agenteCorreo.id)}
            />
          ) : (
            <EscritorioProximamente left={PUESTOS[1]} label="Agente de Correo" personaje="correo" />
          )}

          {/* Escritorio "próximamente" */}
          <EscritorioProximamente left={PUESTOS[2]} label="Monitor de Desarrollo" personaje="desarrollo" />
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
                    onAbrirAgente={s.tipo === "correo" || s.tipo === "correo_publicidad"
                      ? () => { setCorreoEnPublicidad(s.tipo === "correo_publicidad"); setAgenteAbiertoId(s.agenteId); }
                      : undefined}
                    tituloAbrir={s.tipo === "correo_publicidad" ? "Abrir la publicidad en el Agente de Correo para autorizar qué se elimina" : undefined}
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

        {/* ---- Seguimiento: lo que escribí y el equipo no ha leído ---- */}
        <MensajesSinLeer />
      </div>

      {agenteAbierto && (
        <AgenteDialog
          agente={agenteAbierto} vistaCorreoInicial={correoEnPublicidad ? "publicidad" : "atencion"}
          onClose={() => { setAgenteAbiertoId(null); setCorreoEnPublicidad(false); }}
        />
      )}
    </DashboardLayout>
  );
}

/** Personaje de cada agente: prefijo de sus dos imágenes en /oficina
 * (…-normal.png y …-mano-levantada.png, mismo encuadre en ambas para que
 * no "salte" al cambiar de pose). */
type Personaje = "estadista" | "correo" | "desarrollo";

/** Tamaño y lugar de los tres puestos en la escena, en porcentaje de su
 * ancho. Con 29 % cada escritorio se ve de un cuarto del ancho de la
 * oficina: los tres ocupan el frente, con un pasillo entre uno y otro, y
 * las personas llegan hasta la línea donde empieza la pared. */
const ANCHO_PUESTO = "29%";
const PUESTOS = ["3%", "35.5%", "68%"] as const;

/** Un puesto de trabajo: el personaje DETRÁS del escritorio. El escritorio
 * se dibuja encima y le tapa las piernas; el personaje queda de pie al
 * lado del monitor (no detrás de él) para que se le vean el cuerpo y la
 * mano levantada. Todas las medidas son porcentajes del ancho/alto del
 * escritorio, así la composición se conserva a cualquier tamaño. */
function PuestoDeTrabajo({ personaje, pose, alt, apagado = false }: {
  personaje: Personaje; pose: "normal" | "mano-levantada"; alt: string;
  /** Puesto "próximamente": en gris y atenuado. */
  apagado?: boolean;
}) {
  return (
    <div className={`relative w-[115%] ${apagado ? "grayscale opacity-45" : ""}`}>
      <img
        src={`/oficina/${personaje}-${pose}.png`} alt={alt}
        className="absolute max-w-none drop-shadow-md transition-transform group-hover:-translate-y-1"
        style={{
          width: "92%", left: "-17%", bottom: "7.5%",
          // Lo que queda por debajo del tablero del escritorio no se dibuja
          // (si no, los pies asomarían por el hueco entre las patas).
          clipPath: "inset(-10% -10% 28% -10%)",
        }}
      />
      <img src="/oficina/escritorio.png" alt="" className="relative block w-full pointer-events-none" />
    </div>
  );
}

function EscritorioAgente({ agente, left, onAbrir, personaje }: {
  agente: any; left: string; onAbrir: () => void; personaje: Personaje;
}) {
  const tieneAtencion = agente.solicitudesPendientes > 0;
  return (
    <button
      onClick={onAbrir}
      title={`Abrir a ${agente.nombre}`}
      className="absolute bottom-0 flex flex-col items-center group"
      style={{ left, width: ANCHO_PUESTO }}
    >
      <PuestoDeTrabajo personaje={personaje} pose={tieneAtencion ? "mano-levantada" : "normal"} alt={agente.nombre} />
      <div className="mt-1 flex w-full flex-col items-center gap-1">
        <span className="text-[9px] sm:text-sm font-medium max-w-[110%] truncate bg-white/90 px-1.5 sm:px-2.5 py-0.5 rounded-full border shadow-sm">{agente.nombre}</span>
        {/* Fila de alto fijo: el personaje no sube ni baja según tenga
            pendientes o error, y todos los agentes quedan alineados. */}
        <div className="flex h-[18px] items-center gap-1">
          {tieneAtencion && (
            <Badge className="bg-red-100 text-red-800 border-red-200 text-[8px] sm:text-[10px] px-1.5 py-0 whitespace-nowrap">
              {agente.solicitudesPendientes} pendiente{agente.solicitudesPendientes > 1 ? "s" : ""}
            </Badge>
          )}
          {agente.estado === "error" && (
            <Badge className="bg-red-600 text-white border-red-700 text-[8px] sm:text-[10px] px-1.5 py-0">Error</Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function EscritorioProximamente({ left, label, personaje }: { left: string; label: string; personaje: Personaje }) {
  return (
    <div className="absolute bottom-0 flex flex-col items-center" style={{ left, width: ANCHO_PUESTO }}>
      <PuestoDeTrabajo personaje={personaje} pose="normal" alt="" apagado />
      {/* Mismo alto que la etiqueta + fila de avisos de un agente activo, para que los tres escritorios queden alineados. */}
      <div className="mt-1 flex w-full flex-col items-center gap-1 opacity-60">
        <span className="text-[9px] sm:text-sm font-medium max-w-[110%] truncate bg-white/80 px-1.5 sm:px-2.5 py-0.5 rounded-full border">{label}</span>
        <span className="flex h-[18px] items-center text-[8px] sm:text-[10px] font-medium text-muted-foreground bg-white/70 px-1.5 rounded-full border">próximamente</span>
      </div>
    </div>
  );
}

function SolicitudRow({ solicitud, agenteNombre, onAbrirAgente, tituloAbrir }: {
  solicitud: any; agenteNombre?: string;
  /** Si viene, la solicitud se puede abrir en el diálogo de su agente
   * (las de correo: para redactar el borrador o crear la tarea). */
  onAbrirAgente?: () => void;
  tituloAbrir?: string;
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
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onAbrirAgente} title={tituloAbrir || "Abrir en el Agente de Correo para redactar el borrador o crear la tarea"}>
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

function AgenteDialog({ agente, onClose, vistaCorreoInicial = "atencion" }: { agente: any; onClose: () => void; vistaCorreoInicial?: "atencion" | "publicidad" }) {
  const esCorreo = agente.tipo === "correo";
  // El Agente de Correo abre en su Bandeja (ahí están sus pendientes, cada
  // uno con borrador y tarea) en lugar de la lista genérica de solicitudes.
  const esEstadista = agente.tipo === "estadista_tareas";
  const [pestana, setPestana] = useState(esCorreo ? "bandeja" : esEstadista ? "informe" : "chat");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`${esCorreo || esEstadista ? "sm:max-w-3xl" : "sm:max-w-2xl"} max-h-[88vh] min-w-0 overflow-y-auto overflow-x-hidden`}>
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
            {esEstadista && <TabsTrigger value="informe" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Informe</TabsTrigger>}
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
              <BandejaCorreoTab onIrABuzones={() => setPestana("buzones")} vistaInicial={vistaCorreoInicial} />
            </TabsContent>
          )}
          {esEstadista && (
            <TabsContent value="informe" className="mt-4 min-w-0">
              <InformeEquipo />
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
