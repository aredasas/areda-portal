import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  TrendingUp,
  Users,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Flame,
  X,
} from "lucide-react";

const statusConfig: Record<string, { label: string; color: string; icon: any; borderColor: string }> = {
  pendiente: { label: "Pendientes", color: "bg-amber-50 text-amber-800", icon: Clock, borderColor: "border-l-[#EDA011]" },
  en_progreso: { label: "En Progreso", color: "bg-blue-50 text-blue-800", icon: TrendingUp, borderColor: "border-l-blue-500" },
  completada: { label: "Completadas", color: "bg-emerald-50 text-emerald-800", icon: CheckCircle2, borderColor: "border-l-emerald-500" },
  vencida: { label: "Vencidas", color: "bg-red-50 text-red-800", icon: AlertTriangle, borderColor: "border-l-red-500" },
};

const priorityColors: Record<string, string> = {
  baja: "bg-gray-100 text-gray-700",
  media: "bg-blue-50 text-blue-700",
  alta: "bg-amber-50 text-amber-800",
  urgente: "bg-red-100 text-red-700",
};

const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = lastDay.getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const now = new Date();
  const [monthDate, setMonthDate] = useState({ year: now.getFullYear(), month: now.getMonth() }); // month: 0-based
  const monthParam = `${monthDate.year}-${pad2(monthDate.month + 1)}`;

  const [clientFilter, setClientFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [obligationFilter, setObligationFilter] = useState<string>("all");

  const { data: clients } = trpc.clients.list.useQuery();
  const { data: collaborators } = trpc.collaborators.list.useQuery({ isActive: true });
  const { data: obligations } = trpc.obligations.list.useQuery();

  const { data: dashboard, isLoading } = trpc.dashboard.summary.useQuery({
    month: monthParam,
    clientId: clientFilter !== "all" ? parseInt(clientFilter) : undefined,
    assignedToId: assigneeFilter !== "all" ? parseInt(assigneeFilter) : undefined,
    obligationId: obligationFilter !== "all" ? parseInt(obligationFilter) : undefined,
  });

  const hasActiveFilters = clientFilter !== "all" || assigneeFilter !== "all" || obligationFilter !== "all";
  const clearFilters = () => {
    setClientFilter("all");
    setAssigneeFilter("all");
    setObligationFilter("all");
  };

  const changeMonth = (delta: number) => {
    setMonthDate(prev => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const calendarDays = useMemo(() => getCalendarDays(monthDate.year, monthDate.month), [monthDate]);
  const heatmapByDay = useMemo(() => {
    const map = new Map<number, { count: number; items: { clientName: string; title: string }[] }>();
    dashboard?.heatmap?.forEach((h: { date: string; count: number; items?: { clientName: string; title: string }[] }) => {
      const day = parseInt(h.date.split("-")[2]);
      map.set(day, { count: h.count, items: h.items || [] });
    });
    return map;
  }, [dashboard?.heatmap]);
  const maxHeat = useMemo(() => Math.max(1, ...Array.from(heatmapByDay.values()).map(v => v.count)), [heatmapByDay]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Bienvenido, {user?.name?.split(" ")[0] || "Usuario"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {isAdmin ? "Resumen de actividad del equipo contable" : "Resumen de sus clientes y tareas asignadas"}
            </p>
          </div>

          {/* Month navigator */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-2 py-1.5 self-start sm:self-auto">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => changeMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[130px] text-center">
              {monthNames[monthDate.month]} {monthDate.year}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => changeMonth(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
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

          {isAdmin && (
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
          )}

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

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Limpiar filtros
            </Button>
          )}
        </div>
        {assigneeFilter !== "all" && (
          <p className="text-xs text-muted-foreground -mt-4">
            Mostrando tareas asignadas a esta persona, y vencimientos tributarios de los clientes donde es la responsable.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(statusConfig).map(([key, config]) => {
                const Icon = config.icon;
                const count = dashboard?.taskStats?.[key as keyof typeof dashboard.taskStats] || 0;
                const itemsForStatus = dashboard?.tasksByStatus?.[key as keyof typeof dashboard.tasksByStatus] || [];
                const card = (
                  <Card key={key} className={`border-l-4 ${config.borderColor} ${count > 0 ? "cursor-pointer" : ""}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">{config.label}</p>
                          <p className="text-2xl font-bold">{count}</p>
                        </div>
                        <Icon className={`h-8 w-8 opacity-60`} />
                      </div>
                    </CardContent>
                  </Card>
                );
                if (count === 0) return card;
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>{card}</TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p className="font-medium text-xs mb-1">{config.label} — {count} en total</p>
                      <ul className="text-xs space-y-0.5">
                        {itemsForStatus.map((t: any) => (
                          <li key={t.id} className="truncate">
                            <span className="font-medium">{t.clientName || "Sin cliente"}</span>: {t.title}
                          </li>
                        ))}
                        {count > itemsForStatus.length && (
                          <li className="text-muted-foreground">y {count - itemsForStatus.length} más...</li>
                        )}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Heatmap */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Flame className="h-5 w-5 text-[#EDA011]" />
                    Mapa de Calor del Mes
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Días con más tareas y vencimientos tributarios</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground mb-1">
                    {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => <div key={d}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day, idx) => {
                      if (day === null) return <div key={idx} />;
                      const dayData = heatmapByDay.get(day);
                      const count = dayData?.count || 0;
                      const items = dayData?.items || [];
                      const intensity = count === 0 ? 0 : 0.18 + (count / maxHeat) * 0.82;
                      const isToday =
                        monthDate.year === now.getFullYear() &&
                        monthDate.month === now.getMonth() &&
                        day === now.getDate();
                      const cell = (
                        <div
                          className={`aspect-square rounded-md flex flex-col items-center justify-center text-xs ${isToday ? "ring-2 ring-[#42302E]" : ""} ${count > 0 ? "cursor-pointer" : ""}`}
                          style={{
                            backgroundColor: count > 0 ? `rgba(237, 160, 17, ${intensity})` : "rgba(0,0,0,0.03)",
                            color: intensity > 0.55 ? "#fff" : "#42302E",
                          }}
                        >
                          <span className="font-medium">{day}</span>
                          {count > 0 && <span className="text-[10px] leading-none">{count}</span>}
                        </div>
                      );
                      if (count === 0) return <div key={idx}>{cell}</div>;
                      return (
                        <Tooltip key={idx}>
                          <TooltipTrigger asChild>{cell}</TooltipTrigger>
                          <TooltipContent className="max-w-[260px]">
                            <p className="font-medium text-xs mb-1">
                              {day} de {monthNames[monthDate.month]} — {count} en total
                            </p>
                            <ul className="text-xs space-y-0.5">
                              {items.map((it, i) => (
                                <li key={i} className="truncate">
                                  <span className="font-medium">{it.clientName}</span>: {it.title}
                                </li>
                              ))}
                              {count > items.length && (
                                <li className="text-muted-foreground">
                                  y {count - items.length} más...
                                </li>
                              )}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Upcoming items this month */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    Vencimientos de {monthNames[monthDate.month]}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Vencimientos tributarios y tareas con fecha límite</p>
                </CardHeader>
                <CardContent>
                  {dashboard?.upcomingItems && dashboard.upcomingItems.length > 0 ? (
                    <div className="space-y-2 max-h-[340px] overflow-auto">
                      {dashboard.upcomingItems.map((item: any) => {
                        const itemDate = new Date(item.date);
                        const daysLeft = Math.ceil((itemDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={item.type === "deadline" ? "bg-purple-50 text-purple-700 border-purple-200 text-[10px]" : "bg-blue-50 text-blue-700 border-blue-200 text-[10px]"}>
                                  {item.type === "deadline" ? "Tributario" : "Tarea"}
                                </Badge>
                                <p className="text-sm font-medium truncate">{item.title}</p>
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <p className="text-xs text-muted-foreground">{itemDate.toLocaleDateString("es-CO", { day: "2-digit", month: "short", timeZone: "UTC" })}</p>
                              <Badge variant="outline" className={daysLeft <= 5 ? "bg-red-50 text-red-700 border-red-200" : daysLeft <= 10 ? "bg-yellow-50 text-yellow-700 border-yellow-200" : "bg-green-50 text-green-700 border-green-200"}>
                                {daysLeft <= 0 ? "Hoy" : `${daysLeft}d`}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Calendar className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No hay vencimientos ni tareas para este mes</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Tasks Grouped by Status */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                Tareas de {monthNames[monthDate.month]} por Estado
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {Object.entries(statusConfig).map(([statusKey, config]) => {
                  const Icon = config.icon;
                  const tasksForStatus = dashboard?.tasksByStatus?.[statusKey as keyof typeof dashboard.tasksByStatus] || [];
                  return (
                    <Card key={statusKey} className="flex flex-col">
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {config.label}
                          <Badge variant="secondary" className="ml-auto text-xs">
                            {dashboard?.taskStats?.[statusKey as keyof typeof dashboard.taskStats] || 0}
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 flex-1">
                        {tasksForStatus.length > 0 ? (
                          <div className="space-y-2">
                            {tasksForStatus.map((task: any) => (
                              <div key={task.id} className="p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors">
                                <p className="text-xs font-medium truncate">{task.title}</p>
                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[60%]">
                                    {task.clientName || "Sin cliente"}
                                  </span>
                                  {task.priority && (
                                    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${priorityColors[task.priority] || ""}`}>
                                      {task.priority}
                                    </Badge>
                                  )}
                                </div>
                                {task.assignedToName && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    → {task.assignedToName}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-4">
                            Sin tareas
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Workload by User — admin only (backend returns empty for non-admins anyway) */}
            {isAdmin && dashboard?.workload && dashboard.workload.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    Carga de Trabajo de {monthNames[monthDate.month]}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {dashboard.workload.map((member: any) => {
                      const total = Number(member.totalTasks) || 0;
                      const pending = Number(member.pendingTasks) || 0;
                      const inProgress = Number(member.inProgressTasks) || 0;
                      const completed = Number(member.completedTasks) || 0;
                      const activeWork = pending + inProgress;
                      return (
                        <div key={member.userId} className="p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">{member.userName || "Sin asignar"}</span>
                            <span className="text-xs text-muted-foreground">
                              {activeWork} activas / {total} total
                            </span>
                          </div>
                          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-muted">
                            {completed > 0 && (
                              <div className="bg-green-500 rounded-full" style={{ width: `${(completed / Math.max(total, 1)) * 100}%` }} />
                            )}
                            {inProgress > 0 && (
                              <div className="bg-blue-500 rounded-full" style={{ width: `${(inProgress / Math.max(total, 1)) * 100}%` }} />
                            )}
                            {pending > 0 && (
                              <div className="bg-yellow-500 rounded-full" style={{ width: `${(pending / Math.max(total, 1)) * 100}%` }} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
