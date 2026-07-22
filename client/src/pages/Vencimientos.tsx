import DashboardLayout from "@/components/DashboardLayout";
import CommentsSection from "@/components/CommentsSection";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { bogotaTodayUTCMidnight } from "@/lib/dateUtils";
import { Calendar, Loader2, RefreshCw, Settings2, CheckCircle2, ChevronLeft, ChevronRight, List, CalendarDays, Pencil, Upload, FileText, FolderOpen, RotateCcw, X, MessageSquare } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En Progreso",
  completado: "Completado",
  vencido: "Vencido",
};

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-200",
  en_progreso: "bg-blue-100 text-blue-800 border-blue-200",
  completado: "bg-green-100 text-green-800 border-green-200",
  vencido: "bg-red-100 text-red-800 border-red-200",
};

const statusDotColors: Record<string, string> = {
  pendiente: "bg-yellow-500",
  en_progreso: "bg-blue-500",
  completado: "bg-green-500",
  vencido: "bg-red-500",
};

/** The stored status only ever becomes "vencido" if someone manually picks
 * it from the dropdown — nothing automatically flips it when a due date
 * passes. For DISPLAY purposes (badges, calendar dots), treat anything
 * still pendiente/en_progreso whose due date is in the past as overdue,
 * without touching what's actually saved. */
