import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  TrendingUp,
  Users,
  Loader2,
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

export default function Home() {
  const { user } = useAuth();
  const { data: dashboard, isLoading } = trpc.dashboard.summary.useQuery();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Bienvenido, {user?.name?.split(" ")[0] || "Usuario"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Resumen de actividad del equipo contable
          </p>
        </div>

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
                return (
                  <Card key={key} className={`border-l-4 ${config.borderColor}`}>
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
              })}
            </div>

            {/* Tasks Grouped by Status */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                Tareas Recientes por Estado
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
                              <div
                                key={task.id}
                                className="p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                              >
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Upcoming Deadlines + Tasks for next month */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    Próximo Mes
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Vencimientos tributarios y tareas con fecha límite</p>
                </CardHeader>
                <CardContent>
                  {(() => {
                    // Combine deadlines and upcoming tasks into a single sorted list
                    const items: { id: string; type: string; title: string; subtitle: string; date: Date }[] = [];
                    
                    // Add deadlines
                    dashboard?.upcomingDeadlines?.forEach((d: any) => {
                      items.push({
                        id: `d-${d.id}`,
                        type: "deadline",
                        title: d.obligationName,
                        subtitle: `${d.clientName} - ${d.period}`,
                        date: new Date(d.dueDate),
                      });
                    });

                    // Add tasks with due dates from tasksByStatus
                    const allTasks = [
                      ...(dashboard?.tasksByStatus?.pendiente || []),
                      ...(dashboard?.tasksByStatus?.en_progreso || []),
                    ];
                    allTasks.forEach((t: any) => {
                      if (t.dueDate) {
                        items.push({
                          id: `t-${t.id}`,
                          type: "task",
                          title: t.title,
                          subtitle: `${t.clientName || "Sin cliente"} → ${t.assignedToName || "Sin asignar"}`,
                          date: new Date(t.dueDate),
                        });
                      }
                    });

                    // Sort by date and take next 30 days
                    const now = new Date();
                    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                    const filtered = items
                      .filter(i => i.date >= now && i.date <= nextMonth)
                      .sort((a, b) => a.date.getTime() - b.date.getTime())
                      .slice(0, 10);

                    if (filtered.length === 0) {
                      return (
                        <div className="text-center py-8 text-muted-foreground">
                          <Calendar className="h-10 w-10 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">No hay vencimientos ni tareas para el próximo mes</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {filtered.map(item => {
                          const daysLeft = Math.ceil((item.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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
                                <p className="text-xs text-muted-foreground">{item.date.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}</p>
                                <Badge variant="outline" className={daysLeft <= 5 ? "bg-red-50 text-red-700 border-red-200" : daysLeft <= 10 ? "bg-yellow-50 text-yellow-700 border-yellow-200" : "bg-green-50 text-green-700 border-green-200"}>
                                  {daysLeft <= 0 ? "Hoy" : `${daysLeft}d`}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Workload by User */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    Carga de Trabajo
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dashboard?.workload && dashboard.workload.length > 0 ? (
                    <div className="space-y-3">
                      {dashboard.workload.map((member: any) => {
                        const total = Number(member.totalTasks) || 0;
                        const pending = Number(member.pendingTasks) || 0;
                        const inProgress = Number(member.inProgressTasks) || 0;
                        const completed = Number(member.completedTasks) || 0;
                        const activeWork = pending + inProgress;
                        return (
                          <div
                            key={member.userId}
                            className="p-3 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">
                                {member.userName || "Sin asignar"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {activeWork} activas / {total} total
                              </span>
                            </div>
                            <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-muted">
                              {completed > 0 && (
                                <div
                                  className="bg-green-500 rounded-full"
                                  style={{ width: `${(completed / Math.max(total, 1)) * 100}%` }}
                                />
                              )}
                              {inProgress > 0 && (
                                <div
                                  className="bg-blue-500 rounded-full"
                                  style={{ width: `${(inProgress / Math.max(total, 1)) * 100}%` }}
                                />
                              )}
                              {pending > 0 && (
                                <div
                                  className="bg-yellow-500 rounded-full"
                                  style={{ width: `${(pending / Math.max(total, 1)) * 100}%` }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">No hay datos de carga de trabajo</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
