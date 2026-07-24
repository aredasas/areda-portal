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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { trpc } from "@/lib/trpc";
import {
  UserSquare2, Construction, Plus, Loader2, Pencil, Trash2, CheckCircle2, Clock, Users, FileSpreadsheet,
  Upload, AlertTriangle, Wallet, ChevronDown, Download, Calculator,
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
          <IngresosDeduccionesPorCedulaCard rentaClienteId={rentaClienteId} />
          <Borrador210Card rentaClienteId={rentaClienteId} anioGravable={anioGravable} />

          <Card className="border-dashed">
            <CardContent className="py-10 flex flex-col items-center text-center gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <UserSquare2 className="w-5 h-5" />
                <Construction className="w-4 h-4" />
              </div>
              <h3 className="font-medium">En construcción</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Validación del 60% de costos en rentas de trabajo, anexo ejecutivo, carpeta de Drive
                para soportes, y finalización (subir el 210 con sello de recibido).
              </p>
              <Badge variant="outline" className="text-xs">Próxima entrega</Badge>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Envoltorio genérico para que cada sección de la liquidación se pueda
 * colapsar — con varios clientes cargando datos, la pestaña se vuelve
 * larga rápido, así que cada tarjeta se puede cerrar independientemente. */
function ColapsableCard({ titulo, extra, children, defaultOpen = true }: {
  titulo: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex items-center gap-2 text-left flex-1 min-w-0">
              <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
              <CardTitle className="text-base">{titulo}</CardTitle>
            </button>
          </CollapsibleTrigger>
          {extra}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
    <ColapsableCard titulo="Declaración anterior">
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
    </ColapsableCard>
  );
}

function DependientesCard({ rentaClienteId }: { rentaClienteId: number }) {
  const utils = trpc.useUtils();
  const query = trpc.renta.dependientes.list.useQuery({ rentaClienteId });
  const [nombre, setNombre] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("CC");
  const [numeroDocumento, setNumeroDocumento] = useState("");

  const agregarMutation = trpc.renta.dependientes.agregar.useMutation({
    onSuccess: () => { setNombre(""); setNumeroDocumento(""); utils.renta.dependientes.list.invalidate({ rentaClienteId }); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.dependientes.eliminar.useMutation({
    onSuccess: () => utils.renta.dependientes.list.invalidate({ rentaClienteId }),
  });

  const handleAgregar = () => {
    if (!nombre.trim() || !numeroDocumento.trim()) {
      toast.error("Nombre y número de documento son obligatorios");
      return;
    }
    agregarMutation.mutate({ rentaClienteId, nombre: nombre.trim(), tipoDocumento, numeroDocumento: numeroDocumento.trim() });
  };

  return (
    <ColapsableCard titulo={`Dependientes económicos (${query.data?.length || 0})`}>
      {!!query.data?.length && (
        <div className="space-y-1">
          {query.data.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between text-sm border-b py-1.5">
              <span>{d.nombre} <span className="text-muted-foreground text-xs">— {d.tipoDocumento} {d.numeroDocumento}</span></span>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => eliminarMutation.mutate({ id: d.id })}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-[1fr_100px_140px_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Nombre</Label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo doc.</Label>
          <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CC">CC</SelectItem>
              <SelectItem value="TI">TI</SelectItem>
              <SelectItem value="RC">RC</SelectItem>
              <SelectItem value="CE">CE</SelectItem>
              <SelectItem value="PA">Pasaporte</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Número</Label>
          <Input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} className="h-8" />
        </div>
        <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={agregarMutation.isPending}>
          <Plus className="w-3.5 h-3.5" /> Agregar
        </Button>
      </div>
    </ColapsableCard>
  );
}

function SeccionItemsCard({ rentaClienteId, seccion, titulo, puedeImportar }: {
  rentaClienteId: number; seccion: string; titulo: string; puedeImportar?: boolean;
}) {
  const utils = trpc.useUtils();
  const query = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion });
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const [concepto, setConcepto] = useState("");
  const [valor, setValor] = useState("");
  const [cedula, setCedula] = useState("");
  const requiereCedula = seccion === "ingreso";

  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: () => { setConcepto(""); setValor(""); setCedula(""); utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion }); },
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

  const items = query.data || [];
  const total = items.reduce((acc: number, it: any) => acc + it.valor, 0);
  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const nombreCedula = (valor: string | null) => catalogoQuery.data?.cedulas.find((c: any) => c.valor === valor)?.nombre || "Sin cédula asignada";

  // Para ingresos, se agrupa por cédula (cada una se declara y limita por
  // separado en el Formulario 210) — para activos/pasivos no aplica.
  const grupos = requiereCedula
    ? Array.from(new Set(items.map((it: any) => it.cedula || "")))
        .map(c => ({ cedula: c || null, items: items.filter((it: any) => (it.cedula || "") === c) }))
    : [{ cedula: null, items }];

  const handleAgregar = () => {
    if (!concepto.trim() || !valor) return;
    if (requiereCedula && !cedula) {
      toast.error("Selecciona la cédula a la que pertenece este ingreso");
      return;
    }
    crearMutation.mutate({ rentaClienteId, seccion: seccion as any, concepto: concepto.trim(), valor: Number(valor), cedula: (cedula || undefined) as any });
  };

  return (
    <ColapsableCard
      titulo={titulo}
      extra={puedeImportar && (
        <Button
          size="sm" variant="outline" className="gap-1.5"
          onClick={() => importarMutation.mutate({ rentaClienteId, seccion: seccion as any })}
          disabled={importarMutation.isPending}
        >
          {importarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
          Importar desde exógena
        </Button>
      )}
    >
      {!!items.length && (
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {grupos.map((grupo) => (
            <div key={grupo.cedula || "sin-cedula"}>
              {requiereCedula && (
                <div className="text-xs font-medium text-muted-foreground mb-1">{nombreCedula(grupo.cedula)}</div>
              )}
              <div className="space-y-1">
                {grupo.items.map((it: any) => (
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
              {requiereCedula && (
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                  <span>Subtotal</span>
                  <span>{fmt(grupo.items.reduce((acc: number, it: any) => acc + it.valor, 0))}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between text-sm font-medium border-t pt-2">
        <span>Total {titulo.toLowerCase()}</span>
        <span>{fmt(total)}</span>
      </div>
      <div className={`grid gap-2 pt-2 border-t items-end ${requiereCedula ? "sm:grid-cols-[1fr_1fr_140px_auto]" : "sm:grid-cols-[1fr_140px_auto]"}`}>
        {requiereCedula && (
          <div className="space-y-1">
            <Label className="text-xs">Cédula</Label>
            <Select value={cedula} onValueChange={setCedula}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
              <SelectContent>
                {catalogoQuery.data?.cedulas.map((c: any) => (
                  <SelectItem key={c.valor} value={c.valor}>{c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Concepto" className="h-8" />
        <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor" type="number" className="h-8" />
        <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={crearMutation.isPending}>
          <Plus className="w-3.5 h-3.5" /> Agregar
        </Button>
      </div>
    </ColapsableCard>
  );
}

/** Diálogo para elegir manualmente cuáles ítems de la exógena se importan
 * a la cédula actualmente seleccionada — los que no se marquen quedan
 * disponibles para importarse después bajo otra cédula. */
function ImportarExogenaDialog({ rentaClienteId, cedula, open, onOpenChange, onImportado }: {
  rentaClienteId: number; cedula: string; open: boolean; onOpenChange: (open: boolean) => void; onImportado: () => void;
}) {
  const disponiblesQuery = trpc.renta.liquidacion.exogenaDisponibles.useQuery(
    { rentaClienteId, seccion: "ingreso" }, { enabled: open },
  );
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;

  const importarMutation = trpc.renta.liquidacion.importarSeleccionDesdeExogena.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.importados} ítem(s) importado(s) a esta cédula`);
      setSeleccionados(new Set());
      onImportado();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message || "No se pudo importar"),
  });

  const toggle = (id: number) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Elegir ingresos a importar en esta cédula</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted-foreground">
            Los que no marques quedan disponibles para importarlos después bajo otra cédula.
          </p>
          {disponiblesQuery.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : !disponiblesQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">No hay ingresos de la exógena pendientes por importar.</p>
          ) : (
            <div className="space-y-1">
              {disponiblesQuery.data.map((item: any) => (
                <label key={item.id} className="flex items-center gap-2 text-sm border-b py-1.5 cursor-pointer">
                  <Checkbox checked={seleccionados.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                  <span className="flex-1 min-w-0">
                    <span className="truncate block">{item.nombreTercero ? `${item.nombreTercero} — ` : ""}{item.detalle}</span>
                  </span>
                  <span className="font-medium shrink-0">{fmt(item.valor)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => importarMutation.mutate({ rentaClienteId, seccion: "ingreso", exogenaItemIds: Array.from(seleccionados), cedula: cedula as any })}
            disabled={seleccionados.size === 0 || importarMutation.isPending}
            className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
          >
            {importarMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Importar {seleccionados.size > 0 ? `(${seleccionados.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Se elige primero la cédula, y dentro de ella se cargan sus ingresos y
 * sus deducciones/rentas exentas — en vez de elegir la cédula en cada
 * registro individual. El tope combinado de 1.340 UVT se calcula siempre
 * sobre TODAS las cédulas de la Cédula General juntas (trabajo + capital +
 * no laboral), no solo la que esté seleccionada en pantalla. */
function IngresosDeduccionesPorCedulaCard({ rentaClienteId }: { rentaClienteId: number }) {
  const utils = trpc.useUtils();
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const [cedulaSeleccionada, setCedulaSeleccionada] = useState("trabajo");
  const [showImportarDialog, setShowImportarDialog] = useState(false);

  const cedulaItemsQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "cedula" });

  const [tipoValorIngreso, setTipoValorIngreso] = useState("ingreso_bruto");
  const [conceptoIngreso, setConceptoIngreso] = useState("");
  const [valorIngreso, setValorIngreso] = useState("");
  const [tipoDeduccion, setTipoDeduccion] = useState("");
  const [conceptoDeduccion, setConceptoDeduccion] = useState("");
  const [valorDeduccion, setValorDeduccion] = useState("");

  const invalidarTodo = () => utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "cedula" });

  const crearIngresoMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: () => { setConceptoIngreso(""); setValorIngreso(""); invalidarTodo(); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const crearDeduccionMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: (data) => {
      if (data.alerta) toast.warning(data.alerta); else toast.success("Agregado");
      setConceptoDeduccion(""); setValorDeduccion(""); setTipoDeduccion("");
      invalidarTodo();
    },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({ onSuccess: invalidarTodo });

  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const CEDULAS_GENERAL = ["trabajo", "trabajo_honorarios", "capital", "no_laboral"];
  const todosItems = cedulaItemsQuery.data || [];
  const cedulaInfo = catalogoQuery.data?.cedulas.find((c: any) => c.valor === cedulaSeleccionada);
  const tieneCostos = cedulaInfo?.tieneCostos ?? false;

  const itemsDeEstaCedula = todosItems.filter((it: any) => (it.cedula || "trabajo") === cedulaSeleccionada);
  const ingresosDeEstaCedula = itemsDeEstaCedula.filter((it: any) => ["ingreso_bruto", "ingreso_no_constitutivo", "costo_deduccion_procedente"].includes(it.tipoValor));
  const deduccionesDeEstaCedula = itemsDeEstaCedula.filter((it: any) => ["renta_exenta", "deduccion"].includes(it.tipoValor));

  const totalPorTipo = (tipo: string) => ingresosDeEstaCedula.filter((it: any) => it.tipoValor === tipo).reduce((a: number, it: any) => a + it.valor, 0);
  const rentaLiquidaEstimadaCedula = totalPorTipo("ingreso_bruto") - totalPorTipo("ingreso_no_constitutivo") - totalPorTipo("costo_deduccion_procedente");

  const totalGeneral = todosItems
    .filter((it: any) => ["renta_exenta", "deduccion"].includes(it.tipoValor) && CEDULAS_GENERAL.includes(it.cedula || "trabajo"))
    .reduce((a: number, it: any) => a + it.valor, 0);
  const totalOtrasCedulas = todosItems
    .filter((it: any) => ["renta_exenta", "deduccion"].includes(it.tipoValor) && !CEDULAS_GENERAL.includes(it.cedula || "trabajo"))
    .reduce((a: number, it: any) => a + it.valor, 0);
  const topeGlobal = catalogoQuery.data ? catalogoQuery.data.topeGlobalUVT * catalogoQuery.data.uvt : 0;
  const excedeGlobal = topeGlobal > 0 && totalGeneral > topeGlobal;

  const nombreTipoValor = (t: string) => ({
    ingreso_bruto: "Ingreso bruto", ingreso_no_constitutivo: "Ingreso no constitutivo de renta", costo_deduccion_procedente: "Costo/deducción procedente",
  } as Record<string, string>)[t] || t;

  const handleAgregarIngreso = () => {
    if (!conceptoIngreso.trim() || !valorIngreso) return;
    crearIngresoMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: tipoValorIngreso as any, concepto: conceptoIngreso.trim(), valor: Number(valorIngreso),
    });
  };
  const handleAgregarDeduccion = () => {
    if (!conceptoDeduccion.trim() || !valorDeduccion || !tipoDeduccion) {
      toast.error("Selecciona el tipo, y digita concepto y valor");
      return;
    }
    const tipoInfo = catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoDeduccion);
    crearDeduccionMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: (tipoInfo?.tipoValor || "deduccion") as any,
      tipoDeduccion, concepto: conceptoDeduccion.trim(), valor: Number(valorDeduccion),
    });
  };

  return (
    <ColapsableCard titulo="Ingresos, Deducciones y Rentas Exentas por Cédula">
      <div className="space-y-1.5">
        <Label className="text-xs">Cédula</Label>
        <Select value={cedulaSeleccionada} onValueChange={setCedulaSeleccionada}>
          <SelectTrigger className="w-full sm:w-[420px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {catalogoQuery.data?.cedulas.map((c: any) => (
              <SelectItem key={c.valor} value={c.valor}>{c.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ingresos de la cédula seleccionada — bruto / no constitutivo / costo (si aplica) */}
      <div className="border rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Ingresos</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowImportarDialog(true)}>
            <FileSpreadsheet className="w-3.5 h-3.5" /> Importar desde exógena
          </Button>
        </div>
        {!!ingresosDeEstaCedula.length && (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {ingresosDeEstaCedula.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b py-1.5 gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate">{it.concepto}</div>
                  <div className="text-xs text-muted-foreground">{nombreTipoValor(it.tipoValor)}</div>
                </div>
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
          <span>Renta líquida estimada de esta cédula (bruto − no constitutivo{tieneCostos ? " − costos" : ""})</span>
          <span>{fmt(rentaLiquidaEstimadaCedula)}</span>
        </div>
        <div className={`grid gap-2 items-end ${tieneCostos ? "sm:grid-cols-[1fr_1fr_140px_auto]" : "sm:grid-cols-[1fr_1fr_140px_auto]"}`}>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoValorIngreso} onValueChange={setTipoValorIngreso}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ingreso_bruto">Ingreso bruto</SelectItem>
                <SelectItem value="ingreso_no_constitutivo">Ingreso no constitutivo de renta</SelectItem>
                {tieneCostos && <SelectItem value="costo_deduccion_procedente">Costo/deducción procedente</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <Input value={conceptoIngreso} onChange={(e) => setConceptoIngreso(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valorIngreso} onChange={(e) => setValorIngreso(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarIngreso} disabled={crearIngresoMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </div>

      {/* Deducciones y rentas exentas de la cédula seleccionada */}
      <div className="border rounded-md p-3 space-y-2">
        <span className="text-sm font-medium">Deducciones y Rentas Exentas</span>
        {!!deduccionesDeEstaCedula.length && (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {deduccionesDeEstaCedula.map((it: any) => (
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
        <div className="grid sm:grid-cols-[1fr_1fr_140px_auto] gap-2 items-end">
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
          <Input value={conceptoDeduccion} onChange={(e) => setConceptoDeduccion(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valorDeduccion} onChange={(e) => setValorDeduccion(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarDeduccion} disabled={crearDeduccionMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </div>

      {/* Totales combinados — siempre sobre TODAS las cédulas, no solo la seleccionada */}
      <div className={`flex items-center justify-between text-sm font-medium border-t pt-2 ${excedeGlobal ? "text-red-600" : ""}`}>
        <span className="flex items-center gap-1.5">
          {excedeGlobal && <AlertTriangle className="w-3.5 h-3.5" />}
          Total Cédula General — trabajo + honorarios + capital + no laboral (tope {catalogoQuery.data?.topeGlobalUVT} UVT / {fmt(topeGlobal)})
        </span>
        <span>{fmt(totalGeneral)}</span>
      </div>
      {totalOtrasCedulas > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Total pensiones / dividendos (aparte, no aplica este tope)</span>
          <span>{fmt(totalOtrasCedulas)}</span>
        </div>
      )}

      <ImportarExogenaDialog
        rentaClienteId={rentaClienteId} cedula={cedulaSeleccionada}
        open={showImportarDialog} onOpenChange={setShowImportarDialog}
        onImportado={invalidarTodo}
      />
    </ColapsableCard>
  );
}

function Borrador210Card({ rentaClienteId, anioGravable }: { rentaClienteId: number; anioGravable: number }) {
  const utils = trpc.useUtils();
  const reportesQuery = trpc.renta.reportes.list.useQuery({ rentaClienteId });
  const [ultimoResultado, setUltimoResultado] = useState<any | null>(null);

  const generarMutation = trpc.renta.reportes.generarBorrador210.useMutation({
    onSuccess: (data) => {
      toast.success("Borrador generado");
      setUltimoResultado(data.resultado);
      window.open(data.signedUrl, "_blank");
      utils.renta.reportes.list.invalidate({ rentaClienteId });
    },
    onError: (err) => toast.error(err.message || "No se pudo generar el borrador"),
  });

  const fmt = (n: number | null) => n == null ? "—" : `$${n.toLocaleString("es-CO")}`;

  return (
    <ColapsableCard titulo="Borrador Formulario 210">
      <p className="text-sm text-muted-foreground">
        Reúne los activos, pasivos, ingresos y deducciones/rentas exentas ya cargados, calcula el
        patrimonio líquido, la renta líquida gravable por cédula (con el tope de 1.340 UVT aplicado a la
        Cédula General), y el impuesto según la tabla del Art. 241 E.T. Es un resumen de apoyo — no
        reemplaza la revisión profesional.
      </p>

      <Button
        onClick={() => generarMutation.mutate({ rentaClienteId, anioGravable })}
        disabled={generarMutation.isPending}
        className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white"
      >
        {generarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
        Generar borrador
      </Button>

      {ultimoResultado && (
        <div className="border rounded-md p-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between"><span>Patrimonio líquido</span><span className="font-medium">{fmt(ultimoResultado.patrimonioLiquido)}</span></div>
          <div className="flex items-center justify-between"><span>Renta líquida gravable total</span><span className="font-medium">{fmt(ultimoResultado.rentaLiquidaGravableTotal)}</span></div>
          <div className="flex items-center justify-between font-medium border-t pt-1.5">
            <span>Impuesto de renta ({(ultimoResultado.impuestoRenta.tarifaMarginal * 100).toFixed(0)}%)</span>
            <span>{fmt(ultimoResultado.impuestoRenta.impuesto)}</span>
          </div>
          {ultimoResultado.anticipoEstimado != null && (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Anticipo estimado (referencia)</span><span>{fmt(ultimoResultado.anticipoEstimado)}</span>
            </div>
          )}
        </div>
      )}

      {!!reportesQuery.data?.length && (
        <div className="space-y-1 pt-2 border-t">
          <span className="text-xs text-muted-foreground">Borradores generados anteriormente</span>
          {reportesQuery.data.map((r: any) => (
            <ReporteRentaDownloadLink key={r.id} fileKey={r.fileKey} fecha={r.createdAt} />
          ))}
        </div>
      )}
    </ColapsableCard>
  );
}

function ReporteRentaDownloadLink({ fileKey, fecha }: { fileKey: string; fecha: string }) {
  const urlQuery = trpc.renta.reportes.getDownloadUrl.useQuery({ fileKey }, { enabled: false });
  const handleClick = async () => {
    const result = await urlQuery.refetch();
    if (result.data?.signedUrl) window.open(result.data.signedUrl, "_blank");
  };
  return (
    <button onClick={handleClick} className="flex items-center justify-between text-sm border-b py-1.5 w-full text-left hover:bg-muted/50 rounded px-1">
      <span className="flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> {new Date(fecha).toLocaleString("es-CO")}</span>
    </button>
  );
}
