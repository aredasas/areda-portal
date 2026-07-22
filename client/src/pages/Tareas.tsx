import DashboardLayout from "@/components/DashboardLayout";
import RecurringTasksDialog from "@/components/RecurringTasksDialog";
import CommentsSection from "@/components/CommentsSection";
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
import { getEffectivePriority, priorityLabels, priorityColors } from "@/lib/priority";
import { ClipboardList, Plus, Loader2, Calendar, Upload, CheckCircle2, RotateCcw, Paperclip, FileText, Eye, FolderOpen, XCircle, X, Repeat } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En Progreso",
  completada: "Completada",
  vencida: "Vencida",
  cancelada: "Cancelada",
};

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-200",
  en_progreso: "bg-blue-100 text-blue-800 border-blue-200",
  completada: "bg-green-100 text-green-800 border-green-200",
  vencida: "bg-red-100 text-red-800 border-red-200",
  cancelada: "bg-gray-200 text-gray-600 border-gray-300",
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
  const cancelTaskMutation = trpc.tasks.cancel.useMutation();
  const uploadAttachment = trpc.tasks.uploadAttachment.useMutation();
  const uploadEvidence = trpc.tasks.uploadEvidence.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [showRecurringDialog, setShowRecurringDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("todas");
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [selectedSubfolder, setSelectedSubfolder] = useState<string>("");
  const [newSubfolderName, setNewSubfolderName] = useState("");

  const completingTask = tasks?.find((t: any) => t.id === completingTaskId);
  const { data: isDriveConfigured } = trpc.googleDrive.isConfigured.useQuery();
  const { data: rememberedSubfolders } = trpc.clients.getDriveSubfolders.useQuery(
    { clientId: completingTask?.clientId as number },
    { enabled: !!completingTask?.clientId && !isDriveConfigured }
  );
  const { data: realDriveSubfolders, isLoading: isLoadingDriveSubfolders } = trpc.googleDrive.listSubfolders.useQuery(
    { clientId: completingTask?.clientId as number },
    { enabled: !!completingTask?.clientId && !!isDriveConfigured }
  );
  const driveSubfolders = isDriveConfigured ? realDriveSubfolders : rememberedSubfolders;
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [detailTask, setDetailTask] = useState<any>(null);

  // Coming from a notification click ("/tareas?taskId=X") — open that
  // task's detail automatically once the list has loaded.
  useEffect(() => {
    if (!tasks) return;
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    if (taskId) {
      const match = tasks.find((t: any) => String(t.id) === taskId);
      if (match) {
        setDetailTask(match);
        setShowDetailDialog(true);
      }
      // Clean the URL so refreshing the page doesn't keep reopening it.
      window.history.replaceState({}, "", "/tareas");
    }
  }, [tasks]);
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
    if (evidenceFiles.length === 0) {
      toast.error("Debe adjuntar al menos un archivo de evidencia para completar la tarea");
      return;
    }
    try {
      // Upload each evidence file
      const uploadedFiles = [];
      for (const file of evidenceFiles) {
        const reader = new FileReader();
        const fileBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const { url, key } = await uploadEvidence.mutateAsync({
          fileName: file.name,
          fileBase64,
          contentType: file.type,
        });
        uploadedFiles.push({ url, key, fileName: file.name, contentType: file.type, fileSize: file.size });
      }

      const isNewSubfolder = selectedSubfolder === "__new__";
      await completeTask.mutateAsync({
        id: completingTaskId,
        evidenceFiles: uploadedFiles,
        completionNotes: completionNotes || undefined,
        driveSubfolder: isNewSubfolder ? (newSubfolderName || undefined) : (isDriveConfigured ? undefined : (selectedSubfolder || undefined)),
        driveSubfolderId: isDriveConfigured && !isNewSubfolder ? (selectedSubfolder || undefined) : undefined,
      });
      toast.success(`Tarea completada con ${uploadedFiles.length} archivo(s) de evidencia`);
      setShowCompleteDialog(false);
      setCompletingTaskId(null);
      setCompletionNotes("");
      setEvidenceFiles([]);
      setSelectedSubfolder("");
      setNewSubfolderName("");
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

  const handleCancelTask = async (task: any) => {
    const hasEvidence = !!task.evidenceFileUrl;
    const confirmMsg = hasEvidence
      ? "Esta tarea ya tiene soporte adjunto, así que se conservará marcada como 'Cancelada' para el registro. ¿Continuar?"
      : "Esta tarea no tiene soporte adjunto, así que se eliminará por completo. ¿Continuar?";
    if (!window.confirm(confirmMsg)) return;
    try {
      const { result } = await cancelTaskMutation.mutateAsync({ id: task.id });
      toast.success(result === "deleted" ? "Tarea eliminada (no tenía soporte adjunto)" : "Tarea marcada como cancelada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al cancelar la tarea");
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

  const filteredTasks = tasks
    ?.filter((t: any) => {
      if (activeTab === "todas") return true;
      return t.status === activeTab;
    })
    // Approved tasks sink to the bottom — once reviewed, they're done business,
    // so unreviewed/active work stays easier to spot at a glance.
    .sort((a: any, b: any) => (a.reviewedAt ? 1 : 0) - (b.reviewedAt ? 1 : 0));

  return (
    <DashboardLayout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E]">Tareas</h1>
          <p className="text-muted-foreground mt-1">Gestión de tareas asignadas a colaboradores</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button onClick={() => setShowRecurringDialog(true)} variant="outline" className="gap-2">
              <Repeat className="h-4 w-4" /> Recurrentes
            </Button>
            <Button onClick={handleOpenNew} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
              <Plus className="h-4 w-4" /> Nueva Tarea
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas ({tasks?.length || 0})</TabsTrigger>
          <TabsTrigger value="pendiente">Pendientes ({tasks?.filter((t: any) => t.status === "pendiente").length || 0})</TabsTrigger>
          <TabsTrigger value="en_progreso">En Progreso ({tasks?.filter((t: any) => t.status === "en_progreso").length || 0})</TabsTrigger>
          <TabsTrigger value="completada">Completadas ({tasks?.filter((t: any) => t.status === "completada").length || 0})</TabsTrigger>
          <TabsTrigger value="vencida">Vencidas ({tasks?.filter((t: any) => t.status === "vencida").length || 0})</TabsTrigger>
          <TabsTrigger value="cancelada">Canceladas ({tasks?.filter((t: any) => t.status === "cancelada").length || 0})</TabsTrigger>
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
                              {new Date(task.dueDate).toLocaleDateString("es-CO", { timeZone: "UTC" })}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={priorityColors[getEffectivePriority(task.priority, task.dueDate, task.status)]}>
                            {priorityLabels[getEffectivePriority(task.priority, task.dueDate, task.status)]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {task.status === "completada" ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Completada
                            </Badge>
                          ) : isAdmin ? (
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
                          ) : (
                            <Badge variant="outline" className={statusColors[task.status]}>
                              {statusLabels[task.status]}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewDetail(task)} title="Ver detalle">
                              <Eye className="w-4 h-4" />
                            </Button>
                            {isAdmin && task.status !== "completada" && task.status !== "cancelada" && (
                              <Button variant="ghost" size="sm" onClick={() => handleEdit(task)}>Editar</Button>
                            )}
                            {task.status !== "completada" && task.reviewStatus === "correccion" && (
                              <Badge
                                variant="outline"
                                className="bg-orange-50 text-orange-700 border-orange-200"
                                title={`Devuelta para corrección${task.reviewedByName ? ` por ${task.reviewedByName}` : ""}`}
                              >
                                <RotateCcw className="w-3 h-3 mr-1" /> Corregir: {task.reviewNotes}
                              </Badge>
                            )}
                            {!isAdmin && task.status !== "completada" && task.status !== "cancelada" && task.assignedToId === user?.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-green-700"
                                onClick={() => { setCompletingTaskId(task.id); setShowCompleteDialog(true); }}
                              >
                                <Upload className="w-3.5 h-3.5 mr-1" /> Subir soporte
                              </Button>
                            )}
                            {task.status === "completada" && isAdmin && (
                              <Button variant="ghost" size="sm" className="text-orange-600" onClick={() => handleReopen(task.id)} title="Reabrir tarea">
                                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reabrir
                              </Button>
                            )}
                            {isAdmin && task.status !== "completada" && task.status !== "cancelada" && (
                              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => handleCancelTask(task)} title="Cancelar tarea">
                                <XCircle className="w-3.5 h-3.5 mr-1" /> Cancelar
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
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {editingTask ? "Editar Tarea" : "Nueva Tarea"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 min-w-0">
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
      <Dialog open={showCompleteDialog} onOpenChange={(open) => { if (!open) { setShowCompleteDialog(false); setEvidenceFiles([]); setCompletionNotes(""); setSelectedSubfolder(""); setNewSubfolderName(""); } }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Completar Tarea
            </DialogTitle>
            <DialogDescription>
              Para completar esta tarea debe adjuntar un archivo de evidencia que respalde su finalización.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {completingTask?.clientDriveFolderUrl && (
              <a
                href={completingTask.clientDriveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-[#EDA011] hover:underline bg-[#FFF8E2] border border-[#EDA011]/30 rounded-md px-3 py-2"
              >
                <FolderOpen className="h-4 w-4 flex-shrink-0" />
                Abrir carpeta de Drive de {completingTask.clientName}
              </a>
            )}
            {completingTask?.clientDriveFolderUrl && (
              <div className="space-y-2">
                <Label>¿En qué subcarpeta quedó guardado el soporte?</Label>
                <Select
                  value={selectedSubfolder}
                  onValueChange={(v) => { setSelectedSubfolder(v); if (v !== "__new__") setNewSubfolderName(""); }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione o cree una subcarpeta" />
                  </SelectTrigger>
                  <SelectContent>
                    {driveSubfolders?.map((f: any) => (
                      <SelectItem key={f.id} value={isDriveConfigured ? f.id : f.name}>{f.path || f.name}</SelectItem>
                    ))}
                    <SelectItem value="__new__">+ Nueva subcarpeta...</SelectItem>
                  </SelectContent>
                </Select>
                {selectedSubfolder === "__new__" && (
                  <Input
                    value={newSubfolderName}
                    onChange={(e) => setNewSubfolderName(e.target.value)}
                    placeholder="Ej: Enero 2026, Retención en la fuente..."
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {isDriveConfigured
                    ? "El archivo se subirá automáticamente a esta subcarpeta en Google Drive. Las subcarpetas nuevas se crean directamente dentro de la carpeta del cliente."
                    : "Esto es solo para llevar registro de en qué subcarpeta quedó guardado — recuerde subirlo usted mismo a esa subcarpeta dentro de Drive."}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Archivo(s) de evidencia *</Label>
              <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-[#EDA011] transition-colors" onClick={() => evidenceInputRef.current?.click()}>
                <input
                  ref={evidenceInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                  onChange={(e) => setEvidenceFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
                />
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Haga clic para seleccionar uno o varios archivos</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, Imágenes</p>
              </div>
              {evidenceFiles.length > 0 && (
                <div className="space-y-1">
                  {evidenceFiles.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1 w-full min-w-0">
                      <FileText className="h-4 w-4 text-[#EDA011] shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm" title={f.name}>{f.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setEvidenceFiles(prev => prev.filter((_, i) => i !== idx))}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Notas de completación (opcional)</Label>
              <Textarea value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} placeholder="Observaciones sobre la finalización..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCompleteDialog(false); setEvidenceFiles([]); setCompletionNotes(""); }}>Cancelar</Button>
            <Button onClick={handleCompleteConfirm} disabled={evidenceFiles.length === 0 || completeTask.isPending || uploadEvidence.isPending} className="bg-green-600 hover:bg-green-700 text-white">
              {(completeTask.isPending || uploadEvidence.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Completar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Detail Dialog (view attachments, add attachments) */}
      <Dialog open={showDetailDialog} onOpenChange={(open) => { if (!open) { setShowDetailDialog(false); setDetailTask(null); setAttachmentFile(null); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Detalle de Tarea
            </DialogTitle>
          </DialogHeader>
          {detailTask && (
            <div className="space-y-4 py-2 min-w-0">
              <div>
                <h3 className="font-semibold text-lg">{detailTask.title}</h3>
                {detailTask.description && <p className="text-sm text-muted-foreground mt-1">{detailTask.description}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> {detailTask.clientName}</div>
                <div><span className="text-muted-foreground">Responsable:</span> {detailTask.assignedToName || "Sin asignar"}</div>
                <div><span className="text-muted-foreground">Estado:</span> <Badge variant="outline" className={statusColors[detailTask.status]}>{statusLabels[detailTask.status]}</Badge></div>
                <div><span className="text-muted-foreground">Prioridad:</span> <Badge variant="outline" className={priorityColors[getEffectivePriority(detailTask.priority, detailTask.dueDate, detailTask.status)]}>{priorityLabels[getEffectivePriority(detailTask.priority, detailTask.dueDate, detailTask.status)]}</Badge></div>
                {detailTask.dueDate && <div><span className="text-muted-foreground">Fecha límite:</span> {new Date(detailTask.dueDate).toLocaleDateString("es-CO", { timeZone: "UTC" })}</div>}
                {detailTask.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completada:</span> {new Date(detailTask.completedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                    {detailTask.completedByName && <span className="text-muted-foreground"> — por {detailTask.completedByName}</span>}
                  </div>
                )}
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
                    {detailTask.driveSubfolder && (
                      <p className="text-xs text-muted-foreground mt-1">Subcarpeta de Drive: {detailTask.driveSubfolder}</p>
                    )}
                    {detailTask.completionNotes && <p className="text-xs text-muted-foreground mt-1">Notas: {detailTask.completionNotes}</p>}
                    {detailTask.completedAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Completada el {new Date(detailTask.completedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                        {detailTask.completedByName && ` por ${detailTask.completedByName}`}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Review/approval section — visible to the collaborator once an admin reviews it */}
              {detailTask.reviewedAt && (
                <Card className={detailTask.reviewStatus === "correccion" ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"}>
                  <CardContent className="p-3">
                    <p className={`text-sm font-medium flex items-center gap-2 ${detailTask.reviewStatus === "correccion" ? "text-orange-800" : "text-blue-800"}`}>
                      {detailTask.reviewStatus === "correccion" ? (
                        <><RotateCcw className="h-4 w-4" /> Devuelta para corrección</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4" /> Aprobado por el revisor</>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(detailTask.reviewedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                      {detailTask.reviewedByName && ` por ${detailTask.reviewedByName}`}
                    </p>
                    {detailTask.reviewNotes && (
                      <p className="text-sm mt-2">
                        <span className="text-muted-foreground">Instrucciones/observaciones: </span>
                        {detailTask.reviewNotes}
                      </p>
                    )}
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
                      <div key={att.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm w-full min-w-0">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate" title={att.fileName}>{att.fileName}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {new Date(att.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                            {att.uploadedByName && ` — ${att.uploadedByName}`}
                          </p>
                        </div>
                        <a href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[#EDA011] text-xs underline shrink-0">Descargar</a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin archivos adjuntos</p>
                )}

                {/* Upload new attachment — admin only; collaborators only attach
                    evidence when completing the task, via the Complete dialog */}
                {isAdmin && detailTask.status !== "completada" && (
                  <div className="mt-3 flex gap-2 items-center">
                    <input ref={attachInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.csv,.txt" onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)} />
                    <Button variant="outline" size="sm" onClick={() => attachInputRef.current?.click()} className="gap-1 min-w-0 max-w-[220px]">
                      <Upload className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{attachmentFile ? attachmentFile.name : "Seleccionar archivo"}</span>
                    </Button>
                    {attachmentFile && (
                      <Button size="sm" onClick={handleUploadAttachment} disabled={uploadAttachment.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white shrink-0">
                        {uploadAttachment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Adjuntar"}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t pt-3">
                <CommentsSection entityType="task" entityId={detailTask.id} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RecurringTasksDialog open={showRecurringDialog} onOpenChange={setShowRecurringDialog} />
    </div>
    </DashboardLayout>
  );
}
