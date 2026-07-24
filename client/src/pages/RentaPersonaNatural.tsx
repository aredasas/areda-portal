import { useState, useRef, useEffect } from "react";
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

          <DeclaracionAnteriorCard rentaClienteId={rentaClienteId} />
          <DependientesCard rentaClienteId={rentaClienteId} />
          <SeccionItemsCard rentaClienteId={rentaClienteId} seccion="activo" titulo="Activos" puedeImportar />
          <SeccionItemsCard rentaClienteId={rentaClienteId} seccion="pasivo" titulo="Pasivos" puedeImportar />
          <SeccionItemsCard rentaClienteId={rentaClienteId} seccion="ingreso" titulo="Ingresos por cédula" puedeImportar />
          <DeduccionesCard rentaClienteId={rentaClienteId} />

          <Card className="border-dashed">
            <CardContent className="py-10 flex flex-col items-center text-center gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <UserSquare2 className="w-5 h-5" />
                <Construction className="w-4 h-4" />
              </div>
              <h3 className="font-medium">En construcción</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Validación del 60% de costos en rentas de trabajo, generación del borrador del
                Formulario 210 con su anexo ejecutivo, carpeta de Drive para soportes, y finalización.
              </p>
              <Badge variant="outline" className="text-xs">Próxima entrega</Badge>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function DeclaracionAnteriorCard({ rentaClienteId }: { rentaClienteId: number }) {
  const utils = trpc.useUtils();
  const query = trpc.renta.declaracionAnterior.get.useQuery({ rentaClienteId });
  const [patrimonio, setPatrimonio] = useState("");
  const [impuestoNeto, setImpuestoNeto] = useState("");
  const [saldoAFavor, setSaldoAFavor] = useState("");
  const [editado, setEditado] = useState(false);

  useEffect(() => {
    if (query.data && !editado) {
      setPatrimonio(query.data.patrimonioLiquidoAnioAnterior != null ? String(query.data.patrimonioLiquidoAnioAnterior) : "");
      setImpuestoNeto(query.data.impuestoNetoAnioAnterior != null ? String(query.data.impuestoNetoAnioAnterior) : "");
      setSaldoAFavor(query.data.saldoAFavorAnterior != null ? String(query.data.saldoAFavorAnterior) : "");
    }
  }, [query.data, editado]);

  const guardarMutation = trpc.renta.declaracionAnterior.guardar.useMutation({
    onSuccess: () => { toast.success("Guardado"); utils.renta.declaracionAnterior.get.invalidate({ rentaClienteId }); },
    onError: (err) => toast.error(err.message || "No se pudo guardar"),
  });

  const handleGuardar = () => {
    guardarMutation.mutate({
      rentaClienteId,
      patrimonioLiquidoAnioAnterior: patrimonio ? Number(patrimonio) : undefined,
      impuestoNetoAnioAnterior: impuestoNeto ? Number(impuestoNeto) : undefined,
      saldoAFavorAnterior: saldoAFavor ? Number(saldoAFavor) : undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Declaración anterior</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          El impuesto neto de renta del año anterior es necesario para calcular el nuevo anticipo de renta.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Patrimonio líquido año anterior</Label>
            <Input type="number" value={patrimonio} onChange={(e) => { setPatrimonio(e.target.value); setEditado(true); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Impuesto neto de renta año anterior</Label>
            <Input type="number" value={impuestoNeto} onChange={(e) => { setImpuestoNeto(e.target.value); setEditado(true); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Saldo a favor anterior</Label>
            <Input type="number" value={saldoAFavor} onChange={(e) => { setSaldoAFavor(e.target.value); setEditado(true); }} />
          </div>
        </div>
        <Button size="sm" onClick={handleGuardar} disabled={guardarMutation.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
          {guardarMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}

function DependientesCard({ rentaClienteId }: { rentaClienteId: number }) {
  const utils = trpc.useUtils();
  const query = trpc.renta.dependientes.list.useQuery({ rentaClienteId });
  const [nombre, setNombre] = useState("");

  const agregarMutation = trpc.renta.dependientes.agregar.useMutation({
    onSuccess: () => { setNombre(""); utils.renta.dependientes.list.invalidate({ rentaClienteId }); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.dependientes.eliminar.useMutation({
    onSuccess: () => utils.renta.dependientes.list.invalidate({ rentaClienteId }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dependientes económicos ({query.data?.length || 0})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!!query.data?.length && (
          <div className="space-y-1">
            {query.data.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between text-sm border-b py-1.5">
                <span>{d.nombre}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => eliminarMutation.mutate({ id: d.id })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del dependiente"
            className="h-8" onKeyDown={(e) => { if (e.key === "Enter" && nombre.trim()) agregarMutation.mutate({ rentaClienteId, nombre: nombre.trim() }); }}
          />
          <Button
            size="sm" variant="outline" className="gap-1"
            onClick={() => nombre.trim() && agregarMutation.mutate({ rentaClienteId, nombre: nombre.trim() })}
          >
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SeccionItemsCard({ rentaClienteId, seccion, titulo, puedeImportar }: {
  rentaClienteId: number; seccion: string; titulo: string; puedeImportar?: boolean;
}) {
  const utils = trpc.useUtils();
  const query = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion });
  const [concepto, setConcepto] = useState("");
  const [valor, setValor] = useState("");

  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: () => { setConcepto(""); setValor(""); utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion }); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({
    onSuccess: () => utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion }),
  });
  const importarMutation = trpc.renta.liquidacion.importarDesdeExogena.useMutation({
    onSuccess: (data) => {
      toast.success(data.importados > 0 ? `${data.importados} ítem(s) importado(s) de la exógena` : "No hay ítems nuevos para importar");
      utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion });
    },
  });

  const total = (query.data || []).reduce((acc: number, it: any) => acc + it.valor, 0);
  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;

  const handleAgregar = () => {
    if (!concepto.trim() || !valor) return;
    crearMutation.mutate({ rentaClienteId, seccion: seccion as any, concepto: concepto.trim(), valor: Number(valor) });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{titulo}</CardTitle>
        {puedeImportar && (
          <Button
            size="sm" variant="outline" className="gap-1.5"
            onClick={() => importarMutation.mutate({ rentaClienteId, seccion: seccion as any })}
            disabled={importarMutation.isPending}
          >
            {importarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            Importar desde exógena
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!!query.data?.length && (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {query.data.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b py-1.5 gap-2">
                <span className="flex-1 min-w-0 truncate">{it.concepto}</span>
                {it.origen === "exogena" && <Badge variant="outline" className="text-[10px] shrink-0">Exógena</Badge>}
                <span className="font-medium shrink-0">{fmt(it.valor)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-sm font-medium border-t pt-2">
          <span>Total {titulo.toLowerCase()}</span>
          <span>{fmt(total)}</span>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t">
          <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Concepto" className="h-8 flex-1" />
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor" type="number" className="h-8 w-36" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={crearMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeduccionesCard({ rentaClienteId }: { rentaClienteId: number }) {
  const utils = trpc.useUtils();
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const deduccionesQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "deduccion" });
  const rentasExentasQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "rentaExenta" });
  const [tipoDeduccion, setTipoDeduccion] = useState("");
  const [concepto, setConcepto] = useState("");
  const [valor, setValor] = useState("");

  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: (data) => {
      if (data.alerta) toast.warning(data.alerta);
      else toast.success("Agregado");
      setConcepto(""); setValor(""); setTipoDeduccion("");
      utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "deduccion" });
      utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "rentaExenta" });
    },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({
    onSuccess: () => {
      utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "deduccion" });
      utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "rentaExenta" });
    },
  });

  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const todos = [...(deduccionesQuery.data || []), ...(rentasExentasQuery.data || [])];
  const total = todos.reduce((acc: number, it: any) => acc + it.valor, 0);
  const topeGlobal = catalogoQuery.data ? catalogoQuery.data.topeGlobalUVT * catalogoQuery.data.uvt : 0;
  const excedeGlobal = topeGlobal > 0 && total > topeGlobal;

  const handleAgregar = () => {
    if (!concepto.trim() || !valor || !tipoDeduccion) {
      toast.error("Selecciona el tipo, y digita concepto y valor");
      return;
    }
    const tipoInfo = catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoDeduccion);
    crearMutation.mutate({
      rentaClienteId, seccion: (tipoInfo?.seccion || "deduccion") as any,
      tipoDeduccion, concepto: concepto.trim(), valor: Number(valor),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deducciones y Rentas Exentas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Cada tipo se valida contra su tope individual 2025. El total combinado no puede superar{" "}
          {catalogoQuery.data && `${catalogoQuery.data.topeGlobalUVT} UVT (${fmt(topeGlobal)})`} — o el 40% de la
          renta líquida, lo que sea menor (verificar una vez estén completos los ingresos).
        </p>

        {!!todos.length && (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {todos.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b py-1.5 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate">{it.concepto}</div>
                  <div className="text-xs text-muted-foreground">
                    {catalogoQuery.data?.tipos.find((t: any) => t.tipo === it.tipoDeduccion)?.nombre || it.tipoDeduccion}
                  </div>
                </div>
                <span className="font-medium shrink-0">{fmt(it.valor)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className={`flex items-center justify-between text-sm font-medium border-t pt-2 ${excedeGlobal ? "text-red-600" : ""}`}>
          <span className="flex items-center gap-1.5">
            {excedeGlobal && <AlertTriangle className="w-3.5 h-3.5" />}
            Total deducciones + rentas exentas
          </span>
          <span>{fmt(total)}</span>
        </div>

        <div className="grid sm:grid-cols-[1fr_1fr_140px_auto] gap-2 pt-2 border-t items-end">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoDeduccion} onValueChange={setTipoDeduccion}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
              <SelectContent>
                {catalogoQuery.data?.tipos.map((t: any) => (
                  <SelectItem key={t.tipo} value={t.tipo}>{t.nombre}{t.topeUVT ? ` (tope ${t.topeUVT} UVT)` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Concepto</Label>
            <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor</Label>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} type="number" className="h-8" />
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={crearMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
