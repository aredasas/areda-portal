import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Loader2, RefreshCw, Check, X, PenLine, ListPlus, RotateCcw, Copy, ExternalLink, Plus,
  Trash2, PlugZap, AlertTriangle, Mail, CircleCheck, ShieldCheck, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

/** Pantallas propias del Agente de Correo dentro de su diálogo en la
 * Oficina: la Bandeja (lo que el agente leyó y clasificó, con borrador y
 * tarea por correo) y los Buzones (qué cuentas del Workspace revisa y los
 * pasos de conexión). */

const prioridadEstilos: Record<string, string> = {
  urgente: "bg-red-50 text-red-700 border-red-200",
  atencion: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  ninguna: "bg-muted text-muted-foreground border-border",
};
const prioridadEtiquetas: Record<string, string> = { urgente: "Urgente", atencion: "Atención", info: "Informativo", ninguna: "Sin acción" };
const categoriaEtiquetas: Record<string, string> = {
  cliente: "Cliente", entidad: "Entidad", proveedor: "Proveedor", interno: "Interno",
  notificacion: "Notificación", boletin: "Boletín", otro: "Otro",
};

/** Fecha corta de un correo en hora de Colombia: solo la hora si es de
 * hoy, día y mes si es de este año. */
function fechaCorta(valor: string | Date): string {
  const fecha = new Date(valor);
  const zona = { timeZone: "America/Bogota" } as const;
  const dia = (d: Date) => d.toLocaleDateString("en-CA", zona);
  if (dia(fecha) === dia(new Date())) return fecha.toLocaleTimeString("es-CO", { ...zona, hour: "numeric", minute: "2-digit" });
  const mismoAnio = fecha.toLocaleDateString("es-CO", { ...zona, year: "numeric" }) === new Date().toLocaleDateString("es-CO", { ...zona, year: "numeric" });
  return fecha.toLocaleDateString("es-CO", { ...zona, day: "numeric", month: "short", ...(mismoAnio ? {} : { year: "numeric" }) });
}