function getDisplayStatus(d: { status: string; dueDate: string | Date }): string {
  if (d.status !== "pendiente" && d.status !== "en_progreso") return d.status;
  const due = new Date(d.dueDate);
  const todayUTCMidnight = bogotaTodayUTCMidnight();
  return due.getTime() < todayUTCMidnight.getTime() ? "vencido" : d.status;
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const DAYS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday=0
  const daysInMonth = lastDay.getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

export default function Vencimientos() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: clients, isLoading: loadingClients } = trpc.clients.list.useQuery();
  const { data: obligations } = trpc.obligations.list.useQuery();
  const { data: upcomingDeadlines, isLoading: loadingUpcoming, refetch: refetchUpcoming } = trpc.deadlines.getUpcoming.useQuery({ daysAhead: 90 });

  const [selectedClient, setSelectedClient] = useState<string>("");
  const { data: clientDeadlines, refetch: refetchClientDeadlines } = trpc.deadlines.getByClient.useQuery(
    { clientId: parseInt(selectedClient) },
    { enabled: !!selectedClient }
  );
  const { data: clientObligations, refetch: refetchObligations } = trpc.obligations.getClientObligations.useQuery(
    { clientId: parseInt(selectedClient) },
    { enabled: !!selectedClient }
  );

  const setObligations = trpc.obligations.setClientObligations.useMutation();
  const generateDeadlines = trpc.deadlines.generate.useMutation();
  const updateStatus = trpc.deadlines.updateStatus.useMutation();
  const completeDeadline = trpc.deadlines.complete.useMutation();
  const reopenDeadline = trpc.deadlines.reopen.useMutation();
  const uploadDeadlineEvidence = trpc.deadlines.uploadEvidence.useMutation();
  const updateDueDate = trpc.deadlines.updateDueDate.useMutation();

  const [showEditDateDialog, setShowEditDateDialog] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState<any>(null);
  const [newDueDate, setNewDueDate] = useState("");

  const [showCompleteDeadlineDialog, setShowCompleteDeadlineDialog] = useState(false);
  const [completingDeadline, setCompletingDeadline] = useState<any>(null);
  const [commentingDeadline, setCommentingDeadline] = useState<any>(null);
  const [deadlineEvidenceFiles, setDeadlineEvidenceFiles] = useState<File[]>([]);
  const [selectedDeadlineSubfolder, setSelectedDeadlineSubfolder] = useState<string>("");
  const [newDeadlineSubfolderName, setNewDeadlineSubfolderName] = useState("");

  // Coming from a notification click ("/vencimientos?clientId=X&deadlineId=Y")
  // — select that client automatically so its deadlines load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get("clientId");
    if (clientId) setSelectedClient(clientId);
  }, []);

  // Once that client's deadlines have loaded, open the comments dialog for
  // the specific one the notification was about, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deadlineId = params.get("deadlineId");
    if (deadlineId && clientDeadlines) {
      const match = clientDeadlines.find((d: any) => String(d.id) === deadlineId);
      if (match) setCommentingDeadline(match);
      window.history.replaceState({}, "", "/vencimientos");
    }
  }, [clientDeadlines]);
  const { data: isDriveConfigured } = trpc.googleDrive.isConfigured.useQuery();
  const { data: rememberedDeadlineSubfolders } = trpc.clients.getDriveSubfolders.useQuery(
    { clientId: completingDeadline?.clientId as number },
    { enabled: !!completingDeadline?.clientId && !isDriveConfigured }
  );
  const { data: realDeadlineDriveSubfolders } = trpc.googleDrive.listSubfolders.useQuery(
    { clientId: completingDeadline?.clientId as number },
    { enabled: !!completingDeadline?.clientId && !!isDriveConfigured }
  );
  const deadlineDriveSubfolders = isDriveConfigured ? realDeadlineDriveSubfolders : rememberedDeadlineSubfolders;
  const deadlineEvidenceInputRef = useRef<HTMLInputElement>(null);

  const handleOpenCompleteDeadline = (deadline: any) => {
    setCompletingDeadline(deadline);
    setDeadlineEvidenceFiles([]);
    setShowCompleteDeadlineDialog(true);
  };

  const handleConfirmCompleteDeadline = async () => {
    if (!completingDeadline || deadlineEvidenceFiles.length === 0) return;
    try {
      const uploadedFiles = [];
      for (const file of deadlineEvidenceFiles) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const uploadResult = await uploadDeadlineEvidence.mutateAsync({
          fileName: file.name,
          fileBase64: base64,
          contentType: file.type,
        });
        uploadedFiles.push({ url: uploadResult.url, key: uploadResult.key, fileName: file.name, contentType: file.type, fileSize: file.size });
      }
      const isNewDeadlineSubfolder = selectedDeadlineSubfolder === "__new__";
      await completeDeadline.mutateAsync({
        id: completingDeadline.id,
        clientId: completingDeadline.clientId,
        evidenceFiles: uploadedFiles,
        driveSubfolder: isNewDeadlineSubfolder ? (newDeadlineSubfolderName || undefined) : (isDriveConfigured ? undefined : (selectedDeadlineSubfolder || undefined)),
        driveSubfolderId: isDriveConfigured && !isNewDeadlineSubfolder ? (selectedDeadlineSubfolder || undefined) : undefined,
      });
      toast.success(`Vencimiento completado con ${uploadedFiles.length} archivo(s) de evidencia`);
      setShowCompleteDeadlineDialog(false);
      setCompletingDeadline(null);
      setDeadlineEvidenceFiles([]);
      setSelectedDeadlineSubfolder("");
      setNewDeadlineSubfolderName("");
      refetchClientDeadlines();
      refetchUpcoming();
    } catch (error: any) {
      toast.error(error.message || "Error al completar el vencimiento");
    }
  };

  const handleOpenEditDate = (deadline: any) => {
    setEditingDeadline(deadline);
    setNewDueDate(new Date(deadline.dueDate).toISOString().slice(0, 10));
    setShowEditDateDialog(true);
  };

  const handleConfirmEditDate = async () => {
    if (!editingDeadline || !newDueDate) return;
    try {
      await updateDueDate.mutateAsync({ id: editingDeadline.id, dueDate: newDueDate });
      toast.success("Fecha de vencimiento actualizada correctamente");
      setShowEditDateDialog(false);
      setEditingDeadline(null);
      refetchClientDeadlines();
      refetchUpcoming();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar la fecha");
    }
  };

  const [showObligationsDialog, setShowObligationsDialog] = useState(false);
  const [selectedObligationIds, setSelectedObligationIds] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("calendar");
  const [calendarView, setCalendarView] = useState<"month" | "week">("month");
  const [weekStart, setWeekStart] = useState(() => {
    // Ancla la semana al día de HOY en Bogotá (no UTC) — de lo contrario,
    // después de las 7pm hora Colombia la vista semanal saltaba a la
    // semana siguiente un día antes de tiempo.
    const hoy = bogotaTodayUTCMidnight();
    const dayOfWeek = (hoy.getUTCDay() + 6) % 7; // Monday=0
    return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - dayOfWeek));
  });


  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + i)));
    }
    return days;
  }, [weekStart]);

  const deadlinesByWeekDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!upcomingDeadlines) return map;
    for (const d of upcomingDeadlines) {
      const date = new Date(d.dueDate);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    return map;
  }, [upcomingDeadlines]);

  const handlePrevWeek = () => {
    setWeekStart(prev => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate() - 7)));
  };

  const handleNextWeek = () => {
    setWeekStart(prev => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate() + 7)));
  };

  // Calendar state
  const today = new Date();
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth());
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [clientCalMonth, setClientCalMonth] = useState(today.getMonth());
  const [clientCalYear, setClientCalYear] = useState(today.getFullYear());

  const calendarDays = useMemo(() => getCalendarDays(calendarYear, calendarMonth), [calendarYear, calendarMonth]);

  // Map deadlines to calendar days
  const deadlinesByDay = useMemo(() => {
    const map: Record<number, any[]> = {};
    if (!upcomingDeadlines) return map;
    for (const d of upcomingDeadlines) {
      const date = new Date(d.dueDate);
      if (date.getUTCMonth() === calendarMonth && date.getUTCFullYear() === calendarYear) {
        const day = date.getUTCDate();
        if (!map[day]) map[day] = [];
        map[day].push(d);
      }
    }
    return map;
  }, [upcomingDeadlines, calendarMonth, calendarYear]);

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(calendarYear - 1);
    } else {
      setCalendarMonth(calendarMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(calendarYear + 1);
    } else {
      setCalendarMonth(calendarMonth + 1);
    }
  };

  const handleOpenObligations = () => {
    if (!selectedClient) {
      toast.error("Seleccione un cliente primero");
      return;
    }
    const currentIds = clientObligations?.map((o) => o.obligationId) || [];
    setSelectedObligationIds(currentIds);
    setShowObligationsDialog(true);
  };

  const handleSaveObligations = async () => {
    if (!selectedClient) return;
    try {
      await setObligations.mutateAsync({
        clientId: parseInt(selectedClient),
        obligationIds: selectedObligationIds,
      });
      toast.success("Obligaciones actualizadas");
      refetchObligations();
      setShowObligationsDialog(false);
    } catch {
      toast.error("Error al guardar las obligaciones");
    }
  };

  const handleGenerateDeadlines = async () => {
    if (!selectedClient) {
      toast.error("Seleccione un cliente primero");
      return;
    }
    try {
      const result = await generateDeadlines.mutateAsync({ clientId: parseInt(selectedClient), year: calendarYear });
      toast.success(result.message || `Se generaron ${result.count} vencimientos`);
      refetchClientDeadlines();
      refetchUpcoming();
    } catch (error: any) {
      toast.error(error.message || "Error al generar vencimientos");
    }
  };

  const handleStatusChange = async (id: number, status: "pendiente" | "en_progreso" | "vencido") => {
    try {
      await updateStatus.mutateAsync({ id, status });
      toast.success("Estado actualizado");
      refetchClientDeadlines();
      refetchUpcoming();
    } catch {
      toast.error("Error al actualizar estado");
    }
  };

  const handleReopenDeadline = async (id: number) => {
    try {
      await reopenDeadline.mutateAsync({ id });
      toast.success("Vencimiento reabierto");
      refetchClientDeadlines();
      refetchUpcoming();
    } catch {
      toast.error("Error al reabrir el vencimiento");
    }
  };

  const toggleObligation = (id: number) => {
    setSelectedObligationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vencimientos Tributarios</h1>
            <p className="text-muted-foreground mt-1">
              Calendario de obligaciones tributarias por cliente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "calendar" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("calendar")}
              className="gap-1"
            >
              <CalendarDays className="h-4 w-4" />
              Calendario
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="gap-1"
            >
              <List className="h-4 w-4" />
              Lista
            </Button>
          </div>
        </div>

        {/* Calendar View */}
        {viewMode === "calendar" && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={calendarView === "month" ? handlePrevMonth : handlePrevWeek}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg">
                    {calendarView === "month"
                      ? `${MONTHS_ES[calendarMonth]} ${calendarYear}`
                      : `${weekDays[0].toLocaleDateString("es-CO", { day: "numeric", month: "short" })} - ${weekDays[6].toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}`
                    }
                  </CardTitle>
                  <div className="flex border rounded-md overflow-hidden">
                    <button
                      onClick={() => setCalendarView("month")}
                      className={`px-2 py-1 text-xs font-medium transition-colors ${calendarView === "month" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    >
                      Mes
                    </button>
                    <button
                      onClick={() => setCalendarView("week")}
                      className={`px-2 py-1 text-xs font-medium transition-colors ${calendarView === "week" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    >
                      Semana
                    </button>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={calendarView === "month" ? handleNextMonth : handleNextWeek}>
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingUpcoming ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : calendarView === "month" ? (
                <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                  {/* Day headers */}
                  {DAYS_ES.map((day) => (
                    <div key={day} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">
                      {day}
                    </div>
                  ))}
                  {/* Calendar cells */}
                  {calendarDays.map((day, idx) => {
                    const isToday = day === today.getDate() && calendarMonth === today.getMonth() && calendarYear === today.getFullYear();
                    const dayDeadlines = day ? deadlinesByDay[day] || [] : [];
                    return (
                      <div
                        key={idx}
                        className={`bg-background min-h-[80px] p-1.5 relative ${
                          day ? "hover:bg-muted/50 transition-colors" : "bg-muted/20"
                        }`}
                      >
                        {day && (
                          <>
                            <span
                              className={`text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full ${
                                isToday
                                  ? "bg-primary text-primary-foreground"
                                  : "text-foreground"
                              }`}
                            >
                              {day}
                            </span>
                            {dayDeadlines.length > 0 && (
                              <div className="mt-0.5 space-y-0.5">
                                {dayDeadlines.slice(0, 3).map((d: any) => (
                                  <Tooltip key={d.id}>
                                    <TooltipTrigger asChild>
                                      <div className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate cursor-default ${statusColors[getDisplayStatus(d)]}`}>
                                        {d.obligationName?.substring(0, 12)}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p className="font-medium text-xs">{d.obligationName}</p>
                                      <p className="text-xs text-muted-foreground">{d.clientName}</p>
                                      <p className="text-xs">Período: {d.period}</p>
                                      <Badge variant="outline" className={`mt-1 text-xs ${statusColors[getDisplayStatus(d)]}`}>
                                        {statusLabels[getDisplayStatus(d)]}
                                      </Badge>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                                {dayDeadlines.length > 3 && (
                                  <span className="text-[9px] text-muted-foreground pl-1">
                                    +{dayDeadlines.length - 3} más
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {weekDays.map((day) => {
                    const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
                    const dayDeadlines = deadlinesByWeekDay[key] || [];
                    const isToday = key === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                    return (
                      <div
                        key={key}
                        className={`rounded-lg border p-2 min-h-[200px] ${
                          isToday ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="text-center mb-2">
                          <p className="text-xs text-muted-foreground">
                            {DAYS_ES[(day.getUTCDay() + 6) % 7]}
                          </p>
                          <p className={`text-sm font-semibold ${
                            isToday ? "text-primary" : "text-foreground"
                          }`}>
                            {day.getUTCDate()}
                          </p>
                        </div>
                        <div className="space-y-1">
                          {dayDeadlines.map((d: any) => (
                            <Tooltip key={d.id}>
                              <TooltipTrigger asChild>
                                <div className={`text-[10px] leading-tight px-1.5 py-1 rounded truncate cursor-default ${statusColors[getDisplayStatus(d)]}`}>
                                  {d.obligationName?.substring(0, 15)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="font-medium text-xs">{d.obligationName}</p>
                                <p className="text-xs text-muted-foreground">{d.clientName}</p>
                                <p className="text-xs">Per\u00edodo: {d.period}</p>
                                <Badge variant="outline" className={`mt-1 text-xs ${statusColors[getDisplayStatus(d)]}`}>
                                  {statusLabels[getDisplayStatus(d)]}
                                </Badge>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                          {dayDeadlines.length === 0 && (
                            <p className="text-[10px] text-muted-foreground text-center py-2">-</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 pt-3 border-t">
                <span className="text-xs text-muted-foreground">Estado:</span>
                {Object.entries(statusLabels).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${statusDotColors[key]}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* List View - Upcoming Deadlines */}
        {viewMode === "list" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Próximos Vencimientos (90 días)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingUpcoming ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : upcomingDeadlines && upcomingDeadlines.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Obligación</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead>Vencimiento</TableHead>
                        <TableHead>Días</TableHead>
                        <TableHead>Estado</TableHead>
                        {isAdmin && <TableHead className="text-right">Acción</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingDeadlines.map((d) => {
                        const dueDate = new Date(d.dueDate);
                        // Compare against the start of today en Bogotá
                        // (no UTC) — comparar contra el día calendario UTC
                        // hacía que el corte de "hoy" ocurriera a las 7pm
                        // hora Colombia en vez de a medianoche.
                        const todayUTCMidnight = bogotaTodayUTCMidnight();
                        const daysLeft = Math.round((dueDate.getTime() - todayUTCMidnight.getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.obligationName}</TableCell>
                            <TableCell className="text-sm">{d.clientName}</TableCell>
                            <TableCell className="text-sm">{d.period}</TableCell>
                            <TableCell className="text-sm">
                              {dueDate.toLocaleDateString("es-CO", { timeZone: "UTC" })}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  daysLeft < 0
                                    ? "bg-red-100 text-red-800 border-red-300"
                                    : daysLeft <= 5
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : daysLeft <= 15
                                    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                    : "bg-green-50 text-green-700 border-green-200"
                                }
                              >
                                {daysLeft < 0 ? `Vencido ${Math.abs(daysLeft)}d` : daysLeft === 0 ? "Hoy" : `${daysLeft} días`}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={statusColors[getDisplayStatus(d)]}>
                                {statusLabels[getDisplayStatus(d)]}
                              </Badge>
                            </TableCell>
                            {isAdmin && (
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Corregir fecha de vencimiento"
                                  onClick={() => handleOpenEditDate(d)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No hay vencimientos próximos</p>
                  <p className="text-xs mt-1">Seleccione un cliente y genere su calendario de vencimientos</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Client-specific management */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg">Gestión por Cliente</CardTitle>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleOpenObligations} disabled={!selectedClient} className="gap-1">
                    <Settings2 className="h-4 w-4" />
                    Obligaciones
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleGenerateDeadlines}
                    disabled={!selectedClient || generateDeadlines.isPending}
                    className="gap-1"
                  >
                    {generateDeadlines.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Generar Calendario
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-end gap-4">
              <div>
                <Label className="text-sm mb-2 block">Seleccionar Cliente</Label>
                <Select value={selectedClient} onValueChange={setSelectedClient}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Seleccionar cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map((client) => (
                      <SelectItem key={client.id} value={String(client.id)}>
                        {client.razonSocial} ({client.nit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedClient && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Ver mes:</Label>
                  <Select
                    value={String(clientCalMonth)}
                    onValueChange={(v) => setClientCalMonth(parseInt(v))}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS_ES.map((m, i) => (
                        <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(clientCalYear)}
                    onValueChange={(v) => setClientCalYear(parseInt(v))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2025, 2026, 2027, 2028].map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {selectedClient && clientDeadlines && clientDeadlines.length > 0 ? (
              <>
                {/* Mini calendar for client */}
                {(() => {
                  const clientDays = getCalendarDays(clientCalYear, clientCalMonth);
                  const clientDeadlinesByDay: Record<number, any[]> = {};
                  for (const d of clientDeadlines) {
                    const date = new Date(d.dueDate);
                    if (date.getUTCMonth() === clientCalMonth && date.getUTCFullYear() === clientCalYear) {
                      const day = date.getUTCDate();
                      if (!clientDeadlinesByDay[day]) clientDeadlinesByDay[day] = [];
                      clientDeadlinesByDay[day].push(d);
                    }
                  }
                  const hasDeadlinesThisMonth = Object.keys(clientDeadlinesByDay).length > 0;

                  return (
                    <div className="mb-4">
                      <p className="text-sm font-medium mb-2 text-muted-foreground">
                        Calendario - {MONTHS_ES[clientCalMonth]} {clientCalYear}
                      </p>
                      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                        {DAYS_ES.map((day) => (
                          <div key={day} className="bg-muted/50 p-1 text-center text-xs font-medium text-muted-foreground">
                            {day}
                          </div>
                        ))}
                        {clientDays.map((day, idx) => {
                          const deadlinesForDay = day ? clientDeadlinesByDay[day] || [] : [];
                          const isToday = day === today.getDate() && clientCalMonth === today.getMonth() && clientCalYear === today.getFullYear();
                          return (
                            <Tooltip key={idx}>
                              <TooltipTrigger asChild>
                                <div className={`bg-background p-1 min-h-[40px] text-center relative ${
                                  isToday ? "ring-2 ring-primary ring-inset" : ""
                                }`}>
                                  {day && (
                                    <>
                                      <span className="text-xs">{day}</span>
                                      {deadlinesForDay.length > 0 && (
                                        <div className="flex justify-center gap-0.5 mt-0.5">
                                          {deadlinesForDay.slice(0, 3).map((d: any, i: number) => (
                                            <div key={i} className={`w-1.5 h-1.5 rounded-full ${statusDotColors[getDisplayStatus(d)]}`} />
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              </TooltipTrigger>
                              {deadlinesForDay.length > 0 && (
                                <TooltipContent className="max-w-xs">
                                  {deadlinesForDay.map((d: any, i: number) => (
                                    <div key={i} className="text-xs">
                                      <span className="font-medium">{d.obligationName}</span>
                                      <span className="text-muted-foreground ml-1">({statusLabels[getDisplayStatus(d)]})</span>
                                    </div>
                                  ))}
                                </TooltipContent>
                              )}
                            </Tooltip>
                          );
                        })}
                      </div>
                      {!hasDeadlinesThisMonth && (
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          No hay vencimientos para este mes. Seleccione otro mes.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Table below calendar */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Obligación</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientDeadlines
                      .filter((d) => {
                        const date = new Date(d.dueDate);
                        return date.getUTCMonth() === clientCalMonth && date.getUTCFullYear() === clientCalYear;
                      })
                      .map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.obligationName}</TableCell>
                          <TableCell className="text-sm">{d.period}</TableCell>
                          <TableCell className="text-sm">
                            {new Date(d.dueDate).toLocaleDateString("es-CO", { timeZone: "UTC" })}
                          </TableCell>
                          <TableCell>
                            {d.status === "completado" ? (
                              <Badge variant="outline" className={statusColors[getDisplayStatus(d)]}>
                                {statusLabels[getDisplayStatus(d)]}
                              </Badge>
                            ) : (
                              <Select value={d.status} onValueChange={(v) => handleStatusChange(d.id, v as any)}>
                                <SelectTrigger className="h-7 w-[130px]">
                                  <Badge variant="outline" className={statusColors[getDisplayStatus(d)]}>
                                    {statusLabels[getDisplayStatus(d)]}
                                  </Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pendiente">Pendiente</SelectItem>
                                  <SelectItem value="en_progreso">En Progreso</SelectItem>
                                  <SelectItem value="vencido">Vencido</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={() => setCommentingDeadline(d)}
                                title="Comentarios"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </Button>
                              {d.status !== "completado" && d.reviewStatus === "correccion" && (
                                <Badge
                                  variant="outline"
                                  className="bg-orange-50 text-orange-700 border-orange-200"
                                  title={`Devuelto para corrección el ${d.reviewedAt ? new Date(d.reviewedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : ""}${d.reviewedByName ? ` por ${d.reviewedByName}` : ""}`}
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" /> Corregir: {d.reviewNotes}
                                </Badge>
                              )}
                              {d.status !== "completado" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1"
                                  onClick={() => handleOpenCompleteDeadline(d)}
                                >
                                  <Upload className="h-3 w-3" />
                                  Completar
                                </Button>
                              )}
                              {d.status === "completado" && d.evidenceFileUrl && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-700"
                                  asChild
                                  title={`Completado el ${new Date(d.completedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}${d.completedByName ? ` por ${d.completedByName}` : ""}${d.driveSubfolder ? ` — Subcarpeta: ${d.driveSubfolder}` : ""}`}
                                >
                                  <a href={d.evidenceFileUrl} target="_blank" rel="noopener noreferrer">
                                    <FileText className="w-3.5 h-3.5 mr-1" /> Ver evidencia
                                  </a>
                                </Button>
                              )}
                              {d.status === "completado" && d.reviewedAt && (
                                <Badge
                                  variant="outline"
                                  className="bg-blue-50 text-blue-700 border-blue-200"
                                  title={`Aprobado el ${new Date(d.reviewedAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}${d.reviewedByName ? ` por ${d.reviewedByName}` : ""}${d.reviewNotes ? ` — ${d.reviewNotes}` : ""}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Aprobado
                                </Badge>
                              )}
                              {d.status === "completado" && isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-orange-600"
                                  onClick={() => handleReopenDeadline(d.id)}
                                  title="Reabrir vencimiento"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reabrir
                                </Button>
                              )}
                              {isAdmin && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Corregir fecha de vencimiento"
                                  onClick={() => handleOpenEditDate(d)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {clientDeadlines.filter((d) => {
                  const date = new Date(d.dueDate);
                  return date.getUTCMonth() === clientCalMonth && date.getUTCFullYear() === clientCalYear;
                }).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    No hay vencimientos para {MONTHS_ES[clientCalMonth]} {clientCalYear}. Pruebe con otro mes.
                  </p>
                )}
              </>
            ) : selectedClient ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No hay vencimientos generados para este cliente</p>
                <p className="text-xs mt-1">Configure las obligaciones y genere el calendario</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Obligations Dialog */}
        <Dialog open={showObligationsDialog} onOpenChange={setShowObligationsDialog}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Obligaciones Tributarias del Cliente
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground mb-4">
                Seleccione las obligaciones tributarias que aplican a este cliente:
              </p>
              {obligations?.map((obligation) => (
                <div
                  key={obligation.id}
                  className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={`obl-${obligation.id}`}
                    checked={selectedObligationIds.includes(obligation.id)}
                    onCheckedChange={() => toggleObligation(obligation.id)}
                  />
                  <div className="flex-1">
                    <label htmlFor={`obl-${obligation.id}`} className="text-sm font-medium cursor-pointer">
                      {obligation.name}
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {obligation.description}
                    </p>
                    <Badge variant="outline" className="mt-1 text-xs">
                      {obligation.frequency}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowObligationsDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveObligations} disabled={setObligations.isPending}>
                {setObligations.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Guardar Obligaciones
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Complete deadline with evidence dialog */}
        <Dialog open={showCompleteDeadlineDialog} onOpenChange={(open) => { setShowCompleteDeadlineDialog(open); if (!open) { setCompletingDeadline(null); setDeadlineEvidenceFiles([]); setSelectedDeadlineSubfolder(""); setNewDeadlineSubfolderName(""); } }}>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Completar Vencimiento</DialogTitle>
            </DialogHeader>
            {completingDeadline && (
              <div className="space-y-4 py-2">
                <div className="text-sm text-muted-foreground">
                  <p><span className="font-medium text-foreground">{completingDeadline.obligationName}</span></p>
                  <p>Período {completingDeadline.period}</p>
                </div>
                {completingDeadline.clientDriveFolderUrl && (
                  <a
                    href={completingDeadline.clientDriveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-[#EDA011] hover:underline bg-[#FFF8E2] border border-[#EDA011]/30 rounded-md px-3 py-2"
                  >
                    <FolderOpen className="h-4 w-4 flex-shrink-0" />
                    Abrir carpeta de Drive del cliente
                  </a>
                )}
                {completingDeadline.clientDriveFolderUrl && (
                  <div className="space-y-2">
                    <Label>¿En qué subcarpeta quedó guardado el soporte?</Label>
                    <Select
                      value={selectedDeadlineSubfolder}
                      onValueChange={(v) => { setSelectedDeadlineSubfolder(v); if (v !== "__new__") setNewDeadlineSubfolderName(""); }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccione o cree una subcarpeta" />
                      </SelectTrigger>
                      <SelectContent>
                        {deadlineDriveSubfolders?.map((f: any) => (
                          <SelectItem key={f.id} value={isDriveConfigured ? f.id : f.name}>{f.path || f.name}</SelectItem>
                        ))}
                        <SelectItem value="__new__">+ Nueva subcarpeta...</SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedDeadlineSubfolder === "__new__" && (
                      <Input
                        value={newDeadlineSubfolderName}
                        onChange={(e) => setNewDeadlineSubfolderName(e.target.value)}
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
                  <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-[#EDA011] transition-colors" onClick={() => deadlineEvidenceInputRef.current?.click()}>
                    <input
                      ref={deadlineEvidenceInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                      onChange={(e) => setDeadlineEvidenceFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
                    />
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Haga clic para seleccionar uno o varios archivos</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, Imágenes</p>
                  </div>
                  {deadlineEvidenceFiles.length > 0 && (
                    <div className="space-y-1">
                      {deadlineEvidenceFiles.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1 w-full min-w-0">
                          <FileText className="h-4 w-4 text-[#EDA011] shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-sm" title={f.name}>{f.name}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setDeadlineEvidenceFiles(prev => prev.filter((_, i) => i !== idx))}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCompleteDeadlineDialog(false)}>Cancelar</Button>
              <Button
                onClick={handleConfirmCompleteDeadline}
                disabled={deadlineEvidenceFiles.length === 0 || completeDeadline.isPending || uploadDeadlineEvidence.isPending}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {(completeDeadline.isPending || uploadDeadlineEvidence.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Completar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit deadline due date dialog (admin only) */}
        <Dialog open={showEditDateDialog} onOpenChange={(open) => { setShowEditDateDialog(open); if (!open) setEditingDeadline(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Corregir Fecha de Vencimiento</DialogTitle>
            </DialogHeader>
            {editingDeadline && (
              <div className="space-y-4 py-2">
                <div className="text-sm text-muted-foreground">
                  <p><span className="font-medium text-foreground">{editingDeadline.obligationName}</span></p>
                  <p>{editingDeadline.clientName} — Período {editingDeadline.period}</p>
                </div>
                <div className="space-y-2">
                  <Label>Nueva fecha de vencimiento</Label>
                  <Input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use esto cuando detecte que una fecha quedó mal calculada o mal importada del calendario DIAN.
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditDateDialog(false)}>Cancelar</Button>
              <Button
                onClick={handleConfirmEditDate}
                disabled={updateDueDate.isPending || !newDueDate}
                className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
              >
                {updateDueDate.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Comments dialog */}
        <Dialog open={!!commentingDeadline} onOpenChange={(open) => { if (!open) setCommentingDeadline(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Comentarios</DialogTitle>
              {commentingDeadline && (
                <p className="text-sm text-muted-foreground">
                  {commentingDeadline.obligationName} — {commentingDeadline.period}
                </p>
              )}
            </DialogHeader>
            {commentingDeadline && (
              <CommentsSection entityType="deadline" entityId={commentingDeadline.id} />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
