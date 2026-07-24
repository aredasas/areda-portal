import { useState, useRef } from "react";
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
  Upload, AlertTriangle, Wallet,
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
            <LiquidacionTab anioGravable={anioGravable} />
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

function LiquidacionTab({ anioGravable }: { anioGravable: number }) {
  const clientesQuery = trpc.renta.clientes.list.useQuery({ anioGravable });
  const [rentaClienteId, setRentaClienteId] = useState<number | null>(null);
  const [archivoExogena, setArchivoExogena] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const exogenaQuery = trpc.renta.exogena.get.useQuery(
    { rentaClienteId: rentaClienteId as number },
    { enabled: rentaClienteId !== null },
  );

  const uploadMutation = trpc.renta.exogena.upload.useMutation({
    onSuccess: (data) => {
      toast.success(`Exógena procesada: ${data.totalItems} ítems, ${data.resumen.length} renglones identificados.`);
      setArchivoExogena(null);
      utils.renta.exogena.get.invalidate({ rentaClienteId: rentaClienteId as number });
    },
    onError: (err) => toast.error(err.message || "No se pudo procesar el archivo"),
  });

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleUpload = async () => {
    if (!archivoExogena || rentaClienteId === null) return;
    setSubiendo(true);
    try {
      const archivoBase64 = await fileToBase64(archivoExogena);
      await uploadMutation.mutateAsync({ rentaClienteId, nombreArchivo: archivoExogena.name, archivoBase64 });
    } catch (error: any) {
      toast.error(error.message || "Error al leer el archivo");
    } finally {
      setSubiendo(false);
    }
  };

  const clienteSeleccionado = clientesQuery.data?.find((c: any) => c.id === rentaClienteId);
  const fmt = (n: number | null | undefined) => n == null ? "—" : `$${n.toLocaleString("es-CO")}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground w-32">Cliente de renta:</span>
        <Select value={rentaClienteId ? String(rentaClienteId) : undefined} onValueChange={(v) => setRentaClienteId(Number(v))}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
          <SelectContent>
            {clientesQuery.data?.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.nombre} — {c.cedula}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rentaClienteId === null ? (
        <p className="text-sm text-muted-foreground">Selecciona un cliente para continuar.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="w-4 h-4" /> Información Exógena — {clienteSeleccionado?.nombre}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sube el archivo de "Consulta de Información Exógena" descargado del portal de la DIAN para
                este cliente. Si ya habías subido uno antes, este lo reemplaza.
              </p>
              <input
                ref={fileRef} type="file" accept=".xlsx" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setArchivoExogena(f); }}
              />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
                  <Upload className="w-3.5 h-3.5" /> {archivoExogena?.name || "Seleccionar archivo"}
                </Button>
                {archivoExogena && (
                  <Button
                    size="sm" onClick={handleUpload} disabled={subiendo || uploadMutation.isPending}
                    className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white"
                  >
                    {(subiendo || uploadMutation.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Procesar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {exogenaQuery.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : exogenaQuery.data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wallet className="w-4 h-4" /> Topes (calculados por la DIAN)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    <div><div className="text-muted-foreground text-xs">Ingresos</div><div className="font-medium">{fmt(exogenaQuery.data.topeIngresos)}</div></div>
                    <div><div className="text-muted-foreground text-xs">Patrimonio</div><div className="font-medium">{fmt(exogenaQuery.data.topePatrimonio)}</div></div>
                    <div><div className="text-muted-foreground text-xs">Consumo TC</div><div className="font-medium">{fmt(exogenaQuery.data.topeConsumoTC)}</div></div>
                    <div><div className="text-muted-foreground text-xs">Movimiento</div><div className="font-medium">{fmt(exogenaQuery.data.topeMovimiento)}</div></div>
                    <div><div className="text-muted-foreground text-xs">Compras</div><div className="font-medium">{fmt(exogenaQuery.data.topeCompras)}</div></div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Archivo: {exogenaQuery.data.nombreArchivo} · {exogenaQuery.data.items.length} ítems procesados
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Resumen por renglón del Formulario 210</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-3 font-medium">Renglón</th>
                        <th className="p-3 font-medium">Categoría</th>
                        <th className="p-3 font-medium">Ítems</th>
                        <th className="p-3 font-medium text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exogenaQuery.data.resumen.map((r: any) => (
                        <tr key={r.renglon} className="border-b">
                          <td className="p-3 font-mono text-xs">{r.renglon}</td>
                          <td className="p-3">
                            <Badge variant="outline" className={
                              r.categoria === "patrimonio" ? "bg-blue-50 text-blue-700 border-blue-200"
                                : r.categoria === "deuda" ? "bg-red-50 text-red-700 border-red-200"
                                : r.categoria === "ingreso" ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-gray-50 text-gray-700 border-gray-200"
                            }>{r.categoria}</Badge>
                          </td>
                          <td className="p-3">{r.cantidadItems}</td>
                          <td className="p-3 text-right font-medium">{fmt(r.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {exogenaQuery.data.resumen.some((r: any) => r.renglon === "(sin renglón)") && (
                    <p className="text-xs text-muted-foreground p-3 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      "(sin renglón)" son ítems que alimentan los Topes pero no van directo a una línea del
                      formulario (ej. movimientos bancarios, facturación electrónica) — revisar manualmente
                      si aportan a algún renglón específico.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin información exógena cargada todavía para este cliente.
            </p>
          )}

          <Card className="border-dashed">
            <CardContent className="py-10 flex flex-col items-center text-center gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <UserSquare2 className="w-5 h-5" />
                <Construction className="w-4 h-4" />
              </div>
              <h3 className="font-medium">En construcción</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Declaración anterior + impuesto neto 2024 (para el anticipo), detalle de
                activos/pasivos/ingresos/deducciones/rentas exentas con topes 2025, dependientes económicos,
                validaciones, y generación del borrador del Formulario 210 con su anexo ejecutivo.
              </p>
              <Badge variant="outline" className="text-xs">Próxima entrega</Badge>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
