import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { Calendar, Loader2, RefreshCw, Settings2, CheckCircle2, ChevronLeft, ChevronRight, List, CalendarDays } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  completado: "Completado",
  vencido: "Vencido",
};

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-200",
  completado: "bg-green-100 text-green-800 border-green-200",
  vencido: "bg-red-100 text-red-800 border-red-200",
};

const statusDotColors: Record<string, string> = {
  pendiente: "bg-yellow-500",
  completado: "bg-green-500",
  vencido: "bg-red-500",
};

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

  const [showObligationsDialog, setShowObligationsDialog] = useState(false);
  const [selectedObligationIds, setSelectedObligationIds] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("calendar");
  const [calendarView, setCalendarView] = useState<"month" | "week">("month");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const dayOfWeek = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - dayOfWeek);
    d.setHours(0, 0, 0, 0);
    return d;
  });


  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const deadlinesByWeekDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!upcomingDeadlines) return map;
    for (const d of upcomingDeadlines) {
      const date = new Date(d.dueDate);
      const key = date.toISOString().split("T")[0];
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    return map;
  }, [upcomingDeadlines]);

  const handlePrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const handleNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
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
      if (date.getMonth() === calendarMonth && date.getFullYear() === calendarYear) {
        const day = date.getDate();
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
      toast.success(`Se generaron ${result.count} vencimientos`);
      refetchClientDeadlines();
      refetchUpcoming();
    } catch {
      toast.error("Error al generar vencimientos");
    }
  };

  const handleStatusChange = async (id: number, status: "pendiente" | "completado" | "vencido") => {
    try {
      await updateStatus.mutateAsync({ id, status });
      toast.success("Estado actualizado");
      refetchClientDeadlines();
      refetchUpcoming();
    } catch {
      toast.error("Error al actualizar estado");
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
                                      <div className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate cursor-default ${statusColors[d.status]}`}>
                                        {d.obligationName?.substring(0, 12)}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p className="font-medium text-xs">{d.obligationName}</p>
                                      <p className="text-xs text-muted-foreground">{d.clientName}</p>
                                      <p className="text-xs">Período: {d.period}</p>
                                      <Badge variant="outline" className={`mt-1 text-xs ${statusColors[d.status]}`}>
                                        {statusLabels[d.status]}
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
                    const key = day.toISOString().split("T")[0];
                    const dayDeadlines = deadlinesByWeekDay[key] || [];
                    const isToday = day.toDateString() === today.toDateString();
                    return (
                      <div
                        key={key}
                        className={`rounded-lg border p-2 min-h-[200px] ${
                          isToday ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="text-center mb-2">
                          <p className="text-xs text-muted-foreground">
                            {DAYS_ES[(day.getDay() + 6) % 7]}
                          </p>
                          <p className={`text-sm font-semibold ${
                            isToday ? "text-primary" : "text-foreground"
                          }`}>
                            {day.getDate()}
                          </p>
                        </div>
                        <div className="space-y-1">
                          {dayDeadlines.map((d: any) => (
                            <Tooltip key={d.id}>
                              <TooltipTrigger asChild>
                                <div className={`text-[10px] leading-tight px-1.5 py-1 rounded truncate cursor-default ${statusColors[d.status]}`}>
                                  {d.obligationName?.substring(0, 15)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="font-medium text-xs">{d.obligationName}</p>
                                <p className="text-xs text-muted-foreground">{d.clientName}</p>
                                <p className="text-xs">Per\u00edodo: {d.period}</p>
                                <Badge variant="outline" className={`mt-1 text-xs ${statusColors[d.status]}`}>
                                  {statusLabels[d.status]}
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingDeadlines.map((d) => {
                        const dueDate = new Date(d.dueDate);
                        const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.obligationName}</TableCell>
                            <TableCell className="text-sm">{d.clientName}</TableCell>
                            <TableCell className="text-sm">{d.period}</TableCell>
                            <TableCell className="text-sm">
                              {dueDate.toLocaleDateString("es-CO")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  daysLeft <= 5
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : daysLeft <= 15
                                    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                    : "bg-green-50 text-green-700 border-green-200"
                                }
                              >
                                {daysLeft <= 0 ? "Hoy" : `${daysLeft} días`}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={statusColors[d.status]}>
                                {statusLabels[d.status]}
                              </Badge>
                            </TableCell>
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
                    if (date.getMonth() === clientCalMonth && date.getFullYear() === clientCalYear) {
                      const day = date.getDate();
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
                                            <div key={i} className={`w-1.5 h-1.5 rounded-full ${statusDotColors[d.status]}`} />
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
                                      <span className="text-muted-foreground ml-1">({statusLabels[d.status]})</span>
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
                        return date.getMonth() === clientCalMonth && date.getFullYear() === clientCalYear;
                      })
                      .map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.obligationName}</TableCell>
                          <TableCell className="text-sm">{d.period}</TableCell>
                          <TableCell className="text-sm">
                            {new Date(d.dueDate).toLocaleDateString("es-CO")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusColors[d.status]}>
                              {statusLabels[d.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {d.status === "pendiente" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={() => handleStatusChange(d.id, "completado")}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Completar
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {clientDeadlines.filter((d) => {
                  const date = new Date(d.dueDate);
                  return date.getMonth() === clientCalMonth && date.getFullYear() === clientCalYear;
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
      </div>
    </DashboardLayout>
  );
}
