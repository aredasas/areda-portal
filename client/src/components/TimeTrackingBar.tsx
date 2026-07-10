import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Clock, Coffee, LogIn, LogOut, Loader2 } from "lucide-react";
import WorkLocationDialog from "./WorkLocationDialog";

type EntryType = "inicio" | "salida_almuerzo" | "regreso_almuerzo" | "fin";

const typeLabels: Record<EntryType, string> = {
  inicio: "Inicio de jornada",
  salida_almuerzo: "Salida a almuerzo",
  regreso_almuerzo: "Regreso de almuerzo",
  fin: "Fin de jornada",
};

/** Self-reported clock in/out bar — replaces the in-person biometric
 * register. The collaborator marks their own start of day, lunch out/in,
 * and end of day; nothing here is inferred or tracked automatically.
 * Marking "inicio" or "regreso_almuerzo" also asks where they'll be for
 * that 4-hour block (in house / a client / on leave), hour by hour. */
export default function TimeTrackingBar() {
  const [now] = useState(() => new Date());
  const startOfDay = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [now]);
  const endOfDay = useMemo(() => {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [now]);
  // Collaborator's own local calendar day, "YYYY-MM-DD" — used as the key
  // for their location plan, independent of server timezone.
  const todayDateKey = useMemo(() => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [now]);

  const { data: todayEntries, isLoading, refetch } = trpc.timeTracking.getToday.useQuery({ startOfDay, endOfDay });
  const mark = trpc.timeTracking.mark.useMutation();
  const [pendingMarkType, setPendingMarkType] = useState<EntryType | null>(null);

  const marksByType = useMemo(() => {
    const map = {} as Record<EntryType, Date>;
    todayEntries?.forEach((e: any) => {
      map[e.type as EntryType] = new Date(e.timestamp);
    });
    return map;
  }, [todayEntries]);

  // Sequential: each step requires the previous one, and can't repeat one already marked today.
  const nextExpected: EntryType | null = !marksByType.inicio
    ? "inicio"
    : !marksByType.salida_almuerzo
    ? "salida_almuerzo"
    : !marksByType.regreso_almuerzo
    ? "regreso_almuerzo"
    : !marksByType.fin
    ? "fin"
    : null;

  const doMark = async (type: EntryType) => {
    try {
      await mark.mutateAsync({ type });
      toast.success(`${typeLabels[type]} registrado a las ${new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}`);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al registrar la marcación");
    }
  };

  const handleMark = (type: EntryType) => {
    // These two start a 4-hour block — ask where the collaborator will be
    // before actually registering the mark.
    if (type === "inicio" || type === "regreso_almuerzo") {
      setPendingMarkType(type);
      return;
    }
    doMark(type);
  };

  const handleLocationSaved = async () => {
    if (pendingMarkType) {
      await doMark(pendingMarkType);
    }
    setPendingMarkType(null);
  };

  const icons: Record<EntryType, any> = {
    inicio: LogIn,
    salida_almuerzo: Coffee,
    regreso_almuerzo: Coffee,
    fin: LogOut,
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando jornada...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap px-3 py-1.5 bg-muted/40 rounded-lg border">
      <Clock className="h-4 w-4 text-[#EDA011] shrink-0" />
      {(["inicio", "salida_almuerzo", "regreso_almuerzo", "fin"] as EntryType[]).map((type) => {
        const marked = marksByType[type];
        const Icon = icons[type];
        if (marked) {
          return (
            <Badge key={type} variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[11px]">
              {typeLabels[type]}: {marked.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
            </Badge>
          );
        }
        const isNext = nextExpected === type;
        return (
          <Button
            key={type}
            size="sm"
            variant={isNext ? "default" : "outline"}
            disabled={!isNext || mark.isPending}
            onClick={() => handleMark(type)}
            className={isNext ? "h-7 text-xs gap-1 bg-[#EDA011] hover:bg-[#d48f0f] text-white" : "h-7 text-xs gap-1 opacity-50"}
          >
            {mark.isPending && isNext ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
            {typeLabels[type]}
          </Button>
        );
      })}

      {pendingMarkType && (
        <WorkLocationDialog
          open={true}
          block={pendingMarkType === "inicio" ? "morning" : "afternoon"}
          date={todayDateKey}
          onDone={handleLocationSaved}
        />
      )}
    </div>
  );
}
