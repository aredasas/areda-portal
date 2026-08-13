import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import CommentsSection from "@/components/CommentsSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  CheckSquare,
  Loader2,
  FileText,
  FolderOpen,
  ClipboardList,
  Calendar as CalendarIcon,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  ArrowRight,
  RotateCcw,
  Download,
  RefreshCw,
  AlertTriangle,
  History,
  Search,
  Upload,
  Paperclip,
} from "lucide-react";

const historyLabels: Record<string, string> = {
  creada: "Creada",
  completada: "Completada",
  correccion_solicitada: "Devuelta para corrección",
  aprobada: "Aprobada",
  reabierta: "Reabierta",
  cancelada: "Cancelada",
};

const historyDot: Record<string, string> = {
  creada: "bg-gray-400",
  completada: "bg-blue-500",
  correccion_solicitada: "bg-orange-500",
  aprobada: "bg-green-500",
  reabierta: "bg-yellow-500",
  cancelada: "bg-red-500",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function Revision() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();

  const rentaPendienteQuery = trpc.renta.clientes.pendientesRevision.useQuery(undefined, { retry: false });
  const rentaTerminadosQuery = trpc.renta.clientes.terminados.useQuery(undefined, { retry: false });
  const utilsRenta = trpc.useUtils();
  const [rentaClienteRevisando, setRentaClienteRevisando] = useState<any | null>(null);
  const aprobarRentaMutation = trpc.renta.clientes.aprobarRevision.useMutation({
    onSuccess: () => { toast.success("Revisión de renta aprobada"); rentaPendienteQuery.refetch(); setRentaClienteRevisando(null); },
  });
  const rechazarRentaMutation = trpc.renta.clientes.rechazarRevision.useMutation({
    onSuccess: () => { toast.success("Revisión de renta rechazada"); rentaPendienteQuery.refetch(); setRentaClienteRevisando(null); },
  });
  const reabrirRentaMutation = trpc.renta.clientes.reabrir.useMutation({
    onSuccess: () => { toast.success("Renta reabierta — vuelve a quedar editable"); rentaTerminadosQuery.refetch(); },
    onError: (err) => toast.error(err.message || "No se pudo reabrir"),
  });

  const now = new Date();
  const [monthFilter, setMonthFilter] = useState<string>(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
  const [allTime, setAllTime] = useState(false);
  const [clientFilter, setClientFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [obligationFilter, setObligationFilter] = useState("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const { data: clients } = trpc.clients.list.useQuery();
  const { data: collaborators } = trpc.collaborators.list.useQuery({ isActive: true });
  const { data: obligations } = trpc.obligations.list.useQuery();

  const { data: items, isLoading, refetch } = trpc.review.list.useQuery({
    month: allTime ? undefined : monthFilter,
    clientId: clientFilter !== "all" ? parseInt(clientFilter) : undefined,
    assignedToId: assigneeFilter !== "all" ? parseInt(assigneeFilter) : undefined,
    obligationId: obligationFilter !== "all" ? parseInt(obligationFilter) : undefined,
    taskSearch: taskSearch.trim() || undefined,
  });

  const { data: taskDetail } = trpc.tasks.getById.useQuery(
    { id: selectedItem?.id },
    { enabled: !!selectedItem && selectedItem.itemType === "task" }
  );
  const { data: deadlineAttachments } = trpc.deadlines.getAttachments.useQuery(
    { deadlineId: selectedItem?.id },
    { enabled: !!selectedItem && selectedItem.itemType === "deadline" }
  );

  const attachments = selectedItem?.itemType === "task" ? taskDetail?.attachments : deadlineAttachments;

  const [reviewNotesInput, setReviewNotesInput] = useState("");
  const [adjuntosCorreccion, setAdjuntosCorreccion] = useState<File[]>([]);
  const approveTask = trpc.tasks.approve.useMutation();
  const approveDeadline = trpc.deadlines.approve.useMutation();
  const requestTaskCorrection = trpc.tasks.requestCorrection.useMutation();
  const requestDeadlineCorrection = trpc.deadlines.requestCorrection.useMutation();

  const { data: taskHistory } = trpc.tasks.getHistory.useQuery(
    { id: selectedItem?.id },
    { enabled: !!selectedItem && selectedItem.itemType === "task" }
  );
  const { data: deadlineHistory } = trpc.deadlines.getHistory.useQuery(
    { id: selectedItem?.id },
    { enabled: !!selectedItem && selectedItem.itemType === "deadline" }
  );
  const history = selectedItem?.itemType === "task" ? taskHistory : deadlineHistory;

  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      if (selectedItem.itemType === "task") {
        await approveTask.mutateAsync({ id: selectedItem.id, reviewNotes: reviewNotesInput || undefined });
      } else {
        await approveDeadline.mutateAsync({ id: selectedItem.id, reviewNotes: reviewNotesInput || undefined });
      }
      toast.success("Aprobado correctamente");
      setSelectedItem(null);
      setReviewNotesInput("");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al aprobar");
    }
  };

  const handleRequestCorrection = async () => {
    if (!selectedItem || !reviewNotesInput.trim()) return;
    try {
      if (selectedItem.itemType === "task") {
        const adjuntos = await Promise.all(adjuntosCorreccion.map(async (archivo) => {
          const fileBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(archivo);
          });
          return { fileName: archivo.name, fileBase64, contentType: archivo.type || "application/octet-stream" };
        }));
        await requestTaskCorrection.mutateAsync({ id: selectedItem.id, reviewNotes: reviewNotesInput, adjuntos });
      } else {
        await requestDeadlineCorrection.mutateAsync({ id: selectedItem.id, reviewNotes: reviewNotesInput });
      }
      toast.success("Se envió de vuelta al encargado con la observación");
      setSelectedItem(null);
      setReviewNotesInput("");
      setAdjuntosCorreccion([]);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al solicitar la corrección");
    }
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <h2 className="text-lg font-medium mb-2">Acceso Restringido</h2>
            <p className="text-muted-foreground">Solo los administradores pueden acceder a esta sección.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E] flex items-center gap-2">
            <CheckSquare className="h-6 w-6" />
            Revisión de Completados
          </h1>
          <p className="text-muted-foreground mt-1">
            Tareas y vencimientos tributarios ya marcados como completados, con sus soportes adjuntos
          </p>
        </div>

        {!!rentaPendienteQuery.data?.length && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Renta pendiente de revisión
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rentaPendienteQuery.data.map((c: any) => (
                <button
                  key={c.id}
                  className="flex items-center justify-between border rounded-md p-3 gap-2 w-full text-left hover:bg-muted/50"
                  onClick={() => setRentaClienteRevisando(c)}
                >
                  <span className="font-medium truncate">Renta de {c.nombre} — año gravable {c.anioGravable}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {!!rentaTerminadosQuery.data?.length && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Renta terminada
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rentaTerminadosQuery.data.map((c: any) => (
                <RentaTerminadaRow key={c.id} cliente={c} onReabrir={() => reabrirRentaMutation.mutate({ rentaClienteId: c.id })} reabriendo={reabrirRentaMutation.isPending} />
              ))}
            </CardContent>
          </Card>
        )}

        <RentaResumenDialog
          cliente={rentaClienteRevisando}
          onClose={() => setRentaClienteRevisando(null)}
          onAprobar={() => aprobarRentaMutation.mutate({ rentaClienteId: rentaClienteRevisando.id })}
          onRechazar={(comentario) => rechazarRentaMutation.mutate({ rentaClienteId: rentaClienteRevisando.id, comentario })}
          aprobando={aprobarRentaMutation.isPending}
          rechazando={rechazarRentaMutation.isPending}
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={allTime ? "all_time" : monthFilter}
            onValueChange={(v) => {
              if (v === "all_time") { setAllTime(true); return; }
              setAllTime(false);
              setMonthFilter(v);
            }}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_time">Todo el histórico</SelectItem>
              {Array.from({ length: 12 }).map((_, i) => {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
                return <SelectItem key={value} value={value}>{monthNames[d.getMonth()]} {d.getFullYear()}</SelectItem>;
              })}
            </SelectContent>
          </Select>

          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[190px] h-9">
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {clients?.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.razonSocial}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-[190px] h-9">
              <SelectValue placeholder="Encargado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los encargados</SelectItem>
              {collaborators?.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={obligationFilter} onValueChange={setObligationFilter}>
            <SelectTrigger className="w-[190px] h-9">
              <SelectValue placeholder="Obligación" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las obligaciones</SelectItem>
              {obligations?.map((o: any) => (
                <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder="Buscar tarea..."
              className="w-[190px] h-9 pl-7"
            />
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {items?.length || 0} elemento(s) completado(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-[#EDA011]" />
              </div>
            ) : items && items.length > 0 ? (
              <div className="space-y-2">
                {items.map((item: any) => (
                  <div
                    key={`${item.itemType}-${item.id}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                    onClick={() => { setSelectedItem(item); setReviewNotesInput(""); setAdjuntosCorreccion([]); }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant="outline" className={item.itemType === "deadline" ? "bg-purple-50 text-purple-700 border-purple-200 shrink-0" : "bg-blue-50 text-blue-700 border-blue-200 shrink-0"}>
                        {item.itemType === "deadline" ? <CalendarIcon className="h-3 w-3 mr-1" /> : <ClipboardList className="h-3 w-3 mr-1" />}
                        {item.itemType === "deadline" ? "Tributario" : "Tarea"}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.clientName || "Sin cliente"} — {item.subtitle}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-xs text-muted-foreground">
                        {item.completedAt && new Date(item.completedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                      {item.completedByName && (
                        <p className="text-xs text-muted-foreground">por {item.completedByName}</p>
                      )}
                      {item.reviewStatus === "aprobado" ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 mt-1">
                          <ThumbsUp className="h-3 w-3 mr-1" /> Aprobado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300 mt-1">
                          Sin revisar
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <CheckSquare className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No hay elementos completados con estos filtros</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => { if (!open) { setSelectedItem(null); setReviewNotesInput(""); setAdjuntosCorreccion([]); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          {selectedItem && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant="outline" className={selectedItem.itemType === "deadline" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
                    {selectedItem.itemType === "deadline" ? "Tributario" : "Tarea"}
                  </Badge>
                  {selectedItem.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm min-w-0">
                <div><span className="text-muted-foreground">Cliente:</span> {selectedItem.clientName || "Sin cliente"}</div>
                <div><span className="text-muted-foreground">Detalle:</span> {selectedItem.subtitle}</div>
                {selectedItem.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completado:</span>{" "}
                    {new Date(selectedItem.completedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                    {selectedItem.completedByName && ` por ${selectedItem.completedByName}`}
                  </div>
                )}
                {selectedItem.completionNotes && (
                  <div><span className="text-muted-foreground">Notas:</span> {selectedItem.completionNotes}</div>
                )}
                {selectedItem.driveSubfolder && (
                  <div><span className="text-muted-foreground">Subcarpeta de Drive:</span> {selectedItem.driveSubfolder}</div>
                )}
                {selectedItem.clientDriveFolderUrl && (
                  <a
                    href={selectedItem.clientDriveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[#EDA011] hover:underline bg-[#FFF8E2] border border-[#EDA011]/30 rounded-md px-3 py-2"
                  >
                    <FolderOpen className="h-4 w-4 flex-shrink-0" />
                    Abrir carpeta de Drive del cliente
                  </a>
                )}

                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Archivos de soporte
                  </h4>
                  {attachments && attachments.length > 0 ? (
                    <div className="space-y-1">
                      {attachments.map((att: any) => (
                        <div key={att.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded w-full min-w-0">
                          <div className="flex-1 min-w-0">
                            <p className="truncate" title={att.fileName}>{att.fileName}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {new Date(att.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                              {att.uploadedByName && ` — ${att.uploadedByName}`}
                            </p>
                          </div>
                          <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[#EDA011] text-xs underline shrink-0">
                            Ver
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Cargando o sin archivos adjuntos...</p>
                  )}
                </div>

                <div className="border-t pt-3">
                  {selectedItem.reviewStatus === "aprobado" ? (
                    <div className="bg-green-50 border border-green-200 rounded-md p-3">
                      <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                        <ThumbsUp className="h-4 w-4" /> Aprobado
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(selectedItem.reviewedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                        {selectedItem.reviewedByName && ` por ${selectedItem.reviewedByName}`}
                      </p>
                      {selectedItem.reviewNotes && (
                        <p className="text-sm mt-2">
                          <span className="text-muted-foreground">Observaciones: </span>
                          {selectedItem.reviewNotes}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Observaciones (obligatorias para corregir, opcionales para aprobar)</Label>
                      <Textarea
                        value={reviewNotesInput}
                        onChange={(e) => setReviewNotesInput(e.target.value)}
                        placeholder="Ej: Todo en orden. / Verificar el valor del renglón 32 para el próximo período."
                        rows={2}
                      />
                      {selectedItem.itemType === "task" && (
                        <div className="space-y-1.5">
                          <input
                            type="file"
                            id="adjunto-correccion"
                            multiple
                            className="hidden"
                            onChange={(e) => setAdjuntosCorreccion((prev) => [...prev, ...Array.from(e.target.files || [])])}
                          />
                          <Button
                            variant="outline" size="sm" type="button" className="gap-2"
                            onClick={() => document.getElementById("adjunto-correccion")?.click()}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {adjuntosCorreccion.length > 0 ? `Agregar otro archivo (${adjuntosCorreccion.length} adjunto(s))` : "Adjuntar archivo(s) (opcional, para corregir)"}
                          </Button>
                          {adjuntosCorreccion.map((archivo, i) => (
                            <div key={i} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1">
                              <span className="truncate">{archivo.name}</span>
                              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setAdjuntosCorreccion((prev) => prev.filter((_, j) => j !== i))}>Quitar</Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button
                          onClick={handleApprove}
                          disabled={approveTask.isPending || approveDeadline.isPending || requestTaskCorrection.isPending || requestDeadlineCorrection.isPending}
                          className="gap-2 bg-green-600 hover:bg-green-700 text-white flex-1"
                        >
                          {(approveTask.isPending || approveDeadline.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                          Aprobar
                        </Button>
                        <Button
                          onClick={handleRequestCorrection}
                          disabled={!reviewNotesInput.trim() || approveTask.isPending || approveDeadline.isPending || requestTaskCorrection.isPending || requestDeadlineCorrection.isPending}
                          variant="outline"
                          className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50 flex-1"
                          title={!reviewNotesInput.trim() ? "Escriba qué debe corregirse" : ""}
                        >
                          {(requestTaskCorrection.isPending || requestDeadlineCorrection.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          Corregir
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {history && history.length > 0 && (
                  <div className="border-t pt-3">
                    <h4 className="font-medium mb-2 flex items-center gap-2 text-sm">
                      <History className="h-4 w-4" /> Historial
                    </h4>
                    <div className="space-y-2">
                      {history.map((h: any) => (
                        <div key={h.id} className="flex items-start gap-2 text-xs">
                          <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${historyDot[h.eventType] || "bg-gray-400"}`} />
                          <div>
                            <span className="font-medium">{historyLabels[h.eventType] || h.eventType}</span>
                            <span className="text-muted-foreground"> — {new Date(h.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}{h.userName ? ` por ${h.userName}` : ""}</span>
                            {h.notes && <p className="text-muted-foreground mt-0.5">{h.notes}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border-t pt-3">
                  <CommentsSection entityType={selectedItem.itemType} entityId={selectedItem.id} />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

const NOMBRE_SUBRENTA_REVISION: Record<string, string> = {
  trabajo: "Trabajo (relación laboral)", trabajo_honorarios: "Trabajo por honorarios",
  capital: "Capital", no_laboral: "No laborales",
};

/** Fila de una renta ya terminada — el nombre/click abre (o descarga) la
 * declaración final subida con el sello de recibido, y aparte hay un
 * botón para reabrirla si hace falta corregir algo. */
function RentaTerminadaRow({ cliente, onReabrir, reabriendo }: { cliente: any; onReabrir: () => void; reabriendo: boolean }) {
  const urlQuery = trpc.renta.reportes.getDownloadUrl.useQuery(
    { fileKey: cliente.declaracionFileKey || "" }, { enabled: false },
  );
  const handleVerDeclaracion = async () => {
    if (!cliente.declaracionFileKey) {
      toast.error("Este cliente no tiene la declaración final subida todavía.");
      return;
    }
    const result = await urlQuery.refetch();
    if (result.data?.signedUrl) window.open(result.data.signedUrl, "_blank");
  };
  return (
    <div className="flex items-center justify-between border rounded-md p-3 gap-2">
      <button className="flex items-center gap-2 text-left flex-1 min-w-0 hover:underline" onClick={handleVerDeclaracion}>
        <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium truncate">Renta de {cliente.nombre} — año gravable {cliente.anioGravable}</span>
      </button>
      <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={onReabrir} disabled={reabriendo}>
        {reabriendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reabrir
      </Button>
    </div>
  );
}

/** Diálogo que se abre al hacer clic sobre una renta pendiente de
 * revisión — muestra el mismo Resumen Declaración Renta 2025 que se ve en
 * Liquidación (patrimonio, cada cédula con su detalle, retenciones y
 * anticipo), para aprobar o rechazar sin tener que salir de esta pantalla. */
function RentaResumenDialog({ cliente, onClose, onAprobar, onRechazar, aprobando, rechazando }: {
  cliente: any | null; onClose: () => void; onAprobar: () => void; onRechazar: (comentario: string) => void;
  aprobando: boolean; rechazando: boolean;
}) {
  const resumenQuery = trpc.renta.reportes.resumenActual.useQuery(
    { rentaClienteId: cliente?.id }, { enabled: !!cliente },
  );
  const itemsQuery = trpc.renta.liquidacion.list.useQuery(
    { rentaClienteId: cliente?.id, seccion: "cedula" }, { enabled: !!cliente },
  );
  const validacionQuery = trpc.renta.reportes.validarRenta.useQuery(
    { rentaClienteId: cliente?.id }, { enabled: !!cliente },
  );
  const fmt = (n: number | null | undefined) => n == null ? "—" : `$${n.toLocaleString("es-CO")}`;
  const r = resumenQuery.data;
  const items = itemsQuery.data || [];
  const hallazgos = validacionQuery.data?.hallazgos || [];
  const CEDULAS_ORDEN = ["trabajo", "trabajo_honorarios", "capital", "no_laboral"];

  return (
    <Dialog open={!!cliente} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden min-w-0">
        <DialogHeader>
          <DialogTitle>Resumen Declaración Renta 2025 — {cliente?.nombre} (año gravable {cliente?.anioGravable})</DialogTitle>
        </DialogHeader>
        {!r ? (
          <p className="text-sm text-muted-foreground py-4">
            {resumenQuery.isLoading ? "Cargando..." : "Sin información cargada todavía para este cliente."}
          </p>
        ) : (
          <div className="space-y-4 text-sm py-2">
            <div className="grid sm:grid-cols-3 gap-2">
              <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Activos</div><div className="font-semibold">{fmt(r.patrimonioBruto)}</div></div>
              <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Pasivos</div><div className="font-semibold">{fmt(r.deudas)}</div></div>
              <div className="border rounded-md p-2.5 bg-muted/40"><div className="text-xs text-muted-foreground">Patrimonio líquido</div><div className="font-semibold">{fmt(r.patrimonioLiquido)}</div></div>
            </div>

            {CEDULAS_ORDEN.filter(k => items.some((it: any) => (it.cedula || "trabajo") === k && it.tipoValor === "ingreso_bruto")).map((k) => {
              const deEstaCedula = items.filter((it: any) => (it.cedula || "trabajo") === k);
              const linea = (it: any, signo: 1 | -1, etiqueta?: string) => (
                <div key={it.id} className="flex items-center justify-between py-0.5">
                  <span className="text-muted-foreground">{it.concepto}{etiqueta && <span className="text-xs"> ({etiqueta})</span>}</span>
                  <span className={signo < 0 ? "text-red-600" : ""}>{signo < 0 ? "−" : ""}{fmt(it.valor)}</span>
                </div>
              );
              const lineaLimitada = (it: any, etiqueta: string) => {
                const limitado = it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor;
                const fueLimitado = limitado < it.valor;
                const esFueraLimite = ["dependiente_adicional_72uvt", "exceso_salario_militares", "compras_1pct_fe"].includes(it.tipoDeduccion);
                return (
                  <div key={it.id} className="flex items-center justify-between py-0.5 gap-2">
                    <span className="text-muted-foreground flex-1 min-w-0 truncate">
                      {it.concepto} <span className="text-xs">({etiqueta})</span>
                      {esFueraLimite && <span className="ml-1.5 text-[10px] text-indigo-700 bg-indigo-100 rounded px-1.5 py-0.5">fuera del 40%</span>}
                    </span>
                    {fueLimitado && <span className="text-[10px] text-amber-700 shrink-0">(digitado: {fmt(it.valor)})</span>}
                    <span className={`shrink-0 ${fueLimitado ? "font-semibold text-amber-700" : "text-red-600"}`}>−{fmt(limitado)}</span>
                  </div>
                );
              };
              const sr = r.subRentas[k];
              const ingresosDeEstaCedula = deEstaCedula.filter((it: any) => it.tipoValor === "ingreso_bruto");
              const totalIngresosCedula = ingresosDeEstaCedula.reduce((a: number, it: any) => a + it.valor, 0);
              const deduccionesRentasExentas = deEstaCedula.filter((it: any) => it.tipoValor === "deduccion" || it.tipoValor === "renta_exenta");
              const subtotalDentroLimite = deduccionesRentasExentas
                .filter((it: any) => !["dependiente_adicional_72uvt", "exceso_salario_militares", "compras_1pct_fe"].includes(it.tipoDeduccion))
                .reduce((a: number, it: any) => a + (it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor), 0);
              const subtotalFueraLimite = deduccionesRentasExentas
                .filter((it: any) => ["dependiente_adicional_72uvt", "exceso_salario_militares", "compras_1pct_fe"].includes(it.tipoDeduccion))
                .reduce((a: number, it: any) => a + (it.valorLimitado ?? it.valor), 0);
              return (
                <div key={k} className="border rounded-md p-3">
                  <p className="font-semibold text-sm mb-1.5">{NOMBRE_SUBRENTA_REVISION[k] || k}</p>
                  <div className="pl-1">
                    {ingresosDeEstaCedula.map((it: any) => linea(it, 1))}
                    {ingresosDeEstaCedula.length > 1 && (
                      <div className="flex items-center justify-between py-0.5 font-medium border-t"><span>Total ingresos</span><span>{fmt(totalIngresosCedula)}</span></div>
                    )}
                    {deEstaCedula.filter((it: any) => it.tipoValor === "ingreso_no_constitutivo").map((it: any) => linea(it, -1, "INCRNGO"))}
                    {deEstaCedula.filter((it: any) => it.tipoValor === "costo_deduccion_procedente").map((it: any) => linea(it, -1, "costo/deducción procedente"))}
                    {deEstaCedula.filter((it: any) => it.tipoValor === "deduccion").map((it: any) => lineaLimitada(it, "deducción"))}
                    {deEstaCedula.filter((it: any) => it.tipoValor === "renta_exenta").map((it: any) => lineaLimitada(it, "renta exenta"))}
                  </div>
                  {deduccionesRentasExentas.length > 0 && (
                    <div className="pl-1 pt-1 mt-1 border-t space-y-0.5 text-xs">
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal dentro del límite del 40%</span><span>{fmt(subtotalDentroLimite)}</span></div>
                      {subtotalFueraLimite > 0 && (
                        <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal fuera del límite del 40%</span><span>{fmt(subtotalFueraLimite)}</span></div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t mt-1.5 pt-1.5 font-bold">
                    <span>Total renta cédula</span>
                    <span>{fmt(sr?.rentaLiquidaOrdinaria)}</span>
                  </div>
                </div>
              );
            })}

            <div className="flex items-center justify-between border-t pt-2 font-semibold text-base">
              <span>Renta líquida gravable total</span><span>{fmt(r.rentaLiquidaGravableTotal)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold text-base">
              <span>Impuesto de renta ({(r.impuestoRenta.tarifaMarginal * 100).toFixed(0)}%)</span><span>{fmt(r.impuestoRenta.impuesto)}</span>
            </div>
            {r.totalDescuentosTributarios > 0 && (
              <>
                <div className="flex items-center justify-between text-red-600">
                  <span>(-) Descuentos tributarios</span><span>-{fmt(r.totalDescuentosTributarios)}</span>
                </div>
                <div className="flex items-center justify-between font-semibold text-base border-t pt-1.5">
                  <span>Impuesto neto de renta</span><span>{fmt(r.impuestoNetoDespuesDescuentos)}</span>
                </div>
              </>
            )}
            <div className="grid sm:grid-cols-3 gap-2 border-t pt-2">
              <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Retenciones</div><div className="font-semibold">{fmt(r.totalRetenciones)}</div></div>
              <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Anticipo Método 1</div><div className="font-semibold">{fmt(r.anticipoMetodo1)}</div></div>
              <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Anticipo Método 2</div><div className="font-semibold">{fmt(r.anticipoMetodo2)}</div></div>
            </div>

            {r.gananciaOcasional.totalIngresoBruto > 0 && (
              <div className="border rounded-md p-3">
                <p className="font-semibold text-sm mb-1.5">Ganancia Ocasional (tarifa aparte, no la tabla del Art. 241)</p>
                <div className="space-y-1">
                  {Object.entries(r.gananciaOcasional.porTipo).map(([tipo, v]: any) => (
                    <div key={tipo} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{tipo} ({(v.tarifa * 100).toFixed(0)}%)</span>
                      <span>Neto {fmt(v.netoGravable)} → Impuesto {fmt(v.impuesto)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t mt-1.5 pt-1.5 font-bold">
                  <span>Total impuesto ganancia ocasional</span>
                  <span>{fmt(r.gananciaOcasional.totalImpuesto)}</span>
                </div>
              </div>
            )}

            {r.comparacionPatrimonial && (
              <div className={`border rounded-md p-3 ${r.comparacionPatrimonial.excedente > 0 ? "border-amber-300 bg-amber-50/50" : ""}`}>
                <p className="font-semibold text-sm mb-1.5 flex items-center gap-1.5">
                  {r.comparacionPatrimonial.excedente > 0 && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                  Comparación patrimonial (Arts. 236-239 E.T.)
                </p>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Patrimonio líquido año anterior</span><span>{fmt(r.patrimonioLiquidoAnioAnterior)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Patrimonio líquido declarado (año actual)</span><span>{fmt(r.patrimonioLiquido)}</span></div>
                  <div className="flex items-center justify-between border-t pt-1"><span className="text-muted-foreground">Diferencia patrimonial (este año − año anterior)</span><span>{fmt(r.comparacionPatrimonial.diferenciaPatrimonial)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">+ Rentas exentas del año</span><span>{fmt(r.comparacionPatrimonial.totalRentasExentas)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">− Impuesto pagado durante el año (retenciones + anticipo)</span><span>{fmt(r.comparacionPatrimonial.impuestoPagadoDuranteElAnio)}</span></div>
                  <div className="flex items-center justify-between font-medium border-t pt-1"><span>Renta líquida ajustada</span><span>{fmt(r.comparacionPatrimonial.rentaLiquidaAjustada)}</span></div>
                </div>
                <div className={`flex items-center justify-between border-t mt-1.5 pt-1.5 font-bold ${r.comparacionPatrimonial.excedente > 0 ? "text-amber-700" : ""}`}>
                  <span>{r.comparacionPatrimonial.excedente > 0 ? "Incremento patrimonial sin justificar" : "Sin incremento sin justificar"}</span>
                  <span>{fmt(Math.max(0, r.comparacionPatrimonial.excedente))}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  No incluye ganancia ocasional (se liquida aparte). Si el excedente es mayor a 0, se considera
                  renta gravable adicional salvo que se demuestre causa justificativa.
                </p>
              </div>
            )}

            <div className="border-t pt-3">
              <p className="text-sm font-semibold mb-2">Validación actual</p>
              {hallazgos.length === 0 ? (
                <p className="text-sm text-green-700 flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4" /> Sin hallazgos con lo cargado hasta el momento.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {hallazgos.map((h: any, i: number) => (
                    <div key={i} className={`text-xs border rounded-md p-2 ${
                      h.severidad === "error" ? "bg-red-50 text-red-700 border-red-200"
                        : h.severidad === "advertencia" ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-blue-50 text-blue-700 border-blue-200"
                    }`}>
                      <span className="font-medium uppercase tracking-wide block">{h.categoria}</span>
                      {h.mensaje}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button variant="outline" className="gap-1.5 text-red-700 border-red-300" onClick={() => onRechazar("Revisar valores cargados")} disabled={rechazando}>
            <ThumbsDown className="h-3.5 w-3.5" /> Rechazar
          </Button>
          <Button className="gap-1.5 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={onAprobar} disabled={aprobando}>
            <ThumbsUp className="h-3.5 w-3.5" /> Aprobar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
