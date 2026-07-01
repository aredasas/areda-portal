import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ClipboardList, Plus, Loader2, Calendar, Upload, CheckCircle2, RotateCcw, Paperclip, FileText, Eye } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En Progreso",
  completada: "Completada",
  vencida: "Vencida",
};

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-200",
  en_progreso: "bg-blue-100 text-blue-800 border-blue-200",
  completada: "bg-green-100 text-green-800 border-green-200",
  vencida: "bg-red-100 text-red-800 border-red-200",
};

const priorityLabels: Record<string, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

const priorityColors: Record<string, string> = {
  baja: "bg-gray-100 text-gray-700 border-gray-200",
  media: "bg-blue-50 text-blue-700 border-blue-200",
  alta: "bg-orange-100 text-orange-700 border-orange-200",
  urgente: "bg-red-100 text-red-700 border-red-200",
};

export default function Tareas() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: tasks, isLoading, refetch } = trpc.tasks.list.useQuery();
  const { data: clients } = trpc.clients.list.useQuery();
  const { data: users } = trpc.collaborators.getActive.useQuery();
  const createTask = trpc.tasks.create.useMutation();
  const updateTask = trpc.tasks.update.useMutation();
  const completeTask = trpc.tasks.complete.useMutation();
  const reopenTask = trpc.tasks.reopen.useMutation();
  const uploadAttachment = trpc.tasks.uploadAttachment.useMutation();
  const uploadEvidence = trpc.tasks.uploadEvidence.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("todas");
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailTask, setDetailTask] = useState<any>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const { data: taskAttachments, refetch: refetchAttachments } = trpc.tasks.getAttachments.useQuery(
    { taskId: detailTask?.id || 0 },
    { enabled: !!detailTask }
  );

  const [form, setForm] = useState({
    title: "",
    description: "",
    clientId: "",
    assignedToId: "",
    dueDate: "",
    priority: "media" as string,
  });

  const resetForm = () => {
    setForm({ title: "", description: "", clientId: "", assignedToId: "", dueDate: "", priority: "media" });
    setEditingTask(null);
  };

  const handleOpenNew = () => { resetForm(); setShowForm(true); };

  const handleEdit = (task: any) => {
    setEditingTask(task);
    setForm({
      title: task.title || "",
      description: task.description || "",
      clientId: String(task.clientId) || "",
      assignedToId: task.assignedToId ? String(task.assignedToId) : "",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : "",
      priority: task.priority || "media",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title || !form.clientId) {
      toast.error("Título y cliente son obligatorios");
      return;
    }
    try {
      if (editingTask) {
        await updateTask.mutateAsync({
          id: editingTask.id,
          title: form.title,
          description: form.description || undefined,
          assignedToId: form.assignedToId ? parseInt(form.assignedToId) : null,
          dueDate: form.dueDate || null,
          priority: form.priority as any,
        });
        toast.success("Tarea actualizada");
      } else {
        await createTask.mutateAsync({
          title: form.title,
          description: form.description || undefined,
          clientId: parseInt(form.clientId),
          assignedToId: form.assignedToId ? parseInt(form.assignedToId) : undefined,
          dueDate: form.dueDate || undefined,
          priority: form.priority as any,
        });
        toast.success("Tarea creada");
      }
      setShowForm(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar la tarea");
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    if (newStatus === "completada") {
      setCompletingTaskId(taskId);
      setShowCompleteDialog(true);
      return;
    }
    try {
      await updateTask.mutateAsync({ id: taskId, status: newStatus as any });
      toast.success("Estado actualizado");
      refetch();
    } catch {
      toast.error("Error al actualizar el estado");
    }
  };

  const handleCompleteConfirm = async () => {
    if (!completingTaskId) return;
    if (!evidenceFile) {
      toast.error("Debe adjuntar un archivo de evidencia para completar la tarea");
      return;
    }
    try {
      // Upload evidence file
      const reader = new FileReader();
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(evidenceFile);
      });

      const { url, key } = await uploadEvidence.mutateAsync({
        fileName: evidenceFile.name,
        fileBase64,
        contentType: evidenceFile.type,
      });

      await completeTask.mutateAsync({
        id: completingTaskId,
        evidenceFileUrl: url,
        evidenceFileKey: key,
        completionNotes: completionNotes || undefined,
      });
      toast.success("Tarea completada con evidencia");
      setShowCompleteDialog(false);
      setCompletingTaskId(null);
      setCompletionNotes("");
      setEvidenceFile(null);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al completar la tarea");
    }
  };

  const handleReopen = async (taskId: number) => {
    try {
      await reopenTask.mutateAsync({ id: taskId });
      toast.success("Tarea reabierta");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al reabrir la tarea");
    }
  };

  const handleViewDetail = (task: any) => {
    setDetailTask(task);
    setShowDetailDialog(true);
  };

  const handleUploadAttachment = async () => {
    if (!attachmentFile || !detailTask) return;
    try {
      const reader = new FileReader();
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(attachmentFile);
      });

      await uploadAttachment.mutateAsync({
        taskId: detailTask.id,
        fileName: attachmentFile.name,
        fileBase64,
        contentType: attachmentFile.type,
        fileSize: attachmentFile.size,
      });
      toast.success("Archivo adjuntado");
      setAttachmentFile(null);
      refetchAttachments();
    } catch (error: any) {
      toast.error(error.message || "Error al adjuntar archivo");
    }
  };

  const filteredTasks = tasks?.filter((t: any) => {
    if (activeTab === "todas") return true;
    return t.status === activeTab;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E]">Tareas</h1>
          <p className="text-muted-foreground mt-1">Gestión de tareas asignadas a colaboradores</p>
        </div>
        <Button onClick={handleOpenNew} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
          <Plus className="h-4 w-4" /> Nueva Tarea
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas ({tasks?.length || 0})</TabsTrigger>
          <TabsTrigger value="pendiente">Pendientes</TabsTrigger>
          <TabsTrigger value="en_progreso">En Progreso</TabsTrigger>
          <TabsTrigger value="completada">Completadas</TabsTrigger>
          <TabsTrigger value="vencida">Vencidas</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : filteredTasks && filteredTasks.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tarea</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Responsable</TableHead>
                      <TableHead>Fecha Límite</TableHead>
                      <TableHead>Prioridad</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTasks.map((task: any) => (
                      <TableRow key={task.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{task.title}</p>
                            {task.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{task.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{task.clientName || "-"}</TableCell>
                        <TableCell className="text-sm">{task.assignedToName || "Sin asignar"}</TableCell>
                        <TableCell className="text-sm">
                          {task.dueDate ? (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(task.dueDate).toLocaleDateString("es-CO")}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={priorityColors[task.priority]}>
                            {priorityLabels[task.priority]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {task.status === "completada" ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Completada
                            </Badge>
                          ) : (
                            <Select value={task.status} onValueChange={(v) => handleStatusChange(task.id, v)}>
                              <SelectTrigger className="h-7 w-[140px]">
                                <Badge variant="outline" className={statusColors[task.status]}>
                                  {statusLabels[task.status]}
                                </Badge>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pendiente">Pendiente</SelectItem>
                                <SelectItem value="en_progreso">En Progreso</SelectItem>
                                <SelectItem value="completada">Completada</SelectItem>
                                <SelectItem value="vencida">Vencida</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewDetail(task)} title="Ver detalle">
                              <Eye className="w-4 h-4" />
                            </Button>
                            {task.status !== "completada" && (
                              <Button variant="ghost" size="sm" onClick={() => handleEdit(task)}>Editar</Button>
                            )}
                            {task.status === "completada" && isAdmin && (
                              <Button variant="ghost" size="sm" className="text-orange-600" onClick={() => handleReopen(task.id)} title="Reabrir tarea">
                                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reabrir
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p>No hay tareas en esta categoría</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Task Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {editingTask ? "Editar Tarea" : "Nueva Tarea"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Descripción breve de la tarea" />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Detalles adicionales..." rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <Select value={form.clientId} onValueChange={(v) => setForm({ ...form, clientId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                  <SelectContent>
                    {clients?.map((client: any) => (
                      <SelectItem key={client.id} value={String(client.id)}>{client.razonSocial}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Responsable</Label>
                <Select value={form.assignedToId} onValueChange={(v) => setForm({ ...form, assignedToId: v })}>
                  <SelectTrigger><SelectValue placeholder="Asignar a..." /></SelectTrigger>
                  <SelectContent>
                    {users?.map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name || u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha Límite</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Prioridad</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baja">Baja</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createTask.isPending || updateTask.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
              {(createTask.isPending || updateTask.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingTask ? "Actualizar" : "Crear Tarea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Task Dialog (with evidence) */}
      <Dialog open={showCompleteDialog} onOpenChange={(open) => { if (!open) { setShowCompleteDialog(false); setEvidenceFile(null); setCompletionNotes(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Completar Tarea
            </DialogTitle>
            <DialogDescription>
              Para completar esta tarea debe adjuntar un archivo de evidencia que respalde su finalización.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Archivo de evidencia *</Label>
              <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-[#EDA011] transition-colors" onClick={() => evidenceInputRef.current?.click()}>
                <input ref={evidenceInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} />
                {evidenceFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="h-5 w-5 text-[#EDA011]" />
                    <span className="text-sm font-medium">{evidenceFile.name}</span>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Haga clic para seleccionar archivo</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, Imágenes</p>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notas de completación (opcional)</Label>
              <Textarea value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} placeholder="Observaciones sobre la finalización..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCompleteDialog(false); setEvidenceFile(null); setCompletionNotes(""); }}>Cancelar</Button>
            <Button onClick={handleCompleteConfirm} disabled={!evidenceFile || completeTask.isPending || uploadEvidence.isPending} className="bg-green-600 hover:bg-green-700 text-white">
              {(completeTask.isPending || uploadEvidence.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirmar Completación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Detail Dialog (view attachments, add attachments) */}
      <Dialog open={showDetailDialog} onOpenChange={(open) => { if (!open) { setShowDetailDialog(false); setDetailTask(null); setAttachmentFile(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Detalle de Tarea
            </DialogTitle>
          </DialogHeader>
          {detailTask && (
            <div className="space-y-4 py-2">
              <div>
                <h3 className="font-semibold text-lg">{detailTask.title}</h3>
                {detailTask.description && <p className="text-sm text-muted-foreground mt-1">{detailTask.description}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> {detailTask.clientName}</div>
                <div><span className="text-muted-foreground">Responsable:</span> {detailTask.assignedToName || "Sin asignar"}</div>
                <div><span className="text-muted-foreground">Estado:</span> <Badge variant="outline" className={statusColors[detailTask.status]}>{statusLabels[detailTask.status]}</Badge></div>
                <div><span className="text-muted-foreground">Prioridad:</span> <Badge variant="outline" className={priorityColors[detailTask.priority]}>{priorityLabels[detailTask.priority]}</Badge></div>
                {detailTask.dueDate && <div><span className="text-muted-foreground">Fecha límite:</span> {new Date(detailTask.dueDate).toLocaleDateString("es-CO")}</div>}
                {detailTask.completedAt && <div><span className="text-muted-foreground">Completada:</span> {new Date(detailTask.completedAt).toLocaleDateString("es-CO")}</div>}
              </div>

              {/* Evidence section */}
              {detailTask.evidenceFileUrl && (
                <Card className="bg-green-50 border-green-200">
                  <CardContent className="p-3">
                    <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" /> Evidencia adjunta
                    </p>
                    <a href={detailTask.evidenceFileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-[#EDA011] underline mt-1 block">
                      Ver archivo de evidencia
                    </a>
                    {detailTask.completionNotes && <p className="text-xs text-muted-foreground mt-1">Notas: {detailTask.completionNotes}</p>}
                  </CardContent>
                </Card>
              )}

              {/* Attachments section */}
              <div>
                <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                  <Paperclip className="h-4 w-4" /> Archivos Adjuntos
                </h4>
                {taskAttachments && taskAttachments.length > 0 ? (
                  <div className="space-y-1">
                    {taskAttachments.map((att: any) => (
                      <div key={att.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                        <span className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          {att.fileName}
                        </span>
                        <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[#EDA011] text-xs underline">Descargar</a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin archivos adjuntos</p>
                )}

                {/* Upload new attachment */}
                {detailTask.status !== "completada" && (
                  <div className="mt-3 flex gap-2 items-center">
                    <input ref={attachInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.csv,.txt" onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)} />
                    <Button variant="outline" size="sm" onClick={() => attachInputRef.current?.click()} className="gap-1">
                      <Upload className="h-3.5 w-3.5" /> {attachmentFile ? attachmentFile.name : "Seleccionar archivo"}
                    </Button>
                    {attachmentFile && (
                      <Button size="sm" onClick={handleUploadAttachment} disabled={uploadAttachment.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
                        {uploadAttachment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Adjuntar"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
