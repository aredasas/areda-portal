import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  LogIn,
  LogOut,
  Coffee,
  ClipboardList,
  Calendar as CalendarIcon,
} from "lucide-react";

const typeLabels: Record<string, string> = {
  inicio: "Inicio",
  salida_almuerzo: "Salida almuerzo",
  regreso_almuerzo: "Regreso almuerzo",
  fin: "Fin",
};

const typeIcons: Record<string, any> = {
  inicio: LogIn,
  salida_almuerzo: Coffee,
  regreso_almuerzo: Coffee,
  fin: LogOut,
};

function formatHours(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

export default function Asistencia() {
  const { user } = useAuth();
  // Restricted to this one specific admin by explicit business request — not
  // every admin should see attendance/hours data about the team.
  const isAuthorized = user?.cedula === "5820262";

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  });
  const [collaboratorFilter, setCollaboratorFilter] = useState("all");

  const { data: collaborators } = trpc.collaborators.list.useQuery({ isActive: true });

  const dateObj = new Date(selectedDate.year, selectedDate.month, selectedDate.day);
  const startOfDay = new Date(dateObj); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(dateObj); endOfDay.setHours(23, 59, 59, 999);

  const { data: log, isLoading } = trpc.timeTracking.getLog.useQuery({
    startOfDay: startOfDay.toISOString(),
    endOfDay: endOfDay.toISOString(),
    userId: collaboratorFilter !== "all" ? parseInt(collaboratorFilter) : undefined,
  });

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate.year, selectedDate.month, selectedDate.day + delta);
    setSelectedDate({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() });
  };

  if (!isAuthorized) {
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

  // Group entries by collaborator
  const byUser: Record<number, { userName: string; entries: any[] }> = {};
  log?.entries?.forEach((e: any) => {
    if (!byUser[e.userId]) byUser[e.userId] = { userName: e.userName || "Sin nombre", entries: [] };
    byUser[e.userId].entries.push(e);
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E] flex items-center gap-2">
            <Clock className="h-6 w-6" />
            Asistencia
          </h1>
          <p className="text-muted-foreground mt-1">
            Marcaciones de jornada auto-reportadas por cada colaborador (reemplaza el registro biométrico presencial)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-2 py-1.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => changeDay(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[160px] text-center">
              {dateObj.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => changeDay(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Select value={collaboratorFilter} onValueChange={setCollaboratorFilter}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="Colaborador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los colaboradores</SelectItem>
              {collaborators?.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#EDA011]" />
          </div>
        ) : Object.keys(byUser).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Nadie ha marcado jornada este día</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(byUser).map(([userId, data]) => {
              const marksByType: Record<string, Date> = {};
              data.entries.forEach((e: any) => { marksByType[e.type] = new Date(e.timestamp); });

              let workedMs = 0;
              if (marksByType.inicio && marksByType.salida_almuerzo) {
                workedMs += marksByType.salida_almuerzo.getTime() - marksByType.inicio.getTime();
              }
              if (marksByType.regreso_almuerzo && marksByType.fin) {
                workedMs += marksByType.fin.getTime() - marksByType.regreso_almuerzo.getTime();
              }
              if (marksByType.inicio && !marksByType.salida_almuerzo && !marksByType.fin) {
                // Still working, no lunch marked yet — leave as 0 rather than guessing
              }

              const userTasks = log?.completedTasks?.filter((t: any) => t.completedById === parseInt(userId)) || [];
              const userDeadlines = log?.completedDeadlines?.filter((d: any) => d.completedById === parseInt(userId)) || [];

              return (
                <Card key={userId}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{data.userName}</span>
                      {workedMs > 0 && (
                        <Badge variant="outline" className="bg-[#FFF8E2] text-[#42302E] border-[#EDA011]/40">
                          {formatHours(workedMs)} trabajadas
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(["inicio", "salida_almuerzo", "regreso_almuerzo", "fin"] as const).map((type) => {
                        const mark = marksByType[type];
                        const Icon = typeIcons[type];
                        return (
                          <Badge
                            key={type}
                            variant="outline"
                            className={mark ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-400 border-gray-200"}
                          >
                            <Icon className="h-3 w-3 mr-1" />
                            {typeLabels[type]}: {mark ? mark.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </Badge>
                        );
                      })}
                    </div>

                    {(userTasks.length > 0 || userDeadlines.length > 0) && (
                      <div className="pt-2 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Completado este día:</p>
                        <div className="space-y-1">
                          {userTasks.map((t: any) => (
                            <div key={`t-${t.id}`} className="flex items-center gap-2 text-xs">
                              <ClipboardList className="h-3 w-3 text-blue-600 shrink-0" />
                              <span className="text-muted-foreground">{new Date(t.completedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                              <span className="truncate">{t.clientName || "Sin cliente"}: {t.title}</span>
                            </div>
                          ))}
                          {userDeadlines.map((d: any) => (
                            <div key={`d-${d.id}`} className="flex items-center gap-2 text-xs">
                              <CalendarIcon className="h-3 w-3 text-purple-600 shrink-0" />
                              <span className="text-muted-foreground">{new Date(d.completedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                              <span className="truncate">{d.clientName}: {d.obligationName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
