import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  UserSquare2, Construction, Plus, Loader2, Pencil, Trash2, CheckCircle2, Clock, Users, FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

export default function RentaPersonaNatural() {
  const now = new Date();
  // Año gravable que se está declarando (el año de la exógena consultada,
  // ej. 2025 se declara durante 2026) — no el año calendario actual.
  const [anioGravable, setAnioGravable] = useState(now.getFullYear() - 1);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold">Renta Persona Natural</h1>
          <p className="text-muted-foreground text-sm">
            Apoyo para la declaración de renta de persona natural — clientes y calendario propios de
            este módulo, separados de los clientes generales
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Año gravable:</span>
          <Select value={String(anioGravable)} onValueChange={(v) => setAnioGravable(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="clientes">
          <TabsList>
            <TabsTrigger value="clientes" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Listado Clientes Renta</TabsTrigger>
            <TabsTrigger value="liquidacion" className="gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> Liquidación</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes" className="mt-4">
            <ClientesRentaTab anioGravable={anioGravable} />
          </TabsContent>

          <TabsContent value="liquidacion" className="mt-4">
            <Card className="border-dashed">
              <CardContent className="py-14 flex flex-col items-center text-center gap-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <UserSquare2 className="w-5 h-5" />
                  <Construction className="w-4 h-4" />
                </div>
                <h3 className="font-medium">En construcción</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Elegir cliente, subir su información exógena y la declaración anterior, digitar
                  activos/pasivos/ingresos/deducciones/rentas exentas, y generar el borrador del
                  Formulario 210 con su anexo ejecutivo.
                </p>
                <Badge variant="outline" className="text-xs">Próxima entrega</Badge>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ClientesRentaTab({ anioGravable }: { anioGravable: number }) {
  const utils = trpc.useUtils();
  const clientesQuery = trpc.renta.clientes.list.useQuery({ anioGravable });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [nombre, setNombre] = useState("");
  const [cedula, setCedula] = useState("");

  const createMutation = trpc.renta.clientes.create.useMutation({
    onSuccess: () => { toast.success("Cliente de renta agregado"); utils.renta.clientes.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo agregar el cliente"),
  });
  const updateMutation = trpc.renta.clientes.update.useMutation({
    onSuccess: () => { utils.renta.clientes.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo actualizar"),
  });
  const deleteMutation = trpc.renta.clientes.delete.useMutation({
    onSuccess: () => { toast.success("Cliente eliminado"); utils.renta.clientes.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo eliminar"),
  });

  const resetForm = () => { setNombre(""); setCedula(""); setEditing(null); };
  const openNew = () => { resetForm(); setShowForm(true); };
  const openEdit = (c: any) => { setEditing(c); setNombre(c.nombre); setCedula(c.cedula); setShowForm(true); };

  const handleSave = () => {
    if (!nombre.trim() || !cedula.trim()) {
      toast.error("Nombre y cédula son obligatorios");
      return;
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, nombre, cedula });
    } else {
      createMutation.mutate({ nombre, cedula, anioGravable });
    }
    setShowForm(false);
    resetForm();
  };

  const handleToggleNoObligado = (c: any, checked: boolean) => {
    updateMutation.mutate({ id: c.id, noObligado: checked });
  };

  const handleDelete = (c: any) => {
    if (!window.confirm(`¿Eliminar a ${c.nombre} de la lista de renta ${anioGravable}?`)) return;
    deleteMutation.mutate({ id: c.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
          <Plus className="w-4 h-4" /> Agregar cliente
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {clientesQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !clientesQuery.data?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Sin clientes de renta para {anioGravable} todavía.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Cliente</th>
                  <th className="p-3 font-medium">Cédula</th>
                  <th className="p-3 font-medium">Vencimiento</th>
                  <th className="p-3 font-medium">Días restantes</th>
                  <th className="p-3 font-medium">Estado</th>
                  <th className="p-3 font-medium">No obligado</th>
                  <th className="p-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientesQuery.data.map((c: any) => (
                  <tr key={c.id} className={`border-b ${c.noObligado ? "opacity-60" : ""}`}>
                    <td className="p-3 font-medium">{c.nombre}</td>
                    <td className="p-3 font-mono text-xs">{c.cedula}</td>
                    <td className="p-3">
                      {c.noObligado ? "—" : c.vencimiento ? new Date(c.vencimiento).toLocaleDateString("es-CO", { timeZone: "UTC" }) : (
                        <span className="text-orange-600 text-xs">Sin calendario cargado</span>
                      )}
                    </td>
                    <td className="p-3">
                      {!c.noObligado && c.diasRestantes !== null && (
                        <Badge
                          variant="outline"
                          className={c.diasRestantes <= 15 ? "bg-red-50 text-red-700 border-red-200" : c.diasRestantes <= 30 ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-green-50 text-green-700 border-green-200"}
                        >
                          <Clock className="w-3 h-3 mr-1" /> {c.diasRestantes} días
                        </Badge>
                      )}
                    </td>
                    <td className="p-3">
                      {c.terminado ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" /> Terminado</Badge>
                      ) : c.noObligado ? (
                        <Badge variant="outline">No obligado</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pendiente</Badge>
                      )}
                    </td>
                    <td className="p-3">
                      <Checkbox checked={c.noObligado} onCheckedChange={(v) => handleToggleNoObligado(c, !!v)} />
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetForm(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cliente de renta" : "Agregar cliente de renta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" />
            </div>
            <div className="space-y-2">
              <Label>Cédula *</Label>
              <Input value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="Solo números" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editing ? "Actualizar" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