function fechaLarga(valor: string | Date): string {
  return new Date(valor).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

async function copiar(texto: string, queEs: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${queEs} copiado`);
  } catch {
    toast.error("No se pudo copiar — selecciónalo y cópialo a mano");
  }
}

// ---------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------

export function BandejaCorreoTab({ onIrABuzones }: { onIrABuzones: () => void }) {
  const utils = trpc.useUtils();
  const [vista, setVista] = useState<"atencion" | "todos">("atencion");
  const [buzonId, setBuzonId] = useState<string>("todos");
  const [abierto, setAbierto] = useState<{ id: number; panel: "borrador" | "tarea" } | null>(null);
  const [ultimoResumen, setUltimoResumen] = useState<string | null>(null);

  const buzonesQuery = trpc.oficina.correo.buzones.listar.useQuery();
  const correosQuery = trpc.oficina.correo.listar.useQuery({
    vista, buzonId: buzonId === "todos" ? undefined : Number(buzonId),
  });

  const refrescarTodo = () => {
    utils.oficina.correo.listar.invalidate();
    utils.oficina.correo.buzones.listar.invalidate();
    utils.oficina.solicitudes.listar.invalidate();
    utils.oficina.agentes.list.invalidate();
  };

  const revisarMutation = trpc.oficina.correo.revisarAhora.useMutation({
    onSuccess: (data) => {
      setUltimoResumen(data.resumen);
      if (data.buzonesConError > 0) toast.warning("Revisión terminada, pero algún buzón no se pudo leer");
      else toast.success(data.correosNuevos > 0 ? `Revisión completa — ${data.correosNuevos} correo(s) nuevo(s)` : "Revisión completa — sin correos nuevos");
      refrescarTodo();
    },
    onError: (err) => { toast.error(err.message || "No se pudo revisar el correo"); refrescarTodo(); },
  });

  const buzones = buzonesQuery.data || [];
  const totalAtencion = buzones.reduce((s: number, b: any) => s + b.requierenAtencion, 0);
  const correos = correosQuery.data || [];

  if (buzonesQuery.isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (buzones.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-10 px-6 text-center">
        <Mail className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-sm font-medium">Todavía no hay buzones conectados</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Conecta el primer buzón de tu Google Workspace y el agente empezará a leer la bandeja de entrada, resumirla y avisarte de lo importante.
        </p>
        <Button size="sm" className="mt-4 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={onIrABuzones}>
          <PlugZap className="w-4 h-4 mr-1.5" /> Conectar un buzón
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
          {([["atencion", "Requieren atención"], ["todos", "Todos"]] as const).map(([valor, etiqueta]) => (
            <button
              key={valor} type="button" onClick={() => setVista(valor)}
              className={`px-2.5 py-1 text-xs rounded-[5px] transition-colors ${vista === valor ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {etiqueta}
              {valor === "atencion" && totalAtencion > 0 && (
                <span className="ml-1.5 inline-flex min-w-4 justify-center rounded-full bg-red-100 px-1 text-[10px] font-medium text-red-800 tabular-nums">{totalAtencion}</span>
              )}
            </button>
          ))}
        </div>
        {buzones.length > 1 && (
          <Select value={buzonId} onValueChange={setBuzonId}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los buzones</SelectItem>
              {buzones.map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm" onClick={() => revisarMutation.mutate()} disabled={revisarMutation.isPending}
          className="ml-auto h-8 bg-[#EDA011] hover:bg-[#d48f0f] text-white"
        >
          {revisarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
          {revisarMutation.isPending ? "Leyendo correo…" : "Revisar correos"}
        </Button>
      </div>

      {ultimoResumen && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{ultimoResumen}</p>
      )}

      {correosQuery.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : correos.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 px-6 text-center">
          <CircleCheck className="w-7 h-7 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {vista === "atencion"
              ? "Nada pendiente — ningún correo requiere tu atención."
              : "Aún no hay correos leídos. Pulsa «Revisar correos» para que el agente lea la bandeja."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border divide-y overflow-hidden">
          {correos.map((c: any) => (
            <CorreoRow
              key={c.id} correo={c} mostrarBuzon={buzones.length > 1}
              panel={abierto && abierto.id === c.id ? abierto.panel : null}
              onPanel={(panel) => setAbierto(panel ? { id: c.id, panel } : null)}
              onCambio={refrescarTodo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CorreoRow({ correo, mostrarBuzon, panel, onPanel, onCambio }: {
  correo: any; mostrarBuzon: boolean; panel: "borrador" | "tarea" | null;
  onPanel: (panel: "borrador" | "tarea" | null) => void; onCambio: () => void;
}) {
  const marcarMutation = trpc.oficina.correo.marcar.useMutation({
    onSuccess: onCambio,
    onError: (err) => toast.error(err.message || "No se pudo actualizar el correo"),
  });
  const cerrado = correo.estado !== "pendiente";
  const requiereAtencion = correo.prioridad === "urgente" || correo.prioridad === "atencion";
  const alternar = (cual: "borrador" | "tarea") => onPanel(panel === cual ? null : cual);

  return (
    <div className={`px-3 py-2.5 text-sm ${cerrado ? "bg-muted/20" : ""}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Badge variant="outline" className={`${prioridadEstilos[correo.prioridad]} text-[10px] px-1.5 py-0 shrink-0`}>
          {prioridadEtiquetas[correo.prioridad] || correo.prioridad}
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground">
          {categoriaEtiquetas[correo.categoria] || correo.categoria}
        </Badge>
        <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={correo.remitenteEmail}>
          {correo.remitenteNombre || correo.remitenteEmail}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={fechaLarga(correo.fechaCorreo)}>{fechaCorta(correo.fechaCorreo)}</span>
      </div>

      <p className={`mt-1 font-medium leading-snug break-words ${cerrado ? "text-muted-foreground" : ""}`}>{correo.asunto || "(sin asunto)"}</p>
      {(correo.resumen || correo.snippet) && (
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed break-words">{correo.resumen || correo.snippet}</p>
      )}
      {correo.accionSugerida && !cerrado && (
        <p className="mt-1 text-xs leading-relaxed break-words"><span className="font-medium">Sugerencia:</span> {correo.accionSugerida}</p>
      )}

      <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground flex-1 min-w-0">
          {mostrarBuzon && <span>Buzón: {correo.buzonNombre}</span>}
          {correo.clienteNombre && <span className="truncate max-w-56" title={correo.clienteNombre}>Cliente: {correo.clienteNombre}</span>}
          {correo.borradorAt && <span className="inline-flex items-center gap-0.5 text-emerald-700"><PenLine className="w-3 h-3" /> Borrador en Gmail</span>}
          {correo.taskId && <span className="inline-flex items-center gap-0.5 text-emerald-700"><ListPlus className="w-3 h-3" /> Tarea creada</span>}
          {cerrado && <span className="font-medium">{correo.estado === "gestionado" ? "Gestionado" : "Descartado"}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
          <Button size="sm" variant={panel === "borrador" ? "secondary" : "outline"} className="h-7 px-2 text-xs" onClick={() => alternar("borrador")}>
            <PenLine className="w-3.5 h-3.5 mr-1" /> Borrador
          </Button>
          <Button size="sm" variant={panel === "tarea" ? "secondary" : "outline"} className="h-7 px-2 text-xs" onClick={() => alternar("tarea")} disabled={!!correo.taskId} title={correo.taskId ? "Este correo ya tiene una tarea" : undefined}>
            <ListPlus className="w-3.5 h-3.5 mr-1" /> Tarea
          </Button>
          {cerrado ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => marcarMutation.mutate({ id: correo.id, estado: "pendiente" })} disabled={marcarMutation.isPending} title="Volver a dejarlo pendiente">
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reabrir
            </Button>
          ) : requiereAtencion ? (
            <>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => marcarMutation.mutate({ id: correo.id, estado: "gestionado" })} disabled={marcarMutation.isPending} title="Marcar como gestionado" aria-label="Marcar como gestionado">
                <Check className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-muted-foreground" onClick={() => marcarMutation.mutate({ id: correo.id, estado: "descartado" })} disabled={marcarMutation.isPending} title="Descartar: no requería atención" aria-label="Descartar">
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {panel === "borrador" && <BorradorPanel correo={correo} onCambio={onCambio} />}
      {panel === "tarea" && <TareaPanel correo={correo} onCreada={() => { onPanel(null); onCambio(); }} />}
    </div>
  );
}

/** Al abrir un panel dentro de un correo (borrador o tarea) lo trae a la
 * vista — en una bandeja larga podría quedar por debajo del borde. */
function useTraerALaVista<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  return ref;
}

/** Resalta los huecos que el agente dejó marcados como [COMPLETAR: …]
 * para que no pasen desapercibidos al revisar el borrador. */
function TextoBorrador({ texto }: { texto: string }) {
  const partes = texto.split(/(\[COMPLETAR:[^\]]*\])/g);
  return (
    <div className="rounded-md border bg-background px-3 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed">
      {partes.map((parte, i) => parte.startsWith("[COMPLETAR:")
        ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-900">{parte}</mark>
        : <Fragment key={i}>{parte}</Fragment>)}
    </div>
  );
}

function BorradorPanel({ correo, onCambio }: { correo: any; onCambio: () => void }) {
  const [instrucciones, setInstrucciones] = useState("");
  const [resultado, setResultado] = useState<{ texto: string; advertencia: string | null } | null>(null);
  const redactarMutation = trpc.oficina.correo.redactarBorrador.useMutation({
    onSuccess: (data) => {
      setResultado({ texto: data.texto, advertencia: data.advertencia });
      toast.success(`Borrador guardado en el Gmail de ${data.buzonNombre}`);
      onCambio();
    },
    onError: (err) => toast.error(err.message || "No se pudo redactar el borrador"),
  });
  const texto = resultado?.texto ?? correo.borradorTexto ?? null;
  const faltantes = texto ? (texto.match(/\[COMPLETAR:/g) || []).length : 0;
  const ref = useTraerALaVista<HTMLDivElement>();

  return (
    <div ref={ref} className="mt-2.5 rounded-md border bg-muted/30 p-3 space-y-2.5">
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor={`indicaciones-${correo.id}`}>Indicaciones para la respuesta <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <Textarea
          id={`indicaciones-${correo.id}`} value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} rows={2}
          placeholder="Ej. Dile que el certificado sale el viernes y que necesitamos el extracto de septiembre."
          className="text-sm bg-background"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={() => redactarMutation.mutate({ id: correo.id, instrucciones: instrucciones.trim() || undefined })} disabled={redactarMutation.isPending}>
          {redactarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <PenLine className="w-4 h-4 mr-1.5" />}
          {redactarMutation.isPending ? "Redactando…" : texto ? "Volver a redactar" : "Redactar borrador"}
        </Button>
        {texto && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => copiar(texto, "Borrador")}>
            <Copy className="w-3.5 h-3.5 mr-1.5" /> Copiar texto
          </Button>
        )}
      </div>

      {texto && (
        <>
          <TextoBorrador texto={texto} />
          {faltantes > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{faltantes === 1 ? "Hay 1 dato por completar" : `Hay ${faltantes} datos por completar`} antes de enviar (resaltado en el texto).</span>
            </p>
          )}
          {resultado?.advertencia && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{resultado.advertencia}</span>
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Quedó en <span className="font-medium text-foreground">Borradores</span> del Gmail de {correo.buzonNombre} ({correo.buzonEmail}), dentro de la misma conversación
              {correo.borradorAt && !resultado ? ` (redactado el ${fechaLarga(correo.borradorAt)})` : ""}. No se ha enviado: se revisa y se envía desde Gmail.
            </span>
          </p>
        </>
      )}
    </div>
  );
}

const prioridadTareaPorCorreo: Record<string, "media" | "alta" | "urgente"> = { urgente: "urgente", atencion: "alta", info: "media", ninguna: "media" };

function TareaPanel({ correo, onCreada }: { correo: any; onCreada: () => void }) {
  const clientesQuery = trpc.clients.list.useQuery({ incluirInactivos: false });
  const colaboradoresQuery = trpc.collaborators.getActive.useQuery();

  const [form, setForm] = useState(() => ({
    title: (correo.asunto || "").replace(/^\s*((re|rv|fw|fwd)\s*:\s*)+/i, "").trim() || "Atender correo",
    clientId: correo.clientId ? String(correo.clientId) : "",
    assignedToId: "",
    dueDate: "",
    priority: prioridadTareaPorCorreo[correo.prioridad] || "media",
    description: [
      `Correo de ${correo.remitenteNombre ? `${correo.remitenteNombre} <${correo.remitenteEmail}>` : correo.remitenteEmail}, recibido el ${fechaLarga(correo.fechaCorreo)} en el buzón ${correo.buzonNombre}.`,
      correo.resumen ? `\n${correo.resumen}` : "",
      correo.accionSugerida ? `\nSugerencia del agente: ${correo.accionSugerida}` : "",
    ].filter(Boolean).join("\n"),
  }));

  const crearMutation = trpc.oficina.correo.crearTarea.useMutation({
    onSuccess: () => { toast.success("Tarea creada"); onCreada(); },
    onError: (err) => toast.error(err.message || "No se pudo crear la tarea"),
  });

  const ref = useTraerALaVista<HTMLDivElement>();

  const handleCrear = () => {
    if (!form.title.trim()) { toast.error("Escribe el título de la tarea"); return; }
    if (!form.clientId) { toast.error("Elige el cliente de la tarea"); return; }
    crearMutation.mutate({
      correoId: correo.id, title: form.title.trim(), description: form.description.trim() || undefined,
      clientId: Number(form.clientId),
      assignedToId: form.assignedToId ? Number(form.assignedToId) : undefined,
      dueDate: form.dueDate || undefined, priority: form.priority as any,
    });
  };

  return (
    <div ref={ref} className="mt-2.5 rounded-md border bg-muted/30 p-3 space-y-2.5">
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor={`tarea-titulo-${correo.id}`}>Título de la tarea</Label>
        <Input id={`tarea-titulo-${correo.id}`} value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} maxLength={255} className="h-9 text-sm bg-background" />
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        <div className="space-y-1.5 min-w-0">
          <Label className="text-xs">Cliente{correo.clientId ? <span className="font-normal text-muted-foreground"> (reconocido por el remitente)</span> : null}</Label>
          <Select value={form.clientId} onValueChange={(v) => setForm(f => ({ ...f, clientId: v }))}>
            <SelectTrigger className="h-9 text-sm bg-background w-full"><SelectValue placeholder="Elegir cliente..." /></SelectTrigger>
            <SelectContent>
              {(clientesQuery.data || []).map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.razonSocial}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-xs">Responsable</Label>
          <Select value={form.assignedToId} onValueChange={(v) => setForm(f => ({ ...f, assignedToId: v }))}>
            <SelectTrigger className="h-9 text-sm bg-background w-full"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
            <SelectContent>
              {(colaboradoresQuery.data || []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor={`tarea-fecha-${correo.id}`}>Fecha límite <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input id={`tarea-fecha-${correo.id}`} type="date" value={form.dueDate} onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))} className="h-9 text-sm bg-background" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Prioridad</Label>
          <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v as any }))}>
            <SelectTrigger className="h-9 text-sm bg-background w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="baja">Baja</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor={`tarea-desc-${correo.id}`}>Descripción</Label>
        <Textarea id={`tarea-desc-${correo.id}`} value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={4} className="text-sm bg-background" />
      </div>
      <Button size="sm" className="h-8 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={handleCrear} disabled={crearMutation.isPending}>
        {crearMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <ListPlus className="w-4 h-4 mr-1.5" />}
        Crear tarea
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Buzones y conexión
// ---------------------------------------------------------------------

export function BuzonesCorreoTab() {
  const utils = trpc.useUtils();
  const conexionQuery = trpc.oficina.correo.conexion.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const buzonesQuery = trpc.oficina.correo.buzones.listar.useQuery();
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");

  const refrescar = () => {
    utils.oficina.correo.buzones.listar.invalidate();
    utils.oficina.correo.listar.invalidate();
    utils.oficina.solicitudes.listar.invalidate();
    utils.oficina.agentes.list.invalidate();
  };

  const agregarMutation = trpc.oficina.correo.buzones.agregar.useMutation({
    onSuccess: (data) => {
      setEmail(""); setNombre("");
      if (data.conexion.ok) toast.success("Buzón agregado y conectado");
      else toast.warning("Buzón agregado, pero todavía no conecta — revisa el mensaje en la lista");
      refrescar();
    },
    onError: (err) => toast.error(err.message || "No se pudo agregar el buzón"),
  });

  const buzones = buzonesQuery.data || [];
  const conexion = conexionQuery.data;
  const hayErrores = buzones.some((b: any) => b.ultimoError);

  return (
    <div className="space-y-4">
      {conexion && !conexion.configurado ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Falta configurar la cuenta de servicio de Google en Railway (son las mismas variables que usa el Drive: GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY). Sin eso el agente no puede conectarse al correo.</span>
        </div>
      ) : conexion ? (
        <PasosConexion conexion={conexion} abiertoPorDefecto={buzones.length === 0 || hayErrores} />
      ) : null}

      <div className="rounded-md border p-3 space-y-2.5">
        <p className="text-sm font-medium">Agregar un buzón</p>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2.5 items-end">
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs" htmlFor="buzon-email">Correo del Workspace</Label>
            <Input id="buzon-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@aredasas.com" className="h-9 text-sm" autoComplete="off" />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs" htmlFor="buzon-nombre">De quién es</Label>
            <Input id="buzon-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Arlex, Contabilidad" maxLength={120} className="h-9 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && email.trim() && nombre.trim()) agregarMutation.mutate({ email: email.trim(), nombre: nombre.trim() }); }} />
          </div>
          <Button
            className="h-9 bg-[#EDA011] hover:bg-[#d48f0f] text-white"
            onClick={() => agregarMutation.mutate({ email: email.trim(), nombre: nombre.trim() })}
            disabled={agregarMutation.isPending || !email.trim() || !nombre.trim()}
          >
            {agregarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
            Agregar
          </Button>
        </div>
      </div>

      {buzonesQuery.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : buzones.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no has agregado ningún buzón.</p>
      ) : (
        <div className="space-y-2">
          {buzones.map((b: any) => <BuzonCard key={b.id} buzon={b} onCambio={refrescar} />)}
        </div>
      )}
    </div>
  );
}

function PasosConexion({ conexion, abiertoPorDefecto }: { conexion: any; abiertoPorDefecto: boolean }) {
  const [abierto, setAbierto] = useState(abiertoPorDefecto);
  // Si aparece un error de conexión mientras la pestaña está abierta, los
  // pasos se despliegan solos (pero no se vuelven a cerrar por su cuenta).
  useEffect(() => { if (abiertoPorDefecto) setAbierto(true); }, [abiertoPorDefecto]);
  const permisos = (conexion.permisos as string[]).join(",");
  const enlaceApi = `https://console.cloud.google.com/apis/library/gmail.googleapis.com${conexion.proyecto ? `?project=${conexion.proyecto}` : ""}`;

  return (
    <div className="rounded-md border">
      <button type="button" onClick={() => setAbierto(a => !a)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left" aria-expanded={abierto}>
        <span className="flex items-center gap-2 text-sm font-medium"><PlugZap className="w-4 h-4 text-[#EDA011]" /> Conexión con Google Workspace</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {abierto ? "Ocultar pasos" : "Ver pasos (se hacen una sola vez)"}
          <ChevronDown className={`w-4 h-4 transition-transform ${abierto ? "rotate-180" : ""}`} />
        </span>
      </button>
      {abierto && (
        <div className="border-t px-3 py-3 space-y-3 text-xs">
          <p className="text-muted-foreground leading-relaxed">
            El agente entra al correo con la misma cuenta de servicio que ya conecta el Drive. Para que pueda leer los buzones, el administrador del Workspace la autoriza una sola vez:
          </p>
          <ol className="space-y-3">
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EDA011] text-[11px] font-semibold text-white">1</span>
              <div className="space-y-1.5 min-w-0">
                <p className="font-medium text-sm leading-5">Activa la API de Gmail</p>
                <p className="text-muted-foreground">Abre el enlace con la cuenta de Google que administra el proyecto y pulsa <span className="font-medium text-foreground">Habilitar</span>.</p>
                <a href={enlaceApi} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[#b9790a] hover:underline">
                  Abrir en Google Cloud <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EDA011] text-[11px] font-semibold text-white">2</span>
              <div className="space-y-2 min-w-0 flex-1">
                <p className="font-medium text-sm leading-5">Autoriza la cuenta de servicio en tu Workspace</p>
                <p className="text-muted-foreground">
                  En la consola de administrador entra a Seguridad → Acceso y control de datos → Controles de API → <span className="font-medium text-foreground">Delegación en todo el dominio</span>, pulsa <span className="font-medium text-foreground">Agregar nuevo</span> y pega estos dos datos:
                </p>
                <CampoCopiable
                  etiqueta="ID de cliente" valor={conexion.clientId}
                  siFalta={`No se pudo consultar automáticamente. Está en Google Cloud → IAM y administración → Cuentas de servicio → ${conexion.correo || "la cuenta de servicio"} → «ID único».`}
                />
                <CampoCopiable etiqueta="Permisos de OAuth (los dos, separados por coma)" valor={permisos} />
                <a href="https://admin.google.com/ac/owl/domainwidedelegation" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[#b9790a] hover:underline">
                  Abrir la consola de administrador <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EDA011] text-[11px] font-semibold text-white">3</span>
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-sm leading-5">Agrega los buzones aquí abajo</p>
                <p className="text-muted-foreground">Cada buzón se prueba al agregarlo. Google puede tardar unos minutos en aplicar la autorización; si sale un error, espera y pulsa «Probar».</p>
              </div>
            </li>
          </ol>
          <p className="flex items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-2 text-muted-foreground leading-relaxed">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>El agente solo lee la bandeja de entrada y guarda borradores. No envía correos, no borra ni mueve nada, y no guarda el contenido completo de los mensajes — solo un resumen.</span>
          </p>
        </div>
      )}
    </div>
  );
}

function CampoCopiable({ etiqueta, valor, siFalta }: { etiqueta: string; valor: string | null; siFalta?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      {valor ? (
        <div className="flex items-stretch gap-1.5">
          {/* Si no cabe en una línea, se parte después de cada coma (un permiso por línea) y no a mitad de palabra. */}
          <code className="flex-1 min-w-0 rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere] select-all">
            {valor.split(",").map((parte, i, todas) => <Fragment key={i}>{parte}{i < todas.length - 1 && <>,<wbr /></>}</Fragment>)}
          </code>
          <Button type="button" size="sm" variant="outline" className="h-auto px-2 shrink-0" onClick={() => copiar(valor, etiqueta.split(" (")[0])} aria-label={`Copiar ${etiqueta}`}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-2 py-1.5 text-muted-foreground leading-relaxed">{siFalta}</p>
      )}
    </div>
  );
}

function BuzonCard({ buzon, onCambio }: { buzon: any; onCambio: () => void }) {
  const [editandoFirma, setEditandoFirma] = useState(false);
  const [firma, setFirma] = useState<string>(buzon.firma || "");

  const actualizarMutation = trpc.oficina.correo.buzones.actualizar.useMutation({
    onSuccess: onCambio,
    onError: (err) => toast.error(err.message || "No se pudo guardar"),
  });
  const probarMutation = trpc.oficina.correo.buzones.probar.useMutation({
    onSuccess: (data) => { if (data.ok) toast.success(data.mensaje); else toast.error("El buzón todavía no conecta"); onCambio(); },
    onError: (err) => toast.error(err.message || "No se pudo probar la conexión"),
  });
  const eliminarMutation = trpc.oficina.correo.buzones.eliminar.useMutation({
    onSuccess: () => { toast.success("Buzón quitado de la Oficina"); onCambio(); },
    onError: (err) => toast.error(err.message || "No se pudo quitar el buzón"),
  });

  const estado = !buzon.activo ? "pausado" : buzon.ultimoError ? "error" : buzon.ultimaConexionAt ? "conectado" : "sin_probar";
  const estadoVisual: Record<string, { punto: string; texto: string }> = {
    conectado: { punto: "bg-emerald-500", texto: "Conectado" },
    error: { punto: "bg-red-500", texto: "Sin conexión" },
    pausado: { punto: "bg-muted-foreground/40", texto: "Pausado" },
    sin_probar: { punto: "bg-amber-400", texto: "Sin probar" },
  };

  const handleEliminar = () => {
    if (!window.confirm(`¿Quitar el buzón ${buzon.email} de la Oficina? Se borran los resúmenes y alertas que el agente guardó de él. En Gmail no se toca nada.`)) return;
    eliminarMutation.mutate({ id: buzon.id });
  };

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`h-2 w-2 shrink-0 rounded-full ${estadoVisual[estado].punto}`} aria-hidden />
            <p className="font-medium truncate">{buzon.nombre}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{estadoVisual[estado].texto}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate pl-4">{buzon.email}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => probarMutation.mutate({ id: buzon.id })} disabled={probarMutation.isPending}>
            {probarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <PlugZap className="w-3.5 h-3.5 mr-1" />} Probar
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title={buzon.activo ? "Pausar: el agente deja de revisar este buzón" : "Reanudar la revisión de este buzón"}>
            <Switch checked={buzon.activo} onCheckedChange={(activo) => actualizarMutation.mutate({ id: buzon.id, activo })} disabled={actualizarMutation.isPending} aria-label={`Revisar el buzón ${buzon.email}`} />
            Revisar
          </label>
          <Button size="sm" variant="outline" className="h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={handleEliminar} disabled={eliminarMutation.isPending} title="Quitar buzón" aria-label={`Quitar el buzón ${buzon.email}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {buzon.ultimoError && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-800 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{buzon.ultimoError}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11px] text-muted-foreground">
        <span>Última revisión: {buzon.ultimaRevisionAt ? fechaLarga(buzon.ultimaRevisionAt) : "todavía ninguna"}</span>
        {buzon.requierenAtencion > 0 && <span className="text-red-700">{buzon.requierenAtencion} por atender</span>}
        <button type="button" className="font-medium text-[#b9790a] hover:underline" onClick={() => { setFirma(buzon.firma || ""); setEditandoFirma(v => !v); }}>
          {buzon.firma ? "Editar firma" : "Agregar firma"}
        </button>
      </div>

      {editandoFirma && (
        <div className="mt-2 space-y-2 pl-4">
          <Label className="text-xs" htmlFor={`firma-${buzon.id}`}>Firma de los borradores de este buzón</Label>
          <Textarea id={`firma-${buzon.id}`} value={firma} onChange={(e) => setFirma(e.target.value)} rows={3} maxLength={2000} className="text-sm"
            placeholder={`${buzon.nombre}\nAreda SAS`} />
          <p className="text-[11px] text-muted-foreground">Si la dejas vacía, los borradores se firman solo con «{buzon.nombre}».</p>
          <div className="flex gap-2">
            <Button size="sm" className="h-8 bg-[#EDA011] hover:bg-[#d48f0f] text-white" disabled={actualizarMutation.isPending}
              onClick={() => actualizarMutation.mutate({ id: buzon.id, firma: firma.trim() || null }, { onSuccess: () => { toast.success("Firma guardada"); setEditandoFirma(false); } })}>
              Guardar firma
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setEditandoFirma(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
