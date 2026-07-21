import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  RotateCcw,
  History,
  Search,
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
        await requestTaskCorrection.mutateAsync({ id: selectedItem.id, reviewNotes: reviewNotesInput });
      } else {
        await requestDeadlineCorrection.mutateAsync({ id: selectedItem.id, reviewNotes: reviewNotesInput });
      }
      toast.success("Se envió de vuelta al encargado con la observación");
      setSelectedItem(null);
      setReviewNotesInput("");
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
                    onClick={() => { setSelectedItem(item); setReviewNotesInput(""); }}
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
      <Dialog open={!!selectedItem} onOpenChange={(open) => { if (!open) { setSelectedItem(null); setReviewNotesInput(""); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
              <div className="space-y-3 text-sm">
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
