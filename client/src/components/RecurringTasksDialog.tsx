import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Repeat, Plus, Trash2, Loader2, Sparkles } from "lucide-react";

const weekDays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function scheduleLabel(r: any) {
  if (r.recurrenceType === "semanal") return `Semanal — todos los ${weekDays[r.dayOfWeek ?? 5]}`;
  if (r.recurrenceType === "quincenal") return "Quincenal — día 15 y último día de cada mes";
  return `Mensual — día ${r.dayOfMonth ?? 1} de cada mes`;
}

export default function RecurringTasksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: recurrences, refetch } = trpc.taskRecurrences.list.useQuery(undefined, { enabled: open });
  const { data: clientsList } = trpc.clients.list.useQuery(undefined, { enabled: open });
  const { data: collaborators } = trpc.collaborators.list.useQuery({ isActive: true }, { enabled: open });

  const createRecurrence = trpc.taskRecurrences.create.useMutation();
  const setActive = trpc.taskRecurrences.setActive.useMutation();
  const deleteRecurrence = trpc.taskRecurrences.delete.useMutation();
  const generate = trpc.taskRecurrences.generate.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [priority, setPriority] = useState("media");
  const [recurrenceType, setRecurrenceType] = useState<"semanal" | "quincenal" | "mensual">("mensual");
  const [dayOfWeek, setDayOfWeek] = useState("5");
  const [dayOfMonth, setDayOfMonth] = useState("15");

  const resetForm = () => {
    setTitle(""); setDescription(""); setClientId(""); setAssignedToId("");
    setPriority("media"); setRecurrenceType("mensual"); setDayOfWeek("5"); setDayOfMonth("15");
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!title.trim() || !clientId) {
      toast.error("Completa el título y el cliente");
      return;
    }
    try {
      await createRecurrence.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        clientId: parseInt(clientId),
        assignedToId: assignedToId ? parseInt(assignedToId) : undefined,
        priority: priority as any,
        recurrenceType,
        dayOfWeek: recurrenceType === "semanal" ? parseInt(dayOfWeek) : undefined,
        dayOfMonth: recurrenceType === "mensual" ? parseInt(dayOfMonth) : undefined,
      });
      toast.success("Tarea recurrente creada");
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al crear la tarea recurrente");
    }
  };

  const handleToggleActive = async (r: any) => {
    try {
      await setActive.mutateAsync({ id: r.id, isActive: !r.isActive });
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar");
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("¿Eliminar esta tarea recurrente? Ya no se generarán más tareas a partir de esta regla — las que ya se crearon no se borran.")) return;
    try {
      await deleteRecurrence.mutateAsync({ id });
      toast.success("Eliminada");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar");
    }
  };

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync();
      toast.success(result.count > 0 ? `Se generaron ${result.count} tarea(s) nueva(s)` : "No había tareas pendientes por generar");
    } catch (error: any) {
      toast.error(error.message || "Error al generar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-[#EDA011]" /> Tareas Recurrentes
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Cada ciclo (semana, quincena o mes) se genera una tarea nueva e independiente — con su propia evidencia e historial.
          </p>
        </DialogHeader>

        <div className="flex gap-2">
          <Button onClick={() => setShowForm(!showForm)} variant="outline" className="gap-1">
            <Plus className="h-4 w-4" /> Nueva regla
          </Button>
          <Button onClick={handleGenerate} disabled={generate.isPending} className="gap-1 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generar tareas pendientes
          </Button>
        </div>

        {showForm && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div>
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Informe de cierre de mes" />
            </div>
            <div>
              <Label>Descripción (opcional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cliente</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seleccione un cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientsList?.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.razonSocial}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Encargado (opcional)</Label>
                <Select value={assignedToId} onValueChange={setAssignedToId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                  <SelectContent>
                    {collaborators?.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prioridad</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baja">Baja</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ciclo</Label>
                <Select value={recurrenceType} onValueChange={(v: any) => setRecurrenceType(v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="semanal">Semanal</SelectItem>
                    <SelectItem value="quincenal">Quincenal (día 15 y fin de mes)</SelectItem>
                    <SelectItem value="mensual">Mensual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {recurrenceType === "semanal" && (
              <div>
                <Label>Día de la semana</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {weekDays.map((d, i) => (
                      <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {recurrenceType === "mensual" && (
              <div>
                <Label>Día del mes</Label>
                <Input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={createRecurrence.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
                {createRecurrence.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {recurrences && recurrences.length > 0 ? (
            recurrences.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.clientName} {r.assignedToName ? `— ${r.assignedToName}` : ""}</p>
                  <Badge variant="outline" className="mt-1 text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                    {scheduleLabel(r)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <Switch checked={r.isActive} onCheckedChange={() => handleToggleActive(r)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">Sin tareas recurrentes todavía</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
