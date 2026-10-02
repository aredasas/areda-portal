import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Loader2, RefreshCw, Check, X, PenLine, ListPlus, RotateCcw, Copy, ExternalLink, Plus,
  Trash2, PlugZap, AlertTriangle, Mail, CircleCheck, ShieldCheck, ChevronDown, Folder, FolderInput, Search,
} from "lucide-react";
import { toast } from "sonner";

/** Pantallas propias del Agente de Correo dentro de su diálogo en la
 * Oficina: la Bandeja (lo que el agente leyó y clasificó, con borrador,
 * tarea y carpeta por correo, y la publicidad que espera autorización
 * para ir a la Papelera) y los Buzones (qué cuentas del Workspace revisa
 * y los pasos de conexión). */

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

export function BandejaCorreoTab({ onIrABuzones, vistaInicial = "atencion" }: { onIrABuzones: () => void; vistaInicial?: Vista }) {
  const utils = trpc.useUtils();
  const [vista, setVista] = useState<Vista>(vistaInicial);
  const [buzonId, setBuzonId] = useState<string>("todos");
  const [abierto, setAbierto] = useState<{ id: number; panel: PanelCorreo } | null>(null);
  const [ultimoResumen, setUltimoResumen] = useState<string | null>(null);
  // Correo recién marcado como gestionado al que todavía hay que decirle
  // a qué carpeta va. Vive aquí (y no en la fila) porque al gestionarlo
  // el correo sale de la lista de "requieren atención".
  // `plegado`: solo se avisa que se queda en Recibidos, con la opción de
  // elegirle carpeta (remitentes que no son clientes: DIAN, bancos…).
  const [porUbicar, setPorUbicar] = useState<{ correo: any; mensaje: string; sugeridaId: string | null; plegado: boolean } | null>(null);

  const buzonesQuery = trpc.oficina.correo.buzones.listar.useQuery();
  const publicidadQuery = trpc.oficina.correo.publicidad.contar.useQuery();
  const correosQuery = trpc.oficina.correo.listar.useQuery({
    vista, buzonId: buzonId === "todos" ? undefined : Number(buzonId),
  });

  const refrescarTodo = () => {
    utils.oficina.correo.listar.invalidate();
    utils.oficina.correo.publicidad.contar.invalidate();
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
  const totalPublicidad = publicidadQuery.data?.cantidad || 0;
  const correos = correosQuery.data || [];

  /** Lo que pasa después de pulsar ✓ en un correo: se movió solo a la
   * carpeta del cliente, o hay que elegirla, o no se puede mover. */
  const alGestionar = (correo: any, traslado: any) => {
    refrescarTodo();
    if (traslado.movido) {
      toast.success(`Gestionado — movido a la carpeta «${traslado.carpeta}»`);
    } else if (traslado.motivo === "elegir_carpeta") {
      setAbierto(null);
      setPorUbicar({ correo, mensaje: traslado.mensaje, sugeridaId: traslado.sugerida?.id ?? null, plegado: false });
    } else if (traslado.motivo === "sin_cliente") {
      // El aviso va dentro del diálogo (y no como notificación flotante)
      // para que el botón de elegir carpeta se pueda pulsar.
      setAbierto(null);
      setPorUbicar({ correo, mensaje: "Elige la carpeta de Gmail a la que va este correo.", sugeridaId: null, plegado: true });
    } else {
      toast.warning("Gestionado, pero el correo se queda en Recibidos", { description: traslado.mensaje, duration: 9000 });
    }
  };

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
          {([["atencion", "Requieren atención"], ["publicidad", "Publicidad"], ["todos", "Todos"]] as const).map(([valor, etiqueta]) => (
            <button
              key={valor} type="button" onClick={() => { setVista(valor); setAbierto(null); }} aria-pressed={vista === valor}
              className={`px-2.5 py-1 text-xs rounded-[5px] transition-colors ${vista === valor ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {etiqueta}
              {valor === "atencion" && totalAtencion > 0 && (
                <span className="ml-1.5 inline-flex min-w-4 justify-center rounded-full bg-red-100 px-1 text-[10px] font-medium text-red-800 tabular-nums">{totalAtencion}</span>
              )}
              {valor === "publicidad" && totalPublicidad > 0 && (
                <span className="ml-1.5 inline-flex min-w-4 justify-center rounded-full bg-muted-foreground/15 px-1 text-[10px] font-medium text-foreground/80 tabular-nums">{totalPublicidad}</span>
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

      {porUbicar && (
        <div className="rounded-md border border-[#EDA011]/50 bg-[#EDA011]/5 p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Gestionado.</span>{" "}
            {porUbicar.plegado ? "No es de un cliente reconocido, así que se queda en Recibidos:" : "Falta ubicarlo en Gmail:"}
          </p>
          <p className="mt-0.5 text-sm font-medium leading-snug break-words">{porUbicar.correo.asunto || "(sin asunto)"}</p>
          <p className="text-xs text-muted-foreground truncate">
            {porUbicar.correo.remitenteNombre || porUbicar.correo.remitenteEmail}
            {porUbicar.correo.clienteNombre ? ` · ${porUbicar.correo.clienteNombre}` : ""}
          </p>
          {porUbicar.plegado ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 bg-background" onClick={() => setPorUbicar({ ...porUbicar, plegado: false })}>
                <FolderInput className="w-4 h-4 mr-1.5" /> Elegir carpeta
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setPorUbicar(null)}>Dejarlo así</Button>
            </div>
          ) : (
            <SelectorCarpeta
              key={porUbicar.correo.id} correo={porUbicar.correo} mensaje={porUbicar.mensaje} sugeridaId={porUbicar.sugeridaId}
              textoCancelar="Dejar en Recibidos"
              onMovido={() => { setPorUbicar(null); refrescarTodo(); }} onCancelar={() => setPorUbicar(null)}
            />
          )}
        </div>
      )}

      {correosQuery.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : vista === "publicidad" ? (
        <PublicidadLista correos={correos} mostrarBuzon={buzones.length > 1} onCambio={refrescarTodo} />
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
              onCambio={refrescarTodo} onGestionado={(traslado) => alGestionar(c, traslado)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Vista = "atencion" | "publicidad" | "todos";
type PanelCorreo = "borrador" | "tarea" | "carpeta";

function CorreoRow({ correo, mostrarBuzon, panel, onPanel, onCambio, onGestionado }: {
  correo: any; mostrarBuzon: boolean; panel: PanelCorreo | null;
  onPanel: (panel: PanelCorreo | null) => void; onCambio: () => void;
  /** El correo quedó gestionado; `traslado` dice si se movió a la carpeta del cliente. */
  onGestionado: (traslado: any) => void;
}) {
  const marcarMutation = trpc.oficina.correo.marcar.useMutation({
    onSuccess: onCambio,
    onError: (err) => toast.error(err.message || "No se pudo actualizar el correo"),
  });
  const gestionarMutation = trpc.oficina.correo.gestionar.useMutation({
    onSuccess: (data) => onGestionado(data.traslado),
    onError: (err) => toast.error(err.message || "No se pudo actualizar el correo"),
  });
  const ocupado = marcarMutation.isPending || gestionarMutation.isPending;
  const enPapelera = !!correo.enPapeleraAt;
  const cerrado = correo.estado !== "pendiente";
  const requiereAtencion = correo.prioridad === "urgente" || correo.prioridad === "atencion";
  const alternar = (cual: PanelCorreo) => onPanel(panel === cual ? null : cual);

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
          {correo.carpeta && !enPapelera && (
            <span className="inline-flex items-center gap-0.5 text-emerald-700 min-w-0" title={`En la carpeta «${correo.carpeta}» de Gmail`}>
              <Folder className="w-3 h-3 shrink-0" /> <span className="truncate max-w-44">{correo.carpeta}</span>
            </span>
          )}
          {enPapelera
            ? <span className="inline-flex items-center gap-0.5 font-medium" title={`Enviado a la Papelera el ${fechaLarga(correo.enPapeleraAt)}`}><Trash2 className="w-3 h-3" /> En la Papelera</span>
            : cerrado && <span className="font-medium">{correo.estado === "gestionado" ? "Gestionado" : "Descartado"}</span>}
        </div>
        {/* Lo que ya está en la Papelera de Gmail no admite más acciones desde aquí. */}
        {!enPapelera && (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1 shrink-0 self-end sm:self-auto">
            <Button size="sm" variant={panel === "borrador" ? "secondary" : "outline"} className="h-7 px-1.5 sm:px-2 text-xs" onClick={() => alternar("borrador")}>
              <PenLine className="w-3.5 h-3.5 mr-1" /> Borrador
            </Button>
            <Button size="sm" variant={panel === "tarea" ? "secondary" : "outline"} className="h-7 px-1.5 sm:px-2 text-xs" onClick={() => alternar("tarea")} disabled={!!correo.taskId} title={correo.taskId ? "Este correo ya tiene una tarea" : undefined}>
              <ListPlus className="w-3.5 h-3.5 mr-1" /> Tarea
            </Button>
            <Button size="sm" variant={panel === "carpeta" ? "secondary" : "outline"} className="h-7 px-1.5 sm:px-2 text-xs" onClick={() => alternar("carpeta")}
              title={correo.carpeta ? "Cambiarlo de carpeta en Gmail" : "Moverlo a una carpeta de Gmail"} aria-label="Mover a una carpeta">
              <FolderInput className="w-3.5 h-3.5 sm:mr-1" /> <span className="hidden sm:inline">Carpeta</span>
            </Button>
            {cerrado ? (
              <Button size="sm" variant="outline" className="h-7 px-1.5 sm:px-2 text-xs text-muted-foreground" onClick={() => marcarMutation.mutate({ id: correo.id, estado: "pendiente" })} disabled={ocupado} title="Volver a dejarlo pendiente" aria-label="Reabrir">
                <RotateCcw className="w-3.5 h-3.5 sm:mr-1" /> <span className="hidden sm:inline">Reabrir</span>
              </Button>
            ) : requiereAtencion ? (
              <>
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => gestionarMutation.mutate({ id: correo.id })} disabled={ocupado}
                  title={correo.clientId ? "Gestionado: se mueve a la carpeta del cliente" : "Marcar como gestionado"} aria-label="Marcar como gestionado">
                  {gestionarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-muted-foreground" onClick={() => marcarMutation.mutate({ id: correo.id, estado: "descartado" })} disabled={ocupado} title="Descartar: no requería atención" aria-label="Descartar">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>

      {panel === "borrador" && <BorradorPanel correo={correo} onCambio={onCambio} />}
      {panel === "tarea" && <TareaPanel correo={correo} onCreada={() => { onPanel(null); onCambio(); }} />}
      {panel === "carpeta" && (
        <div className="mt-2.5 rounded-md border bg-muted/30 px-3 pb-3">
          <SelectorCarpeta
            correo={correo} sugeridaId={null}
            mensaje={correo.clientId
              ? `Elige la carpeta de Gmail a la que va este correo. Quedará como la carpeta de ${correo.clienteNombre || "este cliente"} para los próximos.`
              : "Elige la carpeta de Gmail a la que va este correo."}
            onMovido={() => { onPanel(null); onCambio(); }} onCancelar={() => onPanel(null)}
          />
        </div>
      )}
    </div>
  );
}

/** Sin tildes ni mayúsculas, para buscar carpetas escribiendo "drogueria". */
const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Lista de las carpetas (etiquetas) del buzón para elegir a cuál va un
 * correo. Con buscador, porque una firma contable tiene una por cliente. */
function SelectorCarpeta({ correo, mensaje, sugeridaId, textoCancelar = "Cancelar", onMovido, onCancelar }: {
  correo: any; mensaje: string; sugeridaId: string | null; textoCancelar?: string;
  onMovido: () => void; onCancelar: () => void;
}) {
  const carpetasQuery = trpc.oficina.correo.carpetas.useQuery({ buzonId: correo.buzonId }, { staleTime: 60 * 1000, retry: false });
  const [elegida, setElegida] = useState<string | null>(sugeridaId);
  const [busqueda, setBusqueda] = useState("");
  const moverMutation = trpc.oficina.correo.moverACarpeta.useMutation({
    onSuccess: (data) => { toast.success(`Movido a la carpeta «${data.carpeta}»`); onMovido(); },
    onError: (err) => toast.error(err.message || "No se pudo mover el correo", { duration: 9000 }),
  });
  const ref = useTraerALaVista<HTMLDivElement>();

  const carpetas = carpetasQuery.data || [];
  const filtro = normalizar(busqueda.trim());
  const visibles = filtro ? carpetas.filter(c => normalizar(c.nombre).includes(filtro)) : carpetas;
  const nombreElegida = carpetas.find(c => c.id === elegida)?.nombre;

  return (
    <div ref={ref} className="pt-2.5 space-y-2">
      <p className="text-xs leading-relaxed">{mensaje}</p>
      {carpetasQuery.isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Leyendo las carpetas del buzón…</div>
      ) : carpetasQuery.error ? (
        <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-800 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{carpetasQuery.error.message || "No se pudieron leer las carpetas del buzón."}</span>
        </p>
      ) : carpetas.length === 0 ? (
        <p className="rounded-md border border-dashed bg-background px-2.5 py-2 text-xs text-muted-foreground leading-relaxed">
          El buzón de {correo.buzonNombre} todavía no tiene carpetas (etiquetas). Créala en Gmail con el nombre del cliente y vuelve a abrir esta lista.
        </p>
      ) : (
        <div className="rounded-md border bg-background overflow-hidden">
          {carpetas.length > 6 && (
            <div className="relative border-b">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar carpeta…" aria-label="Buscar carpeta"
                className="h-8 border-0 rounded-none pl-8 text-xs shadow-none focus-visible:ring-0" />
            </div>
          )}
          <div role="radiogroup" aria-label="Carpeta de Gmail" className="max-h-44 overflow-y-auto py-1">
            {visibles.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">Ninguna carpeta coincide con «{busqueda.trim()}».</p>
            ) : visibles.map(c => (
              <button
                key={c.id} type="button" role="radio" aria-checked={elegida === c.id} onClick={() => setElegida(c.id)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${elegida === c.id ? "bg-[#EDA011]/15 font-medium" : "hover:bg-muted/60"}`}
              >
                <Folder className={`w-3.5 h-3.5 shrink-0 ${elegida === c.id ? "text-[#b9790a]" : "text-muted-foreground"}`} />
                <span className="flex-1 min-w-0 break-words">{c.nombre}</span>
                {c.id === sugeridaId && <span className="shrink-0 text-[10px] font-normal text-muted-foreground">Sugerida</span>}
                {elegida === c.id && <Check className="w-3.5 h-3.5 shrink-0 text-[#b9790a]" />}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8 max-w-full bg-[#EDA011] hover:bg-[#d48f0f] text-white" disabled={!elegida || !nombreElegida || moverMutation.isPending}
          onClick={() => elegida && moverMutation.mutate({ id: correo.id, carpetaId: elegida })}>
          {moverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5 shrink-0" /> : <FolderInput className="w-4 h-4 mr-1.5 shrink-0" />}
          <span className="truncate">{nombreElegida ? `Mover a «${nombreElegida}»` : "Mover a la carpeta"}</span>
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={onCancelar} disabled={moverMutation.isPending}>{textoCancelar}</Button>
      </div>
    </div>
  );
}

/** Publicidad que el agente identificó y que espera autorización. Nada se
 * elimina solo: aquí se elige qué va a la Papelera (recuperable 30 días)
 * y qué se conserva. */
function PublicidadLista({ correos, mostrarBuzon, onCambio }: { correos: any[]; mostrarBuzon: boolean; onCambio: () => void }) {
  // Se guardan los DESMARCADOS: así todo lo que llega nuevo aparece
  // marcado, que es lo habitual (casi siempre se elimina todo). Después
  // de cada acción lo que queda vuelve a quedar marcado, listo para
  // decidir sobre ello (lo normal: desmarcar lo que se conserva, enviar
  // el resto a la Papelera y luego «Conservar» lo que quedó).
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const elegidos = correos.filter(c => !desmarcados.has(c.id)).map(c => c.id as number);
  const todos = correos.length > 0 && elegidos.length === correos.length;

  const eliminarMutation = trpc.oficina.correo.publicidad.eliminar.useMutation({
    onSuccess: (data) => {
      setConfirmando(false);
      setDesmarcados(new Set());
      setAviso(data.fallidos > 0 ? `${data.fallidos === 1 ? "1 correo no se pudo" : `${data.fallidos} correos no se pudieron`} enviar a la Papelera. ${data.error || ""}`.trim() : null);
      if (data.eliminados > 0) toast.success(`${data.eliminados === 1 ? "1 correo enviado" : `${data.eliminados} correos enviados`} a la Papelera`, { description: "Gmail los conserva 30 días por si hay que recuperar alguno." });
      else if (data.fallidos > 0) toast.error("No se pudo enviar nada a la Papelera");
      onCambio();
    },
    onError: (err) => { setConfirmando(false); toast.error(err.message || "No se pudo enviar a la Papelera"); },
  });
  const conservarMutation = trpc.oficina.correo.publicidad.conservar.useMutation({
    onSuccess: (data) => {
      setDesmarcados(new Set());
      setAviso(null);
      toast.success(data.conservados === 1 ? "1 correo conservado" : `${data.conservados} correos conservados`, { description: "Se quedan en Gmail tal como están." });
      onCambio();
    },
    onError: (err) => toast.error(err.message || "No se pudo actualizar"),
  });
  const ocupado = eliminarMutation.isPending || conservarMutation.isPending;

  const alternar = (id: number) => {
    setConfirmando(false);
    setDesmarcados(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  };
  const alternarTodos = () => { setConfirmando(false); setDesmarcados(todos ? new Set(correos.map(c => c.id)) : new Set()); };

  if (correos.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-8 px-6 text-center">
        <CircleCheck className="w-7 h-7 mx-auto mb-2 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No hay publicidad esperando tu autorización.</p>
        <p className="text-xs text-muted-foreground mt-1">Cuando el agente encuentre boletines o promociones, aparecerán aquí para que decidas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground leading-relaxed">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>El agente identificó estos correos como publicidad. Ninguno se elimina sin tu autorización, y lo que envíes a la Papelera se puede recuperar en Gmail durante 30 días.</span>
      </p>

      {aviso && (
        <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-800 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{aviso}</span>
        </p>
      )}

      <div className="rounded-md border overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/40 px-3 py-2">
          {confirmando ? (
            <>
              <p className="flex-1 min-w-48 text-xs leading-relaxed">
                <span className="font-medium">¿Enviar {elegidos.length === 1 ? "1 correo" : `${elegidos.length} correos`} a la Papelera?</span>{" "}
                <span className="text-muted-foreground">Se pueden recuperar durante 30 días.</span>
              </p>
              <div className="flex items-center gap-1.5 ml-auto">
                <Button size="sm" className="h-8 bg-red-600 hover:bg-red-700 text-white" onClick={() => eliminarMutation.mutate({ ids: elegidos })} disabled={ocupado}>
                  {eliminarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                  {eliminarMutation.isPending ? "Enviando…" : "Sí, enviar"}
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirmando(false)} disabled={ocupado}>Cancelar</Button>
              </div>
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox checked={todos ? true : elegidos.length > 0 ? "indeterminate" : false} onCheckedChange={alternarTodos} disabled={ocupado} aria-label="Marcar todos" />
                <span className="tabular-nums">{elegidos.length} de {correos.length} {correos.length === 1 ? "marcado" : "marcados"}</span>
              </label>
              <div className="flex items-center gap-1.5 ml-auto">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => conservarMutation.mutate({ ids: elegidos })} disabled={ocupado || elegidos.length === 0}
                  title="No son publicidad para eliminar: salen de esta lista y se quedan en Gmail">
                  {conservarMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />} Conservar
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setConfirmando(true)} disabled={ocupado || elegidos.length === 0}>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Enviar a la Papelera{elegidos.length > 0 ? ` (${elegidos.length})` : ""}
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="divide-y">
          {correos.map(c => {
            const marcado = !desmarcados.has(c.id);
            return (
              <label key={c.id} className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:bg-muted/40 ${marcado ? "" : "opacity-60"}`}>
                <Checkbox checked={marcado} onCheckedChange={() => alternar(c.id)} disabled={ocupado} className="mt-0.5" aria-label={`Marcar el correo de ${c.remitenteNombre || c.remitenteEmail}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="flex-1 min-w-0 truncate text-sm font-medium" title={c.remitenteEmail}>{c.remitenteNombre || c.remitenteEmail}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={fechaLarga(c.fechaCorreo)}>{fechaCorta(c.fechaCorreo)}</span>
                  </div>
                  <p className="text-xs leading-snug break-words">{c.asunto || "(sin asunto)"}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                    {c.remitenteNombre ? c.remitenteEmail : ""}{c.remitenteNombre && mostrarBuzon ? " · " : ""}{mostrarBuzon ? `Buzón: ${c.buzonNombre}` : ""}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Al abrir un panel dentro de un correo (borrador, tarea o carpeta) lo trae
 * a la vista — en una bandeja larga podría quedar por debajo del borde. */
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
  const [resultado, setResultado] = useState<{ texto: string; advertencia: string | null; firma: "portal" | "gmail" | "nombre" } | null>(null);
  const redactarMutation = trpc.oficina.correo.redactarBorrador.useMutation({
    onSuccess: (data) => {
      setResultado({ texto: data.texto, advertencia: data.advertencia, firma: data.firma });
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
          {resultado && (
            <p className={`flex items-start gap-1.5 text-xs ${resultado.firma === "nombre" ? "text-amber-800" : "text-muted-foreground"}`}>
              <PenLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {resultado.firma === "gmail" ? `Lleva la firma que ${correo.buzonNombre} tiene configurada en Gmail, con su diseño original.`
                  : resultado.firma === "portal" ? "Lleva la firma escrita para este buzón en la pestaña Buzones."
                  : `Este buzón no tiene firma en Gmail, así que va firmado solo con «${correo.buzonNombre}». Puedes escribirle una en la pestaña Buzones.`}
              </span>
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
  // Buzones conectados con el permiso de la primera versión (leer y redactar).
  const faltaPermiso = buzones.some((b: any) => b.activo && b.ultimaConexionAt && !b.ultimoError && !b.permisoCompleto);

  return (
    <div className="space-y-4">
      {conexion && !conexion.configurado ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Falta configurar la cuenta de servicio de Google en Railway (son las mismas variables que usa el Drive: GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY). Sin eso el agente no puede conectarse al correo.</span>
        </div>
      ) : conexion ? (
        <PasosConexion conexion={conexion} abiertoPorDefecto={buzones.length === 0 || hayErrores || faltaPermiso} actualizarPermiso={faltaPermiso} />
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

function PasosConexion({ conexion, abiertoPorDefecto, actualizarPermiso }: { conexion: any; abiertoPorDefecto: boolean; actualizarPermiso: boolean }) {
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
          {actualizarPermiso && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">Hay que actualizar el permiso.</span> Para mover correos a las carpetas y enviar publicidad a la Papelera, el agente necesita un permiso más amplio que el autorizado al principio. Solo es repetir el paso 2: en la consola de administrador pulsa <span className="font-medium">Editar</span> sobre la cuenta ya autorizada, reemplaza los permisos por el de abajo y luego pulsa «Probar» en cada buzón. Mientras tanto sigue leyendo y redactando como siempre.
              </span>
            </p>
          )}
          <p className="text-muted-foreground leading-relaxed">
            El agente entra al correo con la misma cuenta de servicio que ya conecta el Drive. Para que pueda trabajar en los buzones, el administrador del Workspace la autoriza una sola vez:
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
                <CampoCopiable etiqueta="Permiso de OAuth" valor={permisos} />
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
            <span>El agente lee la bandeja de entrada, guarda borradores, mueve a la carpeta del cliente lo que marcas como gestionado y envía a la Papelera solo la publicidad que autorizas. No envía correos, no elimina nada de forma definitiva y no guarda el contenido completo de los mensajes — solo un resumen.</span>
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

const primeraLinea = (texto: string) => texto.split("\n").map(l => l.trim()).find(Boolean) || "";

function BuzonCard({ buzon, onCambio }: { buzon: any; onCambio: () => void }) {
  const [editandoFirma, setEditandoFirma] = useState(false);
  const [firma, setFirma] = useState<string>(buzon.firma || "");
  const firmaGmail: string | null = buzon.firmaGmailTexto || null;

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
        {/* Ancho mínimo: en pantallas angostas los botones bajan a otra línea en vez de tapar el nombre. */}
        <div className="flex-1 min-w-44">
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
      {estado === "conectado" && !buzon.permisoCompleto && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Conectado con el permiso anterior: lee y redacta borradores, pero todavía no puede mover correos a carpetas ni enviar publicidad a la Papelera. Actualiza el permiso (paso 2 de arriba) y pulsa «Probar».</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11px] text-muted-foreground">
        <span>Última revisión: {buzon.ultimaRevisionAt ? fechaLarga(buzon.ultimaRevisionAt) : "todavía ninguna"}</span>
        {buzon.requierenAtencion > 0 && <span className="text-red-700">{buzon.requierenAtencion} por atender</span>}
      </div>

      {/* Qué firma llevarán los borradores de este buzón. */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-4 text-[11px] text-muted-foreground">
        <span className="min-w-0 break-words">
          Firma de los borradores:{" "}
          {buzon.firma
            ? <><span className="text-foreground">«{primeraLinea(buzon.firma)}»</span>, escrita aquí</>
            : firmaGmail
              ? <><span className="text-foreground">«{primeraLinea(firmaGmail)}»</span>, la configurada en Gmail</>
              : <>solo el nombre «{buzon.nombre}» <span className="text-amber-700">(el buzón no tiene firma en Gmail)</span></>}
        </span>
        <button type="button" className="font-medium text-[#b9790a] hover:underline" onClick={() => { setFirma(buzon.firma || ""); setEditandoFirma(v => !v); }}>
          {buzon.firma ? "Editar firma" : firmaGmail ? "Usar otra" : "Escribir una"}
        </button>
      </div>

      {editandoFirma && (
        <div className="mt-2 space-y-2 pl-4">
          <Label className="text-xs" htmlFor={`firma-${buzon.id}`}>Firma de los borradores de este buzón</Label>
          <Textarea id={`firma-${buzon.id}`} value={firma} onChange={(e) => setFirma(e.target.value)} rows={3} maxLength={2000} className="text-sm"
            placeholder={`${buzon.nombre}\nAreda SAS`} />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {firmaGmail
              ? "Lo que escribas aquí reemplaza la firma de Gmail en los borradores del agente (va como texto, sin logo ni colores). Déjala vacía para usar la de Gmail."
              : `Si la dejas vacía, los borradores se firman solo con «${buzon.nombre}».`}
          </p>
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
