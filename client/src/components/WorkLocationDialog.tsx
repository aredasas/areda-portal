import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin, Building2, Home, CalendarOff } from "lucide-react";

type SlotType = "in_house" | "client" | "libre";
type Slot = { type: SlotType; clientId?: number };

const blockHours: Record<"morning" | "afternoon", string[]> = {
  morning: ["8:00 - 9:00", "9:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00"],
  afternoon: ["2:00 - 3:00", "3:00 - 4:00", "4:00 - 5:00", "5:00 - 6:00"],
};

/** Shown right after marking "inicio" or "regreso_almuerzo" — lets the
 * collaborator say, hour by hour, whether they'll be in-house, at a
 * specific assigned client, or on leave for that 4-hour block. */
export default function WorkLocationDialog({
  open,
  block,
  date,
  onDone,
}: {
  open: boolean;
  block: "morning" | "afternoon";
  date: string;
  onDone: () => void;
}) {
  const { data: myClients } = trpc.clients.list.useQuery(undefined, { enabled: open });
  const saveLocation = trpc.timeTracking.saveLocation.useMutation();

  const [slots, setSlots] = useState<Slot[]>([
    { type: "in_house" },
    { type: "in_house" },
    { type: "in_house" },
    { type: "in_house" },
  ]);

  const updateSlot = (idx: number, value: string) => {
    setSlots(prev => {
      const next = [...prev];
      if (value === "in_house" || value === "libre") {
        next[idx] = { type: value };
      } else {
        next[idx] = { type: "client", clientId: parseInt(value) };
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    try {
      await saveLocation.mutateAsync({ date, block, slots });
      toast.success("Ubicación de la jornada guardada");
      onDone();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar la ubicación");
    }
  };

  const hours = blockHours[block];
  const blockLabel = block === "morning" ? "la mañana" : "la tarde";

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-[#EDA011]" /> ¿Dónde vas a trabajar?
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Indica hora por hora dónde vas a estar durante {blockLabel}. Puedes combinar oficina, clientes, o marcar libre si tienes permiso.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {hours.map((label, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <span className="text-sm font-medium w-28 shrink-0">{label}</span>
              <Select
                value={slots[idx].type === "client" ? String(slots[idx].clientId) : slots[idx].type}
                onValueChange={(v) => updateSlot(idx, v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_house">
                    <span className="flex items-center gap-2"><Home className="h-3.5 w-3.5" /> In House</span>
                  </SelectItem>
                  <SelectItem value="libre">
                    <span className="flex items-center gap-2"><CalendarOff className="h-3.5 w-3.5" /> Libre (permiso)</span>
                  </SelectItem>
                  {myClients?.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" /> {c.razonSocial}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <Button
          onClick={handleConfirm}
          disabled={saveLocation.isPending}
          className="w-full bg-[#EDA011] hover:bg-[#d48f0f] text-white mt-2"
        >
          {saveLocation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
