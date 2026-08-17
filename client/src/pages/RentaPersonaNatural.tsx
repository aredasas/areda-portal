import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
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
  Upload, AlertTriangle, Wallet, ChevronDown, Download, Calculator, Eye, FolderOpen, File, Send, ThumbsUp, ThumbsDown, ShieldCheck, Search, Ban, RotateCcw, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";

// La DIAN publica los topes en pesos redondeados al millar más cercano
// (confirmado contra el archivo Ayuda Renta 2025) — no una multiplicación
// directa sin redondear. Mismo criterio que en el backend (rentaDb.ts).
const redondearPesosDian = (valorExacto: number) => Math.round(valorExacto / 1000) * 1000;

export default function RentaPersonaNatural() {
  const now = new Date();
  // Año gravable que se está declarando (el año de la exógena consultada,
  // ej. 2025 se declara durante 2026) — no el año calendario actual.
  const [anioGravable, setAnioGravable] = useState(now.getFullYear() - 1);
  const [tab, setTab] = useState("clientes");
  const [rentaClienteIdDesdeUrl, setRentaClienteIdDesdeUrl] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("rentaClienteId");
    const anioParam = params.get("anioGravable");
    if (idParam) {
      setRentaClienteIdDesdeUrl(Number(idParam));
      setTab("liquidacion");
      if (anioParam) setAnioGravable(Number(anioParam));
    }
  }, []);

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

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="clientes" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Listado Clientes Renta</TabsTrigger>
            <TabsTrigger value="liquidacion" className="gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" /> Liquidación</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes" className="mt-4">
            <ClientesRentaTab
              anioGravable={anioGravable}
              onIrALiquidacion={(id) => { setRentaClienteIdDesdeUrl(id); setTab("liquidacion"); }}
            />
          </TabsContent>

          <TabsContent value="liquidacion" className="mt-4">
            <LiquidacionTab anioGravable={anioGravable} rentaClienteIdInicial={rentaClienteIdDesdeUrl} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

/** Badge "Terminado" clickeable — al hacer clic abre la declaración final
 * que se subió con el sello de recibido. */
function TerminadoBadge({ fileKey }: { fileKey: string | null }) {
  const urlQuery = trpc.renta.reportes.getDownloadUrl.useQuery({ fileKey: fileKey || "" }, { enabled: false });
  const handleClick = async () => {
    if (!fileKey) { toast.error("No se encontró el archivo de la declaración final."); return; }
    const result = await urlQuery.refetch();
    if (result.data?.signedUrl) window.open(result.data.signedUrl, "_blank");
  };
  return (
    <button onClick={handleClick}>
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-200 cursor-pointer gap-1">
        <CheckCircle2 className="w-3 h-3" /> Terminado
      </Badge>
    </button>
  );
}

function ClientesRentaTab({ anioGravable, onIrALiquidacion }: { anioGravable: number; onIrALiquidacion: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [busqueda, setBusqueda] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const clientesQuery = trpc.renta.clientes.list.useQuery({ anioGravable, incluirInactivos: mostrarInactivos });

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
  const importarMutation = trpc.renta.clientes.importarExcel.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.creados} cliente(s) agregado(s)${data.yaExistian > 0 ? ` — ${data.yaExistian} ya existían y se omitieron` : ""}`);
      utils.renta.clientes.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo importar el archivo"),
  });
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);

  const handleImportar = async (file: File) => {
    setImportando(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await importarMutation.mutateAsync({ anioGravable, archivoBase64: base64 });
    } catch (e: any) {
      toast.error(e.message || "Error al leer el archivo");
    } finally {
      setImportando(false);
      if (fileImportRef.current) fileImportRef.current.value = "";
    }
  };

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

  const handleToggleActivo = (c: any) => {
    const accion = c.activo ? "inactivar" : "reactivar";
    if (!window.confirm(`¿Seguro que quieres ${accion} a ${c.nombre}?`)) return;
    updateMutation.mutate({ id: c.id, activo: !c.activo });
  };

  const clientesFiltrados = (clientesQuery.data || []).filter((c: any) =>
    c.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative w-full max-w-xs">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre..." className="pl-8" />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0 cursor-pointer">
            <Checkbox checked={mostrarInactivos} onCheckedChange={(v) => setMostrarInactivos(!!v)} />
            Mostrar inactivos
          </label>
        </div>
        <div className="flex gap-2">
          <input ref={fileImportRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportar(f); }} />
          <Button variant="outline" className="gap-2" onClick={() => fileImportRef.current?.click()} disabled={importando}>
            {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Importar clientes (Excel)
          </Button>
          <Button onClick={openNew} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
            <Plus className="w-4 h-4" /> Agregar cliente
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {clientesQuery.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !clientesFiltrados.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {busqueda ? "Ningún cliente coincide con la búsqueda." : `Sin clientes de renta para ${anioGravable} todavía.`}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium w-10">#</th>
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
                {clientesFiltrados.map((c: any, i: number) => (
                  <tr key={c.id} className={`border-b ${c.noObligado || !c.activo ? "opacity-60" : ""}`}>
                    <td className="p-3 text-muted-foreground">{i + 1}</td>
                    <td className="p-3 font-medium">
                      {c.nombre}
                      {!c.activo && <Badge variant="outline" className="ml-2 text-[10px] bg-gray-100 text-gray-600 border-gray-300">Inactivo</Badge>}
                    </td>
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
                        <TerminadoBadge fileKey={c.declaracionFileKey} />
                      ) : c.noObligado ? (
                        <Badge variant="outline">No obligado</Badge>
                      ) : c.tieneExogena ? (
                        <button onClick={() => onIrALiquidacion(c.id)}>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 cursor-pointer gap-1">
                            <FileSpreadsheet className="w-3 h-3" /> En proceso
                          </Badge>
                        </button>
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
                        <Button
                          variant="ghost" size="icon" className={`h-8 w-8 ${c.activo ? "text-orange-600" : "text-green-600"}`}
                          onClick={() => handleToggleActivo(c)} title={c.activo ? "Inactivar cliente" : "Reactivar cliente"}
                        >
                          {c.activo ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        </Button>
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

      <LimpiarDatosLiquidacionCard />
    </div>
  );
}

function LimpiarDatosLiquidacionCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [showConfirm, setShowConfirm] = useState(false);
  const [textoConfirmacion, setTextoConfirmacion] = useState("");

  const limpiarMutation = trpc.renta.clientes.limpiarDatosLiquidacion.useMutation({
    onSuccess: (data) => {
      toast.success(`Datos de Liquidación borrados en ${data.clientesAfectados} cliente(s) — la lista de clientes se conservó.`);
      setShowConfirm(false);
      setTextoConfirmacion("");
      utils.renta.clientes.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo completar la limpieza"),
  });

  if (user?.cedula !== "5820262") return null;

  return (
    <div className="border border-red-200 bg-red-50/40 rounded-md p-4 mt-6">
      <p className="text-sm font-medium text-red-800 flex items-center gap-1.5 mb-1">
        <AlertTriangle className="w-4 h-4" /> Zona de riesgo
      </p>
      <p className="text-xs text-red-700 mb-3">
        Borra TODO lo cargado en la pestaña Liquidación de todos los clientes de renta (exógena, declaración
        anterior, dependientes, cédulas, y el historial de borradores/anexos) — la lista de clientes y sus
        carpetas de Drive se conservan. Acción irreversible, pensada para dejar el módulo en blanco antes de
        una capacitación.
      </p>
      <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100" onClick={() => setShowConfirm(true)}>
        Borrar datos de Liquidación (todos los clientes)
      </Button>

      <Dialog open={showConfirm} onOpenChange={(o) => { setShowConfirm(o); if (!o) setTextoConfirmacion(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-red-800">Confirmar borrado de datos</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Esta acción no se puede deshacer. Para confirmar, escribe exactamente: <strong>BORRAR DATOS RENTA</strong>
            </p>
            <Input value={textoConfirmacion} onChange={(e) => setTextoConfirmacion(e.target.value)} placeholder="BORRAR DATOS RENTA" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancelar</Button>
            <Button
              variant="destructive" disabled={textoConfirmacion !== "BORRAR DATOS RENTA" || limpiarMutation.isPending}
              onClick={() => limpiarMutation.mutate({ confirmacion: textoConfirmacion })}
            >
              {limpiarMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
              Borrar todo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LiquidacionTab({ anioGravable, rentaClienteIdInicial }: { anioGravable: number; rentaClienteIdInicial?: number | null }) {
  const clientesQuery = trpc.renta.clientes.list.useQuery({ anioGravable });
  const [rentaClienteId, setRentaClienteId] = useState<number | null>(null);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [archivoExogena, setArchivoExogena] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const [renglonDetalle, setRenglonDetalle] = useState<string | null>(null);
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const toggleNoObligadoMutation = trpc.renta.clientes.update.useMutation({
    onSuccess: () => utils.renta.clientes.list.invalidate(),
    onError: (err) => toast.error(err.message || "No se pudo actualizar"),
  });

  useEffect(() => {
    if (rentaClienteIdInicial != null) setRentaClienteId(rentaClienteIdInicial);
  }, [rentaClienteIdInicial]);

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
  const soloLectura = !!clienteSeleccionado?.terminado;
  const fmt = (n: number | null | undefined) => n == null ? "—" : `$${n.toLocaleString("es-CO")}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground w-32">Cliente de renta:</span>
        <div className="relative w-56">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busquedaCliente} onChange={(e) => setBusquedaCliente(e.target.value)}
            placeholder="Buscar por nombre..." className="pl-8 h-9"
          />
        </div>
        <Select value={rentaClienteId ? String(rentaClienteId) : undefined} onValueChange={(v) => setRentaClienteId(Number(v))}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
          <SelectContent>
            {clientesQuery.data
              ?.filter((c: any) => c.nombre.toLowerCase().includes(busquedaCliente.trim().toLowerCase()))
              .map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.nombre} — {c.cedula}</SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {rentaClienteId === null ? (
        <p className="text-sm text-muted-foreground">Selecciona un cliente para continuar.</p>
      ) : (
        <>
          {soloLectura && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 rounded-md p-3 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Esta renta está <strong>terminada</strong> — solo se puede generar el borrador y los anexos. Para
              volver a editarla, reábrela desde la pestaña Revisión.
            </div>
          )}
          <DriveCard key={`drive-${rentaClienteId}`} rentaClienteId={rentaClienteId} anioGravable={anioGravable} soloLectura={soloLectura} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="w-4 h-4" /> Información Exógena — {clienteSeleccionado?.nombre}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {soloLectura ? (
                <p className="text-sm text-muted-foreground">Renta terminada — no se puede reemplazar la exógena.</p>
              ) : (
                <>
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
                </>
              )}
            </CardContent>
          </Card>

          {exogenaQuery.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : exogenaQuery.data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Wallet className="w-4 h-4" /> Topes (calculados por la DIAN)
                    </span>
                    <label className="flex items-center gap-1.5 text-sm font-normal text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={!!clienteSeleccionado?.noObligado}
                        onCheckedChange={(v) => rentaClienteId && toggleNoObligadoMutation.mutate({ id: rentaClienteId, noObligado: !!v })}
                      />
                      No obligado a declarar
                    </label>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    {([
                      ["Ingresos", exogenaQuery.data.topeIngresos, catalogoQuery.data?.topesObligacionUVT.ingresos],
                      ["Patrimonio", exogenaQuery.data.topePatrimonio, catalogoQuery.data?.topesObligacionUVT.patrimonio],
                      ["Consumo TC", exogenaQuery.data.topeConsumoTC, catalogoQuery.data?.topesObligacionUVT.consumoTC],
                      ["Movimiento", exogenaQuery.data.topeMovimiento, catalogoQuery.data?.topesObligacionUVT.movimiento],
                      ["Compras", exogenaQuery.data.topeCompras, catalogoQuery.data?.topesObligacionUVT.compras],
                    ] as [string, number | null, number | undefined][]).map(([etiqueta, valorCalculado, topeUVT]) => {
                      const topePesos = topeUVT && catalogoQuery.data ? redondearPesosDian(topeUVT * catalogoQuery.data.uvt) : null;
                      const obligado = topePesos != null && valorCalculado != null && valorCalculado >= topePesos;
                      return (
                        <div key={etiqueta}>
                          <div className="text-muted-foreground text-xs">{etiqueta}</div>
                          <div className="font-medium">{fmt(valorCalculado)}</div>
                          {topePesos != null && (
                            <>
                              <div className="text-muted-foreground text-[11px] mt-1">Tope 2025: {fmt(topePesos)}</div>
                              <Badge variant="outline" className={`text-[10px] mt-0.5 ${obligado ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                                {obligado ? "Obligado" : "No obligado"}
                              </Badge>
                            </>
                          )}
                        </div>
                      );
                    })}
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
                        <th className="p-3 font-medium"></th>
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
                                : r.categoria === "retencion" ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-gray-50 text-gray-700 border-gray-200"
                            }>{r.categoria}</Badge>
                          </td>
                          <td className="p-3">{r.cantidadItems}</td>
                          <td className="p-3 text-right font-medium">{fmt(r.valor)}</td>
                          <td className="p-3">
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setRenglonDetalle(r.renglon)}>
                              <Eye className="w-3.5 h-3.5" /> Ver
                            </Button>
                          </td>
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

              <Dialog open={!!renglonDetalle} onOpenChange={(o) => !o && setRenglonDetalle(null)}>
                <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto overflow-x-hidden min-w-0">
                  <DialogHeader>
                    <DialogTitle>Detalle del renglón {renglonDetalle}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-1 min-w-0">
                    {(() => {
                      const itemsDelRenglon = exogenaQuery.data.items
                        .filter((it: any) => (it.renglon || "(sin renglón)") === renglonDetalle);
                      // Mismo tercero + mismo concepto (detalle) repetido —
                      // se une en una sola fila, sumando el valor, con un
                      // contador en rojo de cuántos registros originales
                      // se agruparon ahí.
                      const consolidado = new Map<string, { nombreTercero: string | null; nitTercero: string | null; detalle: string | null; valor: number; cantidad: number }>();
                      for (const it of itemsDelRenglon) {
                        const key = `${it.nombreTercero}|${it.detalle}`;
                        const existente = consolidado.get(key);
                        if (existente) { existente.valor += it.valor; existente.cantidad += 1; }
                        else consolidado.set(key, { nombreTercero: it.nombreTercero, nitTercero: it.nitTercero, detalle: it.detalle, valor: it.valor, cantidad: 1 });
                      }
                      return Array.from(consolidado.values()).map((it, i) => (
                        <div key={i} className="flex items-start justify-between gap-2 text-sm border-b py-1.5 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate flex items-center gap-1.5">
                              {it.nombreTercero || "(tercero sin nombre en el archivo)"}
                              {it.cantidad > 1 && (
                                <span className="text-red-600 font-bold text-xs shrink-0" title={`${it.cantidad} registros de este mismo tercero y concepto, sumados`}>
                                  {it.cantidad}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">{it.nitTercero} · {it.detalle}</div>
                          </div>
                          <span className="font-medium shrink-0 whitespace-nowrap">{fmt(it.valor)}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin información exógena cargada todavía para este cliente.
            </p>
          )}

          <DeclaracionAnteriorCard key={`decl-${rentaClienteId}`} rentaClienteId={rentaClienteId} soloLectura={soloLectura} />
          <DependientesCard key={`dep-${rentaClienteId}`} rentaClienteId={rentaClienteId} soloLectura={soloLectura} />
          <SeccionItemsCard key={`activo-${rentaClienteId}`} rentaClienteId={rentaClienteId} seccion="activo" titulo="Activos" puedeImportar soloLectura={soloLectura} />
          <SeccionItemsCard key={`pasivo-${rentaClienteId}`} rentaClienteId={rentaClienteId} seccion="pasivo" titulo="Pasivos" puedeImportar soloLectura={soloLectura} />
          <IngresosDeduccionesPorCedulaCard key={`ced-${rentaClienteId}`} rentaClienteId={rentaClienteId} soloLectura={soloLectura} />
          <GananciaOcasionalCard key={`go-${rentaClienteId}`} rentaClienteId={rentaClienteId} soloLectura={soloLectura} />
          <DescuentosTributariosCard key={`dt-${rentaClienteId}`} rentaClienteId={rentaClienteId} soloLectura={soloLectura} />
          <ResumenPendiente210Card key={`resumen-${rentaClienteId}`} rentaClienteId={rentaClienteId} />
          <ValidarRentaCard key={`validar-${rentaClienteId}`} rentaClienteId={rentaClienteId} />
          <Borrador210Card key={`borrador-${rentaClienteId}`} rentaClienteId={rentaClienteId} anioGravable={anioGravable} />
          <RevisionFinalizacionCard key={`revision-${rentaClienteId}`} rentaClienteId={rentaClienteId} anioGravable={anioGravable} />
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

function DeclaracionAnteriorCard({ rentaClienteId, soloLectura }: { rentaClienteId: number; soloLectura?: boolean }) {
  const utils = trpc.useUtils();
  const query = trpc.renta.declaracionAnterior.get.useQuery({ rentaClienteId });
  const [patrimonio, setPatrimonio] = useState("");
  const [impuestoNeto, setImpuestoNeto] = useState("");
  const [saldoAFavor, setSaldoAFavor] = useState("");
  const [anticipoActual, setAnticipoActual] = useState("");
  const [editado, setEditado] = useState(false);

  useEffect(() => {
    if (query.data && !editado) {
      setPatrimonio(query.data.patrimonioLiquidoAnioAnterior != null ? String(query.data.patrimonioLiquidoAnioAnterior) : "");
      setImpuestoNeto(query.data.impuestoNetoAnioAnterior != null ? String(query.data.impuestoNetoAnioAnterior) : "");
      setSaldoAFavor(query.data.saldoAFavorAnterior != null ? String(query.data.saldoAFavorAnterior) : "");
      setAnticipoActual(query.data.anticipoAnioActual != null ? String(query.data.anticipoAnioActual) : "");
    }
  }, [query.data, editado]);

  const guardarMutation = trpc.renta.declaracionAnterior.guardar.useMutation({
    onSuccess: () => { toast.success("Guardado"); utils.renta.declaracionAnterior.get.invalidate({ rentaClienteId }); utils.renta.reportes.resumenActual.invalidate({ rentaClienteId }); },
    onError: (err) => toast.error(err.message || "No se pudo guardar"),
  });

  const handleGuardar = () => {
    guardarMutation.mutate({
      rentaClienteId,
      patrimonioLiquidoAnioAnterior: patrimonio ? Number(patrimonio) : undefined,
      impuestoNetoAnioAnterior: impuestoNeto ? Number(impuestoNeto) : undefined,
      saldoAFavorAnterior: saldoAFavor ? Number(saldoAFavor) : undefined,
      anticipoAnioActual: anticipoActual ? Number(anticipoActual) : undefined,
    });
  };

  // Máscara de miles: el estado guarda solo dígitos (sin puntos), y se
  // muestra formateado — así el valor que se envía al guardar sigue siendo
  // un número limpio.
  const conMascara = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const soloDigitos = e.target.value.replace(/\D/g, "");
    setter(soloDigitos);
    setEditado(true);
  };
  const formateado = (v: string) => v ? Number(v).toLocaleString("es-CO") : "";

  return (
    <ColapsableCard titulo="Declaración anterior" defaultOpen={false}>
      <p className="text-sm text-muted-foreground">
        El impuesto neto de renta del año anterior es necesario para calcular el nuevo anticipo de renta.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Patrimonio líquido año anterior</Label>
          <Input type="text" inputMode="numeric" value={formateado(patrimonio)} onChange={conMascara(setPatrimonio)} disabled={soloLectura} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Impuesto neto de renta año anterior</Label>
          <Input type="text" inputMode="numeric" value={formateado(impuestoNeto)} onChange={conMascara(setImpuestoNeto)} disabled={soloLectura} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Saldo a favor anterior</Label>
          <Input type="text" inputMode="numeric" value={formateado(saldoAFavor)} onChange={conMascara(setSaldoAFavor)} disabled={soloLectura} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Anticipo anterior</Label>
          <Input type="text" inputMode="numeric" value={formateado(anticipoActual)} onChange={conMascara(setAnticipoActual)} disabled={soloLectura} />
        </div>
      </div>
      {!soloLectura && (
        <Button size="sm" onClick={handleGuardar} disabled={guardarMutation.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
          {guardarMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
          Guardar
        </Button>
      )}
    </ColapsableCard>
  );
}

function DependientesCard({ rentaClienteId, soloLectura }: { rentaClienteId: number; soloLectura?: boolean }) {
  const utils = trpc.useUtils();
  const query = trpc.renta.dependientes.list.useQuery({ rentaClienteId });
  const [nombre, setNombre] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("CC");
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [tipoDeduccionDep, setTipoDeduccionDep] = useState("");

  const agregarMutation = trpc.renta.dependientes.agregar.useMutation({
    onSuccess: () => { setNombre(""); setNumeroDocumento(""); setTipoDeduccionDep(""); utils.renta.dependientes.list.invalidate({ rentaClienteId }); },
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
    agregarMutation.mutate({
      rentaClienteId, nombre: nombre.trim(), tipoDocumento, numeroDocumento: numeroDocumento.trim(),
      tipoDeduccion: (tipoDeduccionDep || undefined) as any,
    });
  };

  const NOMBRE_TIPO_DEP: Record<string, string> = {
    diez_por_ciento: "10% ingresos", adicional_72uvt: "Adicional (72 UVT)",
  };

  return (
    <ColapsableCard titulo={`Dependientes económicos (${query.data?.length || 0})`} defaultOpen={false}>
      {!!query.data?.length && (
        <div className="space-y-1">
          {query.data.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between text-sm border-b py-1.5">
              <span>
                {d.nombre} <span className="text-muted-foreground text-xs">— {d.tipoDocumento} {d.numeroDocumento}</span>
                {d.tipoDeduccion && <span className="ml-1.5 text-[10px] text-indigo-700 bg-indigo-100 rounded px-1.5 py-0.5">{NOMBRE_TIPO_DEP[d.tipoDeduccion] || d.tipoDeduccion}</span>}
              </span>
              {!soloLectura && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => eliminarMutation.mutate({ id: d.id })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {!soloLectura && (
        <div className="grid sm:grid-cols-[1fr_90px_120px_150px_auto] gap-2 items-end">
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
          <div className="space-y-1">
            <Label className="text-xs">Deducción</Label>
            <Select value={tipoDeduccionDep} onValueChange={setTipoDeduccionDep}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Elegir..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="diez_por_ciento">10% ingresos (único, no aumenta)</SelectItem>
                <SelectItem value="adicional_72uvt">Adicional (72 UVT, fuera del 40%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={agregarMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      )}
    </ColapsableCard>
  );
}

function SeccionItemsCard({ rentaClienteId, seccion, titulo, puedeImportar, soloLectura }: {
  rentaClienteId: number; seccion: string; titulo: string; puedeImportar?: boolean; soloLectura?: boolean;
}) {
  const utils = trpc.useUtils();
  const query = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion });
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const [concepto, setConcepto] = useState("");
  const [valor, setValor] = useState("");
  const [cedula, setCedula] = useState("");
  const [showImportarDialog, setShowImportarDialog] = useState(false);
  const requiereCedula = seccion === "ingreso";

  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: () => { setConcepto(""); setValor(""); setCedula(""); utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion }); utils.renta.reportes.resumenActual.invalidate({ rentaClienteId }); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({
    onSuccess: () => { utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion }); utils.renta.reportes.resumenActual.invalidate({ rentaClienteId }); },
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
      defaultOpen={false}
      extra={puedeImportar && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowImportarDialog(true)} disabled={soloLectura}>
          <FileSpreadsheet className="w-3.5 h-3.5" />
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}>
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
        <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={crearMutation.isPending || soloLectura}>
          <Plus className="w-3.5 h-3.5" /> Agregar
        </Button>
      </div>
      {puedeImportar && (
        <ImportarExogenaDialog
          rentaClienteId={rentaClienteId} seccion={seccion as "activo" | "pasivo"}
          open={showImportarDialog} onOpenChange={setShowImportarDialog}
          onImportado={() => { utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion }); utils.renta.reportes.resumenActual.invalidate({ rentaClienteId }); }}
        />
      )}
    </ColapsableCard>
  );
}

/** Diálogo para elegir manualmente cuáles ítems de la exógena se importan
 * a la cédula actualmente seleccionada — los que no se marquen quedan
 * disponibles para importarse después bajo otra cédula. */
/** Ganancia ocasional — aparte de las 6 cédulas normales, porque cada
 * tipo (loterías/rifas/apuestas 20%, el resto 15%) tiene su propia
 * tarifa fija, no la tabla progresiva del Art. 241. Cada tipo puede
 * tener ingreso bruto, costos, y renta exenta. */
function GananciaOcasionalCard({ rentaClienteId, soloLectura }: { rentaClienteId: number; soloLectura?: boolean }) {
  const utils = trpc.useUtils();
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const itemsQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "cedula" });
  const [tipoGO, setTipoGO] = useState("");
  const [tipoValorGO, setTipoValorGO] = useState("ingreso_bruto");
  const [conceptoGO, setConceptoGO] = useState("");
  const [valorGO, setValorGO] = useState("");

  const invalidar = () => {
    utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "cedula" });
    utils.renta.reportes.resumenActual.invalidate({ rentaClienteId });
  };
  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: () => { setConceptoGO(""); setValorGO(""); invalidar(); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({ onSuccess: invalidar });

  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const itemsGO = (itemsQuery.data || []).filter((it: any) => it.cedula === "ganancia_ocasional");
  const nombreTipoGO = (tipo: string) => catalogoQuery.data?.tiposGananciaOcasional.find((t: any) => t.tipo === tipo)?.nombre || tipo;
  const tarifaTipoGO = (tipo: string) => catalogoQuery.data?.tiposGananciaOcasional.find((t: any) => t.tipo === tipo)?.tarifa;

  const handleAgregar = () => {
    if (!tipoGO || !conceptoGO.trim() || !valorGO) {
      toast.error("Selecciona el tipo de ganancia ocasional, y digita concepto y valor");
      return;
    }
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: "ganancia_ocasional" as any,
      tipoValor: tipoValorGO as any, tipoGananciaOcasional: tipoGO,
      concepto: conceptoGO.trim(), valor: Number(valorGO),
    });
  };

  return (
    <ColapsableCard titulo="Ganancia Ocasional" defaultOpen={false}>
      <p className="text-sm text-muted-foreground">
        Cada tipo tiene su propia tarifa fija (no la tabla progresiva del Art. 241): 20% para loterías,
        rifas y apuestas; 15% para el resto (herencias, legados, donaciones, venta de activos de 2 años o
        más, liquidación de sociedades). Cada uno puede tener ingreso bruto, costos, y renta exenta.
      </p>
      {!!itemsGO.length && (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {itemsGO.map((it: any) => (
            <div key={it.id} className="flex items-center justify-between text-sm border-b py-1.5 gap-2">
              <div className="flex-1 min-w-0">
                <div className="truncate">{it.concepto}</div>
                <div className="text-xs text-muted-foreground">
                  {nombreTipoGO(it.tipoGananciaOcasional)} · {it.tipoValor === "ingreso_bruto" ? "Ingreso bruto" : it.tipoValor === "costo_deduccion_procedente" ? "Costo" : "Renta exenta"}
                  {" "}(tarifa {((tarifaTipoGO(it.tipoGananciaOcasional) || 0) * 100).toFixed(0)}%)
                </div>
              </div>
              <span className="font-medium shrink-0">{fmt(it.valor)}</span>
              {!soloLectura && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {!soloLectura && (
        <div className="grid sm:grid-cols-[1.3fr_1fr_1fr_140px_auto] gap-2 items-end pt-2 border-t">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de ganancia ocasional</Label>
            <Select value={tipoGO} onValueChange={setTipoGO}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
              <SelectContent>
                {catalogoQuery.data?.tiposGananciaOcasional.map((t: any) => (
                  <SelectItem key={t.tipo} value={t.tipo}>{t.nombre} — {(t.tarifa * 100).toFixed(0)}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Valor de</Label>
            <Select value={tipoValorGO} onValueChange={setTipoValorGO}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ingreso_bruto">Ingreso bruto</SelectItem>
                <SelectItem value="costo_deduccion_procedente">Costo</SelectItem>
                <SelectItem value="renta_exenta">Renta exenta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input value={conceptoGO} onChange={(e) => setConceptoGO(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valorGO} onChange={(e) => setValorGO(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={crearMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      )}
    </ColapsableCard>
  );
}

/** Descuentos tributarios (Art. 254-260 E.T. — impuestos pagados en el
 * exterior, donaciones a entidades del régimen especial, etc.) — a
 * diferencia de las deducciones/rentas exentas, estos NO reducen la
 * renta líquida gravable: se restan directamente del impuesto de renta
 * ya calculado, peso a peso. */
function DescuentosTributariosCard({ rentaClienteId, soloLectura }: { rentaClienteId: number; soloLectura?: boolean }) {
  const utils = trpc.useUtils();
  const itemsQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "descuento_tributario" });
  const [concepto, setConcepto] = useState("");
  const [valor, setValor] = useState("");

  const invalidar = () => {
    utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "descuento_tributario" });
    utils.renta.reportes.resumenActual.invalidate({ rentaClienteId });
  };
  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: () => { setConcepto(""); setValor(""); invalidar(); },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({ onSuccess: invalidar });

  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const items = itemsQuery.data || [];
  const total = items.reduce((a: number, it: any) => a + it.valor, 0);

  const handleAgregar = () => {
    if (!concepto.trim() || !valor) return;
    crearMutation.mutate({ rentaClienteId, seccion: "descuento_tributario" as any, concepto: concepto.trim(), valor: Number(valor) });
  };

  return (
    <ColapsableCard titulo="Descuentos Tributarios" defaultOpen={false}>
      <p className="text-sm text-muted-foreground">
        Impuestos pagados en el exterior, donaciones a entidades del régimen especial, y otros descuentos
        tributarios (Art. 254-260 E.T.) — se restan directamente del impuesto de renta ya calculado, no de
        la base gravable.
      </p>
      {!!items.length && (
        <div className="space-y-1">
          {items.map((it: any) => (
            <div key={it.id} className="flex items-center justify-between text-sm border-b py-1.5 gap-2">
              <span className="flex-1 min-w-0 truncate">{it.concepto}</span>
              <span className="font-medium shrink-0">{fmt(it.valor)}</span>
              {!soloLectura && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between text-base font-bold pt-1.5 border-t">
        <span>Total descuentos tributarios</span><span>{fmt(total)}</span>
      </div>
      {!soloLectura && (
        <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2 items-end pt-1">
          <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregar} disabled={crearMutation.isPending}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      )}
    </ColapsableCard>
  );
}


function ImportarExogenaDialog({ rentaClienteId, seccion, cedula, open, onOpenChange, onImportado }: {
  rentaClienteId: number; seccion: "activo" | "pasivo" | "ingreso" | "retencion"; cedula?: string; open: boolean; onOpenChange: (open: boolean) => void; onImportado: () => void;
}) {
  const disponiblesQuery = trpc.renta.liquidacion.exogenaDisponibles.useQuery(
    { rentaClienteId, seccion }, { enabled: open },
  );
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const nombreSeccion = seccion === "activo" ? "activos" : seccion === "pasivo" ? "pasivos" : seccion === "retencion" ? "retenciones" : "ingresos";

  const importarMutation = trpc.renta.liquidacion.importarSeleccionDesdeExogena.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.importados} ítem(s) importado(s)${cedula ? " a esta cédula" : ""}`);
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
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto overflow-x-hidden min-w-0">
        <DialogHeader>
          <DialogTitle>Elegir {nombreSeccion} a importar{cedula ? " en esta cédula" : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2 min-w-0">
          <p className="text-sm text-muted-foreground">
            Los que no marques quedan disponibles para importarlos después{cedula ? " bajo otra cédula" : ""}.
          </p>
          {disponiblesQuery.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : !disponiblesQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">No hay {nombreSeccion} de la exógena pendientes por importar.</p>
          ) : (
            <div className="space-y-1 min-w-0">
              {disponiblesQuery.data.map((item: any) => (
                <label key={item.id} className="flex items-start gap-2 text-sm border-b py-1.5 cursor-pointer min-w-0">
                  <Checkbox checked={seleccionados.has(item.id)} onCheckedChange={() => toggle(item.id)} className="mt-0.5 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{item.nombreTercero || "(tercero sin nombre en el archivo)"}</span>
                    <span className="block text-xs text-muted-foreground truncate">{item.detalle}</span>
                  </span>
                  <span className="font-medium shrink-0 whitespace-nowrap">{fmt(item.valor)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => importarMutation.mutate({ rentaClienteId, seccion, exogenaItemIds: Array.from(seleccionados), cedula: cedula as any })}
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

function IngresosDeduccionesPorCedulaCard({ rentaClienteId, soloLectura }: { rentaClienteId: number; soloLectura?: boolean }) {
  const utils = trpc.useUtils();
  const catalogoQuery = trpc.renta.liquidacion.catalogoTopes.useQuery();
  const dependientesQuery = trpc.renta.dependientes.list.useQuery({ rentaClienteId });
  const [cedulaSeleccionada, setCedulaSeleccionada] = useState("trabajo");
  const [showImportarDialog, setShowImportarDialog] = useState(false);
  const [showImportarRetencionDialog, setShowImportarRetencionDialog] = useState(false);

  const cedulaItemsQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "cedula" });

  const [conceptoIngresoBruto, setConceptoIngresoBruto] = useState("");
  const [valorIngresoBruto, setValorIngresoBruto] = useState("");
  const [conceptoIncrngo, setConceptoIncrngo] = useState("");
  const [valorIncrngo, setValorIncrngo] = useState("");
  const [conceptoCostos, setConceptoCostos] = useState("");
  const [valorCostos, setValorCostos] = useState("");
  const [tipoDeduccion, setTipoDeduccion] = useState("");
  const [conceptoDeduccion, setConceptoDeduccion] = useState("");
  const [valorDeduccion, setValorDeduccion] = useState("");
  const [limiteGeneralNuevo, setLimiteGeneralNuevo] = useState(false);
  const [calculoAutomaticoNuevo, setCalculoAutomaticoNuevo] = useState(false);
  const [conceptoRetencion, setConceptoRetencion] = useState("");
  const [tipoFueraLimite, setTipoFueraLimite] = useState("");
  const [conceptoFueraLimite, setConceptoFueraLimite] = useState("");
  const [valorFueraLimite, setValorFueraLimite] = useState("");
  const [valorRetencion, setValorRetencion] = useState("");
  const [eliminarId, setEliminarId] = useState<number | null>(null);

  const invalidarTodo = () => {
    utils.renta.liquidacion.list.invalidate({ rentaClienteId, seccion: "cedula" });
    utils.renta.reportes.resumenActual.invalidate({ rentaClienteId });
  };

  const crearMutation = trpc.renta.liquidacion.crear.useMutation({
    onSuccess: (data) => {
      if (data.alerta) toast.warning(data.alerta);
      invalidarTodo();
    },
    onError: (err) => toast.error(err.message || "No se pudo agregar"),
  });
  const eliminarMutation = trpc.renta.liquidacion.eliminar.useMutation({ onSuccess: invalidarTodo });
  const actualizarMutation = trpc.renta.liquidacion.actualizar.useMutation({ onSuccess: invalidarTodo });

  const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const CEDULAS_GENERAL = ["trabajo", "trabajo_honorarios", "capital", "no_laboral"];
  const todosItems = cedulaItemsQuery.data || [];
  const cedulaInfo = catalogoQuery.data?.cedulas.find((c: any) => c.valor === cedulaSeleccionada);
  const tieneCostos = cedulaInfo?.tieneCostos ?? false;

  const itemsDeEstaCedula = todosItems.filter((it: any) => (it.cedula || "trabajo") === cedulaSeleccionada);
  const TIPOS_FUERA_LIMITE = ["dependiente_adicional_72uvt", "exceso_salario_militares", "compras_1pct_fe"];
  const porTipo = (tipo: string) => itemsDeEstaCedula.filter((it: any) => it.tipoValor === tipo && !TIPOS_FUERA_LIMITE.includes(it.tipoDeduccion));
  const porTipoFueraLimite = () => itemsDeEstaCedula.filter((it: any) => TIPOS_FUERA_LIMITE.includes(it.tipoDeduccion));
  const totalPorTipo = (tipo: string) => porTipo(tipo).reduce((a: number, it: any) => a + it.valor, 0);
  const totalLimitadoPorTipo = (tipo: string) => porTipo(tipo).reduce((a: number, it: any) => a + (it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor), 0);

  const totalIngresoBruto = totalPorTipo("ingreso_bruto");
  const totalIncrngo = totalPorTipo("ingreso_no_constitutivo");
  const totalCostos = totalPorTipo("costo_deduccion_procedente");
  const totalDeducciones = totalPorTipo("deduccion");
  const totalDeduccionesLimitado = totalLimitadoPorTipo("deduccion");
  const totalRentasExentas = totalPorTipo("renta_exenta");
  const totalRentasExentasLimitado = totalLimitadoPorTipo("renta_exenta");
  const totalRetenciones = totalPorTipo("retencion");
  const rentaLiquidaEstimadaCedula = totalIngresoBruto - totalIncrngo - totalCostos;

  // Vista previa en vivo mientras se digita — misma lógica que el
  // backend (tope UVT, o el 30% del ingreso bruto de esta cédula para
  // aportes voluntarios), para que el operario vea de una vez cuánto se
  // va a limitar antes de guardar.
  const previewValorLimitado = (tipo: string, valorStr: string): number | null => {
    const valor = Number(valorStr);
    if (!tipo || !valor || Number.isNaN(valor)) return null;
    const info = catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipo);
    if (!info?.topeUVT) return null;
    let tope = redondearPesosDian(info.topeUVT * (catalogoQuery.data?.uvt || 0));
    if (tipo === "aportes_voluntarios_pension_afc") tope = Math.min(tope, Math.round(totalIngresoBruto * 0.30));
    return Math.min(valor, tope);
  };

  const totalGeneral = todosItems
    .filter((it: any) => ["renta_exenta", "deduccion"].includes(it.tipoValor) && CEDULAS_GENERAL.includes(it.cedula || "trabajo") && !TIPOS_FUERA_LIMITE.includes(it.tipoDeduccion))
    .reduce((a: number, it: any) => a + (it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor), 0);
  const totalOtrasCedulas = todosItems
    .filter((it: any) => ["renta_exenta", "deduccion"].includes(it.tipoValor) && !CEDULAS_GENERAL.includes(it.cedula || "trabajo"))
    .reduce((a: number, it: any) => a + (it.valorLimitado ?? it.valor), 0);
  const totalRetencionesGeneral = todosItems.filter((it: any) => it.tipoValor === "retencion").reduce((a: number, it: any) => a + it.valor, 0);
  const topeGlobal = catalogoQuery.data ? redondearPesosDian(catalogoQuery.data.topeGlobalUVT * catalogoQuery.data.uvt) : 0;
  const excedeGlobal = topeGlobal > 0 && totalGeneral > topeGlobal;

  // Costos/deducciones imputables como % de los ingresos brutos de la
  // cédula — la alerta que pidió Arlex para trabajo_honorarios (Art. 336
  // par. 5, referencia usual del 60% en el Ayuda Renta).
  const porcentajeCostos = totalIngresoBruto > 0 ? (totalCostos / totalIngresoBruto) * 100 : 0;
  const excedeCostos60 = cedulaSeleccionada === "trabajo_honorarios" && porcentajeCostos > 60;

  // Sugerencia de deducción por dependientes: 10% de los ingresos brutos
  // de esta cédula, limitado al tope de 384 UVT/año — solo se sugiere si
  // hay al menos un dependiente marcado como "10% ingresos" y todavía no
  // se ha agregado esta deducción específica en esta cédula.
  const dependientesDiez = (dependientesQuery.data || []).filter((d: any) => d.tipoDeduccion === "diez_por_ciento");
  const dependientesAdicionales = (dependientesQuery.data || []).filter((d: any) => d.tipoDeduccion === "adicional_72uvt");
  const yaTieneDependientes = porTipo("deduccion").some((it: any) => it.tipoDeduccion === "dependientes_economicos");
  const topeDependientesUVT = catalogoQuery.data?.tipos.find((t: any) => t.tipo === "dependientes_economicos")?.topeUVT;
  const topeDependientes = topeDependientesUVT && catalogoQuery.data ? redondearPesosDian(topeDependientesUVT * catalogoQuery.data.uvt) : 0;
  const sugerenciaDependientes = Math.min(totalIngresoBruto * 0.10, topeDependientes);
  const mostrarSugerenciaDependientes = dependientesDiez.length > 0 && !yaTieneDependientes
    && ["trabajo", "trabajo_honorarios"].includes(cedulaSeleccionada) && sugerenciaDependientes > 0;

  // Sugerencia de dependientes ADICIONALES (72 UVT c/u, fuera del 40%) —
  // solo en la cédula de trabajo (ahí vive esa sección), y solo para los
  // que todavía no tienen su partida ya cargada (se identifican por
  // nombre, para no duplicar si ya se agregó una vez).
  const itemsAdicionalesYaCargados = new Set(
    itemsDeEstaCedula.filter((it: any) => it.tipoDeduccion === "dependiente_adicional_72uvt").map((it: any) => it.concepto),
  );
  const dependientesAdicionalesFaltantes = cedulaSeleccionada === "trabajo"
    ? dependientesAdicionales.filter((d: any) => !itemsAdicionalesYaCargados.has(d.nombre))
    : [];
  const tope72UVT = catalogoQuery.data?.tipos.find((t: any) => t.tipo === "dependiente_adicional_72uvt")?.topeUVT;
  const valor72UVT = tope72UVT && catalogoQuery.data ? redondearPesosDian(tope72UVT * catalogoQuery.data.uvt) : 0;

  const nombreCatalogo = (tipoDed: string | null | undefined) => catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoDed)?.nombre || tipoDed || "";

  const handleAgregarIngresoBruto = () => {
    if (!conceptoIngresoBruto.trim() || !valorIngresoBruto) return;
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: "ingreso_bruto", concepto: conceptoIngresoBruto.trim(), valor: Number(valorIngresoBruto),
    }, { onSuccess: () => { setConceptoIngresoBruto(""); setValorIngresoBruto(""); } });
  };
  const handleAgregarIncrngo = () => {
    if (!conceptoIncrngo.trim() || !valorIncrngo) return;
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: "ingreso_no_constitutivo", concepto: conceptoIncrngo.trim(), valor: Number(valorIncrngo),
    }, { onSuccess: () => { setConceptoIncrngo(""); setValorIncrngo(""); } });
  };
  const handleAgregarCostos = () => {
    if (!conceptoCostos.trim() || !valorCostos) return;
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: "costo_deduccion_procedente", concepto: conceptoCostos.trim(), valor: Number(valorCostos),
    }, { onSuccess: () => { setConceptoCostos(""); setValorCostos(""); } });
  };
  const handleAgregarDeduccion = () => {
    const esAuto25 = tipoDeduccion === "renta_exenta_25_laboral" && calculoAutomaticoNuevo;
    if (!conceptoDeduccion.trim() || (!esAuto25 && !valorDeduccion) || !tipoDeduccion) {
      toast.error("Selecciona el tipo, y digita concepto y valor");
      return;
    }
    const tipoInfo = catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoDeduccion);
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: (tipoInfo?.tipoValor || "deduccion") as any,
      tipoDeduccion, concepto: conceptoDeduccion.trim(), valor: esAuto25 ? 0 : Number(valorDeduccion),
      limiteGeneral: limiteGeneralNuevo, calculoAutomatico: esAuto25,
    }, { onSuccess: () => { setConceptoDeduccion(""); setValorDeduccion(""); setTipoDeduccion(""); setLimiteGeneralNuevo(false); setCalculoAutomaticoNuevo(false); } });
  };
  const handleAgregarDependientes = () => {
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any, tipoValor: "deduccion",
      tipoDeduccion: "dependientes_economicos",
      concepto: `Deducción por dependientes económicos (10% ingresos, ${dependientesDiez.length} dependiente(s))`,
      valor: Math.round(sugerenciaDependientes),
    });
  };
  const handleAgregarDependientesAdicionales = () => {
    for (const d of dependientesAdicionalesFaltantes) {
      crearMutation.mutate({
        rentaClienteId, seccion: "cedula", cedula: "trabajo", tipoValor: "deduccion",
        tipoDeduccion: "dependiente_adicional_72uvt", concepto: d.nombre, valor: valor72UVT,
      });
    }
  };
  const handleAgregarRetencion = () => {
    if (!conceptoRetencion.trim() || !valorRetencion) return;
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: cedulaSeleccionada as any,
      tipoValor: "retencion", concepto: conceptoRetencion.trim(), valor: Number(valorRetencion),
    }, { onSuccess: () => { setConceptoRetencion(""); setValorRetencion(""); } });
  };
  const handleAgregarFueraLimite = () => {
    if (!conceptoFueraLimite.trim() || !valorFueraLimite || !tipoFueraLimite) {
      toast.error("Selecciona el tipo, y digita concepto y valor");
      return;
    }
    const tipoInfo = catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoFueraLimite);
    crearMutation.mutate({
      rentaClienteId, seccion: "cedula", cedula: "trabajo",
      tipoValor: (tipoInfo?.tipoValor || "deduccion") as any,
      tipoDeduccion: tipoFueraLimite, concepto: conceptoFueraLimite.trim(), valor: Number(valorFueraLimite),
    }, { onSuccess: () => { setConceptoFueraLimite(""); setValorFueraLimite(""); setTipoFueraLimite(""); } });
  };

  return (
    <ColapsableCard titulo="Ingresos, Deducciones y Rentas Exentas por Cédula" defaultOpen={false}>
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

      {/* Ingresos */}
      <div className="border-2 border-green-200 rounded-md p-3 space-y-2 bg-green-50/30">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-green-800">Ingresos</span>
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => setShowImportarDialog(true)} disabled={soloLectura}>
            <FileSpreadsheet className="w-3.5 h-3.5" /> Importar desde exógena
          </Button>
        </div>
        {!!porTipo("ingreso_bruto").length && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {porTipo("ingreso_bruto").map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b py-1 gap-2">
                <span className="flex-1 min-w-0 truncate">{it.concepto}</span>
                {it.origen === "exogena" && <Badge variant="outline" className="text-[10px] shrink-0">Exógena</Badge>}
                <span className="shrink-0">{fmt(it.valor)}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-base font-bold text-green-800 pt-1.5 border-t border-green-200">
          <span>Total ingresos brutos</span><span>{fmt(totalIngresoBruto)}</span>
        </div>
        <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2 items-end pt-1">
          <Input value={conceptoIngresoBruto} onChange={(e) => setConceptoIngresoBruto(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valorIngresoBruto} onChange={(e) => setValorIngresoBruto(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarIngresoBruto} disabled={crearMutation.isPending || soloLectura}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </div>

      {/* INCRNGO */}
      <div className="border-2 border-blue-200 rounded-md p-3 space-y-2 bg-blue-50/30">
        <span className="text-sm font-semibold text-blue-800">INCRNGO — Ingresos no constitutivos de renta ni ganancia ocasional</span>
        {!!porTipo("ingreso_no_constitutivo").length && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {porTipo("ingreso_no_constitutivo").map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b py-1 gap-2">
                <span className="flex-1 min-w-0 truncate">{it.concepto}</span>
                <span className="shrink-0">{fmt(it.valor)}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-base font-bold text-blue-800 pt-1.5 border-t border-blue-200">
          <span>Total INCRNGO</span><span>{fmt(totalIncrngo)}</span>
        </div>
        <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2 items-end pt-1">
          <Input value={conceptoIncrngo} onChange={(e) => setConceptoIncrngo(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valorIncrngo} onChange={(e) => setValorIncrngo(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarIncrngo} disabled={crearMutation.isPending || soloLectura}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </div>

      {/* Costos y deducciones imputables (solo cédulas con costos) */}
      {tieneCostos && (
        <div className={`border-2 rounded-md p-3 space-y-2 ${excedeCostos60 ? "border-red-300 bg-red-50/40" : "border-orange-200 bg-orange-50/30"}`}>
          <span className={`text-sm font-semibold ${excedeCostos60 ? "text-red-800" : "text-orange-800"}`}>Costos y deducciones imputables/procedentes</span>
          {!!porTipo("costo_deduccion_procedente").length && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {porTipo("costo_deduccion_procedente").map((it: any) => (
                <div key={it.id} className="flex items-center justify-between text-sm border-b py-1 gap-2">
                  <span className="flex-1 min-w-0 truncate">{it.concepto}</span>
                  <span className="shrink-0">{fmt(it.valor)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
          <div className={`flex items-center justify-between text-base font-bold pt-1.5 border-t ${excedeCostos60 ? "text-red-800 border-red-200" : "text-orange-800 border-orange-200"}`}>
            <span className="flex items-center gap-1.5">
              {excedeCostos60 && <AlertTriangle className="w-4 h-4" />}
              Total costos/deducciones imputables {totalIngresoBruto > 0 && `(${porcentajeCostos.toFixed(1)}% de los ingresos)`}
            </span>
            <span>{fmt(totalCostos)}</span>
          </div>
          {excedeCostos60 && (
            <p className="text-xs text-red-700 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Supera el 60% de los ingresos brutos en rentas de trabajo por honorarios — revisar si procede
              (referencia usual del Ayuda Renta, verificar caso a caso).
            </p>
          )}
          <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2 items-end pt-1">
            <Input value={conceptoCostos} onChange={(e) => setConceptoCostos(e.target.value)} placeholder="Concepto" className="h-8" />
            <Input value={valorCostos} onChange={(e) => setValorCostos(e.target.value)} placeholder="Valor" type="number" className="h-8" />
            <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarCostos} disabled={crearMutation.isPending || soloLectura}>
              <Plus className="w-3.5 h-3.5" /> Agregar
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm font-medium bg-muted/50 rounded-md px-3 py-2">
        <span>Renta líquida estimada de esta cédula (ingresos − INCRNGO{tieneCostos ? " − costos" : ""})</span>
        <span className="font-bold">{fmt(rentaLiquidaEstimadaCedula)}</span>
      </div>

      {/* Deducciones */}
      <div className="border-2 border-purple-200 rounded-md p-3 space-y-2 bg-purple-50/30">
        <span className="text-sm font-semibold text-purple-800">Deducciones</span>
        {!!porTipo("deduccion").length && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide px-0.5">
              <span className="flex-1">Concepto</span>
              <span className="w-20 text-center shrink-0">Lím. gral.</span>
              <span className="w-24 text-right shrink-0">Digitado</span>
              <span className="w-24 text-right shrink-0">Limitado</span>
              <span className="w-6 shrink-0" />
            </div>
            {porTipo("deduccion").map((it: any) => {
              const limitado = it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor;
              const fueLimitado = limitado < it.valor;
              return (
                <div key={it.id} className="flex items-center text-sm border-b py-1 gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{it.concepto}</div>
                    <div className="text-xs text-muted-foreground">{nombreCatalogo(it.tipoDeduccion)}</div>
                  </div>
                  <span className="w-20 flex justify-center shrink-0">
                    <Checkbox
                      checked={!!it.limiteGeneral}
                      onCheckedChange={(v) => actualizarMutation.mutate({ id: it.id, limiteGeneral: !!v })}
                      disabled={soloLectura}
                    />
                  </span>
                  <span className="w-24 text-right shrink-0">{fmt(it.valor)}</span>
                  <span className={`w-24 text-right shrink-0 ${fueLimitado ? "font-semibold text-amber-700" : ""}`}>{fmt(limitado)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              );
            })}
          </div>
        )}
        {mostrarSugerenciaDependientes && (
          <div className="flex items-center justify-between gap-2 bg-purple-100 rounded px-2.5 py-1.5 text-xs">
            <span>Sugerencia: 10% de ingresos por {dependientesDiez.length} dependiente(s), tope aplicado → {fmt(sugerenciaDependientes)}</span>
            <Button size="sm" variant="outline" className="h-6 text-xs shrink-0" onClick={handleAgregarDependientes} disabled={crearMutation.isPending || soloLectura}>
              <Plus className="w-3 h-3 mr-1" /> Agregar
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between text-base font-bold text-purple-800 pt-1.5 border-t border-purple-200">
          <span>Total deducciones {totalDeduccionesLimitado < totalDeducciones && <span className="text-xs font-normal text-muted-foreground">(digitado: {fmt(totalDeducciones)})</span>}</span>
          <span>{fmt(totalDeduccionesLimitado)}</span>
        </div>
        <div className="grid sm:grid-cols-[1.2fr_1fr_120px_120px_auto] gap-2 items-end pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoDeduccion} onValueChange={setTipoDeduccion}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
              <SelectContent>
                {catalogoQuery.data?.tipos.filter((t: any) => t.tipoValor === "deduccion").map((t: any) => (
                  <SelectItem key={t.tipo} value={t.tipo}>{t.nombre}{t.topeUVT ? ` (tope ${t.topeUVT} UVT)` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input value={conceptoDeduccion} onChange={(e) => setConceptoDeduccion(e.target.value)} placeholder="Concepto" className="h-8" />
          <div className="space-y-1">
            <Label className="text-xs">Digitado</Label>
            <Input value={valorDeduccion} onChange={(e) => setValorDeduccion(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Limitado</Label>
            <div className="h-8 flex items-center px-2 text-xs rounded border bg-muted/40 text-muted-foreground">
              {previewValorLimitado(tipoDeduccion, valorDeduccion) != null ? fmt(previewValorLimitado(tipoDeduccion, valorDeduccion)!) : "—"}
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarDeduccion} disabled={crearMutation.isPending || soloLectura}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox checked={limiteGeneralNuevo} onCheckedChange={(v) => setLimiteGeneralNuevo(!!v)} />
          Límite general — si el conjunto de la Cédula General supera el 40%/1.340 UVT, esta partida absorbe el ajuste primero
        </label>
        {catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoDeduccion && t.tipoValor === "deduccion")?.nota && (
          <p className="text-xs text-amber-700 flex items-start gap-1.5 bg-amber-50 rounded p-1.5 mt-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />

            {catalogoQuery.data.tipos.find((t: any) => t.tipo === tipoDeduccion)?.nota}
          </p>
        )}
      </div>

      {/* Rentas Exentas */}
      <div className="border-2 border-teal-200 rounded-md p-3 space-y-2 bg-teal-50/30">
        <span className="text-sm font-semibold text-teal-800">Rentas Exentas</span>
        {!!porTipo("renta_exenta").length && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide px-0.5">
              <span className="flex-1">Concepto</span>
              <span className="w-20 text-center shrink-0">Lím. gral.</span>
              <span className="w-24 text-right shrink-0">Digitado</span>
              <span className="w-24 text-right shrink-0">Limitado</span>
              <span className="w-6 shrink-0" />
            </div>
            {porTipo("renta_exenta").map((it: any) => {
              const limitado = it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor;
              const fueLimitado = limitado < it.valor;
              const esAuto = it.tipoDeduccion === "renta_exenta_25_laboral" && it.calculoAutomatico;
              return (
                <div key={it.id} className="flex items-center text-sm border-b py-1 gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{it.concepto}{esAuto && <span className="ml-1.5 text-[10px] text-teal-700 bg-teal-100 rounded px-1.5 py-0.5">automático</span>}</div>
                    <div className="text-xs text-muted-foreground">{nombreCatalogo(it.tipoDeduccion)}</div>
                  </div>
                  <span className="w-20 flex justify-center shrink-0">
                    <Checkbox
                      checked={!!it.limiteGeneral}
                      onCheckedChange={(v) => actualizarMutation.mutate({ id: it.id, limiteGeneral: !!v })}
                      disabled={soloLectura}
                    />
                  </span>
                  <span className="w-24 text-right shrink-0">{esAuto ? "—" : fmt(it.valor)}</span>
                  <span className={`w-24 text-right shrink-0 ${fueLimitado || esAuto ? "font-semibold text-teal-700" : ""}`}>{fmt(limitado)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between text-base font-bold text-teal-800 pt-1.5 border-t border-teal-200">
          <span>Total rentas exentas {totalRentasExentasLimitado < totalRentasExentas && <span className="text-xs font-normal text-muted-foreground">(digitado: {fmt(totalRentasExentas)})</span>}</span>
          <span>{fmt(totalRentasExentasLimitado)}</span>
        </div>
        <div className="grid sm:grid-cols-[1.2fr_1fr_120px_120px_auto] gap-2 items-end pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoDeduccion} onValueChange={setTipoDeduccion}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
              <SelectContent>
                {catalogoQuery.data?.tipos.filter((t: any) => t.tipoValor === "renta_exenta").map((t: any) => (
                  <SelectItem key={t.tipo} value={t.tipo}>{t.nombre}{t.topeUVT ? ` (tope ${t.topeUVT} UVT)` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input value={conceptoDeduccion} onChange={(e) => setConceptoDeduccion(e.target.value)} placeholder="Concepto" className="h-8" />
          <div className="space-y-1">
            <Label className="text-xs">Digitado</Label>
            <Input
              value={valorDeduccion} onChange={(e) => setValorDeduccion(e.target.value)} placeholder="Valor" type="number" className="h-8"
              disabled={tipoDeduccion === "renta_exenta_25_laboral" && cedulaSeleccionada === "trabajo" && calculoAutomaticoNuevo}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Limitado</Label>
            <div className="h-8 flex items-center px-2 text-xs rounded border bg-muted/40 text-muted-foreground">
              {tipoDeduccion === "renta_exenta_25_laboral" && cedulaSeleccionada === "trabajo" && calculoAutomaticoNuevo
                ? "Se calcula solo"
                : previewValorLimitado(tipoDeduccion, valorDeduccion) != null ? fmt(previewValorLimitado(tipoDeduccion, valorDeduccion)!) : "—"}
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarDeduccion} disabled={crearMutation.isPending || soloLectura}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox checked={limiteGeneralNuevo} onCheckedChange={(v) => setLimiteGeneralNuevo(!!v)} />
          Límite general — si el conjunto de la Cédula General supera el 40%/1.340 UVT, esta partida absorbe el ajuste primero
        </label>
        {tipoDeduccion === "renta_exenta_25_laboral" && cedulaSeleccionada === "trabajo" && (
          <label className="flex items-center gap-1.5 text-xs text-teal-800 cursor-pointer">
            <Checkbox checked={calculoAutomaticoNuevo} onCheckedChange={(v) => setCalculoAutomaticoNuevo(!!v)} />
            Cálculo automático — 25% del ingreso ya depurado de INCRNGO, deducciones y demás rentas exentas de esta cédula (se recalcula solo si algo más cambia)
          </label>
        )}
        {catalogoQuery.data?.tipos.find((t: any) => t.tipo === tipoDeduccion && t.tipoValor === "renta_exenta")?.nota && (
          <p className="text-xs text-amber-700 flex items-start gap-1.5 bg-amber-50 rounded p-1.5 mt-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {catalogoQuery.data.tipos.find((t: any) => t.tipo === tipoDeduccion)?.nota}
          </p>
        )}
      </div>

      {/* Dependiente adicional / Exceso salario militares — fuera del tope del 40% */}
      {cedulaSeleccionada === "trabajo" && (
        <div className="border-2 border-indigo-200 rounded-md p-3 space-y-2 bg-indigo-50/30">
          <span className="text-sm font-semibold text-indigo-800">Rentas de Trabajo — Fuera del límite del 40%</span>
          <p className="text-xs text-muted-foreground">
            Dependiente adicional (72 UVT c/u, máx. 4) y exceso de salario de Fuerzas Militares/Policía — la ley los excluye del tope del 40%/1.340 UVT, así que se calculan aparte y no afectan el reparto de las demás deducciones/rentas exentas.
          </p>
          {!!porTipoFueraLimite().length && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide px-0.5">
                <span className="flex-1">Concepto</span>
                <span className="w-24 text-right shrink-0">Digitado</span>
                <span className="w-24 text-right shrink-0">Limitado</span>
                <span className="w-6 shrink-0" />
              </div>
              {porTipoFueraLimite().map((it: any) => {
                const limitado = it.valorLimitado ?? it.valor;
                const fueLimitado = limitado < it.valor;
                return (
                  <div key={it.id} className="flex items-center text-sm border-b py-1 gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{it.concepto}</div>
                      <div className="text-xs text-muted-foreground">{nombreCatalogo(it.tipoDeduccion)}</div>
                    </div>
                    <span className="w-24 text-right shrink-0">{fmt(it.valor)}</span>
                    <span className={`w-24 text-right shrink-0 ${fueLimitado ? "font-semibold text-indigo-700" : ""}`}>{fmt(limitado)}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                );
              })}
            </div>
          )}
          {(() => {
            const dependientesActuales = porTipoFueraLimite().filter((it: any) => it.tipoDeduccion === "dependiente_adicional_72uvt").length;
            return dependientesActuales >= 4 ? (
              <p className="text-xs text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Ya hay 4 dependientes adicionales cargados — es el máximo que permite la ley, uno más no se contaría en el cálculo.</p>
            ) : null;
          })()}
          {dependientesAdicionalesFaltantes.length > 0 && (
            <div className="flex items-center justify-between gap-2 bg-indigo-100 rounded px-2.5 py-1.5 text-xs">
              <span>
                Sugerencia: {dependientesAdicionalesFaltantes.length} dependiente(s) marcado(s) como "Adicional" en Dependientes económicos aún sin cargar aquí — {dependientesAdicionalesFaltantes.map((d: any) => d.nombre).join(", ")} ({fmt(valor72UVT)} c/u)
              </span>
              <Button size="sm" variant="outline" className="h-6 text-xs shrink-0" onClick={handleAgregarDependientesAdicionales} disabled={crearMutation.isPending || soloLectura}>
                <Plus className="w-3 h-3 mr-1" /> Agregar {dependientesAdicionalesFaltantes.length > 1 ? "todos" : ""}
              </Button>
            </div>
          )}
          <div className="grid sm:grid-cols-[1.2fr_1fr_140px_auto] gap-2 items-end pt-1">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipoFueraLimite} onValueChange={setTipoFueraLimite}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dependiente_adicional_72uvt">Dependiente adicional (72 UVT c/u, máx. 4)</SelectItem>
                  <SelectItem value="exceso_salario_militares">Exceso salario — Fuerzas Militares/Policía</SelectItem>
                  <SelectItem value="compras_1pct_fe">1% compras con factura electrónica y bancarizadas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input value={conceptoFueraLimite} onChange={(e) => setConceptoFueraLimite(e.target.value)} placeholder="Concepto (ej. nombre del dependiente)" className="h-8" />
            <Input value={valorFueraLimite} onChange={(e) => setValorFueraLimite(e.target.value)} placeholder="Valor" type="number" className="h-8" />
            <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarFueraLimite} disabled={crearMutation.isPending || soloLectura}>
              <Plus className="w-3.5 h-3.5" /> Agregar
            </Button>
          </div>
        </div>
      )}

      {/* Retenciones Practicadas */}
      <div className="border-2 border-gray-300 rounded-md p-3 space-y-2 bg-gray-50">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">Retenciones Practicadas</span>
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => setShowImportarRetencionDialog(true)} disabled={soloLectura}>
            <Upload className="w-3.5 h-3.5" /> Importar de exógena
          </Button>
        </div>
        {!!porTipo("retencion").length && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {porTipo("retencion").map((it: any) => (
              <div key={it.id} className="flex items-center justify-between text-sm border-b py-1 gap-2">
                <span className="flex-1 min-w-0 truncate">{it.concepto}</span>
                <span className="shrink-0">{fmt(it.valor)}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" onClick={() => eliminarMutation.mutate({ id: it.id })} disabled={soloLectura}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-base font-bold text-gray-800 pt-1.5 border-t border-gray-300">
          <span>Total retenciones de esta cédula</span><span>{fmt(totalRetenciones)}</span>
        </div>
        <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2 items-end pt-1">
          <Input value={conceptoRetencion} onChange={(e) => setConceptoRetencion(e.target.value)} placeholder="Concepto" className="h-8" />
          <Input value={valorRetencion} onChange={(e) => setValorRetencion(e.target.value)} placeholder="Valor" type="number" className="h-8" />
          <Button size="sm" variant="outline" className="gap-1" onClick={handleAgregarRetencion} disabled={crearMutation.isPending || soloLectura}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </div>

      {/* Totales combinados — siempre sobre TODAS las cédulas, no solo la seleccionada */}
      <div className={`flex items-center justify-between text-sm font-medium border-t pt-2 ${excedeGlobal ? "text-red-600" : ""}`}>
        <span className="flex items-center gap-1.5">
          {excedeGlobal && <AlertTriangle className="w-3.5 h-3.5" />}
          Total Cédula General — deducciones+rentas exentas (tope {catalogoQuery.data?.topeGlobalUVT} UVT / {fmt(topeGlobal)})
        </span>
        <span>{fmt(totalGeneral)}</span>
      </div>
      {totalOtrasCedulas > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Total pensiones / dividendos (aparte, no aplica este tope)</span>
          <span>{fmt(totalOtrasCedulas)}</span>
        </div>
      )}
      {totalRetencionesGeneral > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Total retenciones practicadas (todas las cédulas)</span>
          <span>{fmt(totalRetencionesGeneral)}</span>
        </div>
      )}

      <ImportarExogenaDialog
        rentaClienteId={rentaClienteId} seccion="ingreso" cedula={cedulaSeleccionada}
        open={showImportarDialog} onOpenChange={setShowImportarDialog}
        onImportado={invalidarTodo}
      />
      <ImportarExogenaDialog
        rentaClienteId={rentaClienteId} seccion="retencion" cedula={cedulaSeleccionada}
        open={showImportarRetencionDialog} onOpenChange={setShowImportarRetencionDialog}
        onImportado={invalidarTodo}
      />
    </ColapsableCard>
  );
}

const NOMBRE_SUBRENTA: Record<string, string> = {
  trabajo: "Trabajo (relación laboral)", trabajo_honorarios: "Trabajo por honorarios",
  capital: "Capital", no_laboral: "No laborales",
};

/** Resumen de seguimiento — se actualiza con lo que haya cargado hasta el
 * momento, sin necesidad de generar el Excel cada vez. Empieza con
 * patrimonio, en el medio muestra cada cédula como una lista limpia de
 * ingresos y descuentos (signo +/-) terminando en su total, y cierra con
 * retenciones y los dos métodos de anticipo — ahí ya están todos los
 * insumos para calcularlo. */
function ResumenPendiente210Card({ rentaClienteId }: { rentaClienteId: number }) {
  const resumenQuery = trpc.renta.reportes.resumenActual.useQuery({ rentaClienteId });
  const itemsQuery = trpc.renta.liquidacion.list.useQuery({ rentaClienteId, seccion: "cedula" });
  const fmt = (n: number | null | undefined) => n == null ? "—" : `$${n.toLocaleString("es-CO")}`;
  const fmtFirmado = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("es-CO")}`;
  const r = resumenQuery.data;
  const items = itemsQuery.data || [];

  const isFetching = resumenQuery.isFetching || itemsQuery.isFetching;
  const refetch = () => { resumenQuery.refetch(); itemsQuery.refetch(); };

  const CEDULAS_ORDEN = ["trabajo", "trabajo_honorarios", "capital", "no_laboral"];

  return (
    <ColapsableCard
      titulo="Resumen Declaración Renta 2025"
      extra={
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={refetch} disabled={isFetching}>
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />}
          Actualizar
        </Button>
      }
    >
      {!r ? (
        <p className="text-sm text-muted-foreground">Sin información cargada todavía.</p>
      ) : (
        <div className="space-y-4 text-sm">
          {/* Patrimonio */}
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Activos</div><div className="font-semibold">{fmt(r.patrimonioBruto)}</div></div>
            <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Pasivos</div><div className="font-semibold">{fmt(r.deudas)}</div></div>
            <div className="border rounded-md p-2.5 bg-muted/40"><div className="text-xs text-muted-foreground">Patrimonio líquido</div><div className="font-semibold">{fmt(r.patrimonioLiquido)}</div></div>
          </div>

          {/* Cada cédula como una lista limpia terminando en su total */}
          {CEDULAS_ORDEN.filter(k => items.some((it: any) => (it.cedula || "trabajo") === k && it.tipoValor === "ingreso_bruto")).map((k) => {
            const deEstaCedula = items.filter((it: any) => (it.cedula || "trabajo") === k);
            const linea = (it: any, signo: 1 | -1, etiqueta?: string) => (
              <div key={it.id} className="flex items-center justify-between py-0.5">
                <span className="text-muted-foreground">{it.concepto}{etiqueta && <span className="text-xs"> ({etiqueta})</span>}</span>
                <span className={signo < 0 ? "text-red-600" : ""}>{fmtFirmado(signo * it.valor)}</span>
              </div>
            );
            const lineaLimitada = (it: any, etiqueta: string) => {
              const limitado = it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor;
              const fueLimitado = limitado < it.valor;
              const esFueraLimite = ["dependiente_adicional_72uvt", "exceso_salario_militares", "compras_1pct_fe"].includes(it.tipoDeduccion);
              return (
                <div key={it.id} className="flex items-center justify-between py-0.5 gap-2">
                  <span className="text-muted-foreground flex-1 min-w-0 truncate">
                    {it.concepto} <span className="text-xs">({etiqueta})</span>
                    {esFueraLimite && <span className="ml-1.5 text-[10px] text-indigo-700 bg-indigo-100 rounded px-1.5 py-0.5">fuera del 40%</span>}
                  </span>
                  {fueLimitado && <span className="text-[10px] text-amber-700 shrink-0">(digitado: {fmt(it.valor)})</span>}
                  <span className={`shrink-0 ${fueLimitado ? "font-semibold text-amber-700" : "text-red-600"}`}>{fmtFirmado(-limitado)}</span>
                </div>
              );
            };
            const sr = r.subRentas[k];
            const sumaSimple = deEstaCedula.reduce((a: number, it: any) => {
              if (it.tipoValor === "ingreso_bruto") return a + it.valor;
              if (it.tipoValor === "ingreso_no_constitutivo" || it.tipoValor === "costo_deduccion_procedente") return a - it.valor;
              if (it.tipoValor === "deduccion" || it.tipoValor === "renta_exenta") return a - (it.valorLimitado ?? it.valor);
              return a;
            }, 0);
            const ajustadoPorTope = sr && Math.abs(sumaSimple - sr.rentaLiquidaOrdinaria) > 1;
            const ingresosDeEstaCedula = deEstaCedula.filter((it: any) => it.tipoValor === "ingreso_bruto");
            const totalIngresosCedula = ingresosDeEstaCedula.reduce((a: number, it: any) => a + it.valor, 0);
            const deduccionesRentasExentas = deEstaCedula.filter((it: any) => it.tipoValor === "deduccion" || it.tipoValor === "renta_exenta");
            const esFueraLimiteTipo = (it: any) => ["dependiente_adicional_72uvt", "exceso_salario_militares", "compras_1pct_fe"].includes(it.tipoDeduccion);
            const dentroDelLimite = deduccionesRentasExentas.filter((it: any) => !esFueraLimiteTipo(it));
            const fueraDelLimite = deduccionesRentasExentas.filter((it: any) => esFueraLimiteTipo(it));
            const subtotalDentroLimite = dentroDelLimite.reduce((a: number, it: any) => a + (it.valorAjustadoGeneral ?? it.valorLimitado ?? it.valor), 0);
            const subtotalFueraLimite = fueraDelLimite.reduce((a: number, it: any) => a + (it.valorLimitado ?? it.valor), 0);
            const etiquetaTipo = (it: any) => it.tipoValor === "deduccion" ? "deducción" : "renta exenta";
            return (
              <div key={k} className="border rounded-md p-3">
                <p className="font-semibold text-sm mb-1.5">{NOMBRE_SUBRENTA[k] || k}</p>
                <div className="pl-1">
                  {ingresosDeEstaCedula.map((it: any) => linea(it, 1))}
                  {ingresosDeEstaCedula.length > 1 && (
                    <div className="flex items-center justify-between py-0.5 font-medium border-t"><span>Total ingresos</span><span>{fmt(totalIngresosCedula)}</span></div>
                  )}
                  {deEstaCedula.filter((it: any) => it.tipoValor === "ingreso_no_constitutivo").map((it: any) => linea(it, -1, "INCRNGO"))}
                  {deEstaCedula.filter((it: any) => it.tipoValor === "costo_deduccion_procedente").map((it: any) => linea(it, -1, "costo/deducción procedente"))}
                  {dentroDelLimite.map((it: any) => lineaLimitada(it, etiquetaTipo(it)))}
                </div>
                {deduccionesRentasExentas.length > 0 && (
                  <div className="pl-1 pt-1 mt-1 border-t space-y-0.5 text-xs">
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal dentro del límite del 40%</span><span>{fmt(subtotalDentroLimite)}</span></div>
                  </div>
                )}
                {fueraDelLimite.length > 0 && (
                  <div className="pl-1 pt-1.5 mt-1.5 border-t">
                    <p className="text-xs font-semibold text-indigo-700 mb-1">Fuera del límite del 40%</p>
                    {fueraDelLimite.map((it: any) => lineaLimitada(it, etiquetaTipo(it)))}
                    <div className="flex items-center justify-between text-xs pt-1 mt-1 border-t"><span className="text-muted-foreground">Subtotal fuera del límite del 40%</span><span>{fmt(subtotalFueraLimite)}</span></div>
                  </div>
                )}
                <div className="flex items-center justify-between border-t mt-1.5 pt-1.5 font-bold">
                  <span>Total renta cédula</span>
                  <span>{fmt(sr?.rentaLiquidaOrdinaria)}</span>
                </div>
                {ajustadoPorTope && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Incluye el ajuste del reparto del tope de 1.340 UVT entre las cédulas de la Cédula General.
                  </p>
                )}
              </div>
            );
          })}

          {(r.ingresoBrutoPensiones > 0 || r.ingresoBrutoDividendos > 0) && (
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {r.ingresoBrutoPensiones > 0 && <span>Pensiones — renta líquida gravable: {fmt(r.rentaLiquidaGravablePensiones)}</span>}
              {r.ingresoBrutoDividendos > 0 && <span>Dividendos (referencia, tarifa aparte): {fmt(r.ingresoBrutoDividendos)}</span>}
            </div>
          )}

          {r.gananciaOcasional.totalIngresoBruto > 0 && (
            <div className="border rounded-md p-3">
              <p className="font-semibold text-sm mb-1.5">Ganancia Ocasional (tarifa aparte, no la tabla del Art. 241)</p>
              <div className="space-y-1">
                {Object.entries(r.gananciaOcasional.porTipo).map(([tipo, v]: any) => (
                  <div key={tipo} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{tipo} ({(v.tarifa * 100).toFixed(0)}%)</span>
                    <span>Neto {fmt(v.netoGravable)} → Impuesto {fmt(v.impuesto)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t mt-1.5 pt-1.5 font-bold">
                <span>Total impuesto ganancia ocasional</span>
                <span>{fmt(r.gananciaOcasional.totalImpuesto)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-2 font-semibold text-base">
            <span>Renta líquida gravable total</span>
            <span>{fmt(r.rentaLiquidaGravableTotal)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-base">
            <span>Impuesto de renta ({(r.impuestoRenta.tarifaMarginal * 100).toFixed(0)}%)</span>
            <span>{fmt(r.impuestoRenta.impuesto)}</span>
          </div>
          {r.totalDescuentosTributarios > 0 && (
            <>
              <div className="flex items-center justify-between text-sm text-red-600">
                <span>(-) Descuentos tributarios</span>
                <span>-{fmt(r.totalDescuentosTributarios)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold text-base border-t pt-1.5">
                <span>Impuesto neto de renta</span>
                <span>{fmt(r.impuestoNetoDespuesDescuentos)}</span>
              </div>
            </>
          )}

          {/* Retenciones y anticipo — al final, cuando ya están todos los insumos */}
          <div className="border-t pt-2 grid sm:grid-cols-3 gap-2">
            <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Total retenciones</div><div className="font-semibold">{fmt(r.totalRetenciones)}</div></div>
            <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Anticipo — Método 1 (actual × 75% − ret.)</div><div className="font-semibold">{fmt(r.anticipoMetodo1)}</div></div>
            <div className="border rounded-md p-2.5"><div className="text-xs text-muted-foreground">Anticipo — Método 2 (promedio × 75% − ret.)</div><div className="font-semibold">{fmt(r.anticipoMetodo2)}</div></div>
          </div>
          <p className="text-xs text-muted-foreground">
            Resumen de seguimiento — para el documento formal, usa "Generar borrador" más abajo.
          </p>

          {r.comparacionPatrimonial && (
            <div className={`border rounded-md p-3 ${r.comparacionPatrimonial.excedente > 0 ? "border-amber-300 bg-amber-50/50" : ""}`}>
              <p className="font-semibold text-sm mb-1.5 flex items-center gap-1.5">
                {r.comparacionPatrimonial.excedente > 0 && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                Comparación patrimonial (Arts. 236-239 E.T.)
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Patrimonio líquido año anterior</span><span>{fmt(r.patrimonioLiquidoAnioAnterior)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Patrimonio líquido declarado (año actual)</span><span>{fmt(r.patrimonioLiquido)}</span></div>
                <div className="flex items-center justify-between border-t pt-1"><span className="text-muted-foreground">Diferencia patrimonial (este año − año anterior)</span><span>{fmt(r.comparacionPatrimonial.diferenciaPatrimonial)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">+ Rentas exentas del año</span><span>{fmt(r.comparacionPatrimonial.totalRentasExentas)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">− Impuesto pagado durante el año (retenciones + anticipo)</span><span>{fmt(r.comparacionPatrimonial.impuestoPagadoDuranteElAnio)}</span></div>
                <div className="flex items-center justify-between font-medium border-t pt-1"><span>Renta líquida ajustada</span><span>{fmt(r.comparacionPatrimonial.rentaLiquidaAjustada)}</span></div>
              </div>
              <div className={`flex items-center justify-between border-t mt-1.5 pt-1.5 font-bold ${r.comparacionPatrimonial.excedente > 0 ? "text-amber-700" : ""}`}>
                <span>{r.comparacionPatrimonial.excedente > 0 ? "Incremento patrimonial sin justificar" : "Sin incremento sin justificar"}</span>
                <span>{fmt(Math.max(0, r.comparacionPatrimonial.excedente))}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                No incluye ganancia ocasional (se liquida aparte). Si el excedente es mayor a 0, se considera renta
                gravable adicional salvo que se demuestre causa justificativa.
              </p>
            </div>
          )}

        </div>
      )}
    </ColapsableCard>
  );
}

const ICONO_SEVERIDAD: Record<string, { icon: any; color: string }> = {
  error: { icon: AlertTriangle, color: "text-red-700 bg-red-50 border-red-200" },
  advertencia: { icon: AlertTriangle, color: "text-amber-700 bg-amber-50 border-amber-200" },
  info: { icon: CheckCircle2, color: "text-blue-700 bg-blue-50 border-blue-200" },
};

/** Corre las validaciones de topes (individuales y generales) y muestra
 * las recomendaciones que se han ido incorporando — pensado para ir
 * creciendo con el tiempo, no es un control cerrado. */
function ValidarRentaCard({ rentaClienteId }: { rentaClienteId: number }) {
  const [ejecutado, setEjecutado] = useState(false);
  const query = trpc.renta.reportes.validarRenta.useQuery({ rentaClienteId }, { enabled: ejecutado });

  const hallazgos = query.data?.hallazgos || [];
  const errores = hallazgos.filter((h: any) => h.severidad === "error");
  const advertencias = hallazgos.filter((h: any) => h.severidad === "advertencia");
  const infos = hallazgos.filter((h: any) => h.severidad === "info");

  return (
    <ColapsableCard titulo="Validar Renta" defaultOpen={false}>
      <p className="text-sm text-muted-foreground">
        Revisa los topes individuales de cada deducción/renta exenta, el tope global de la Cédula General,
        y genera recomendaciones sobre lo que ya está cargado — esta lista se irá ampliando con el tiempo.
      </p>
      <Button
        onClick={() => { setEjecutado(true); query.refetch(); }}
        disabled={query.isFetching}
        className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white"
      >
        {query.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Validar Renta
      </Button>

      {ejecutado && !query.isFetching && (
        hallazgos.length === 0 ? (
          <p className="text-sm text-green-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Sin hallazgos por ahora con lo cargado hasta el momento.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {errores.length} tope(s) excedido(s) · {advertencias.length} advertencia(s) · {infos.length} recomendación(es)
            </p>
            {[...errores, ...advertencias, ...infos].map((h: any, i: number) => {
              const { icon: Icon, color } = ICONO_SEVERIDAD[h.severidad] || ICONO_SEVERIDAD.info;
              return (
                <div key={i} className={`flex items-start gap-2 text-sm border rounded-md p-2.5 ${color}`}>
                  <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-xs uppercase tracking-wide block">{h.categoria}</span>
                    {h.mensaje}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </ColapsableCard>
  );
}

function Borrador210Card({ rentaClienteId, anioGravable }: { rentaClienteId: number; anioGravable: number }) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const reportesQuery = trpc.renta.reportes.list.useQuery({ rentaClienteId });
  const [ultimoResultado, setUltimoResultado] = useState<any | null>(null);
  const [urls, setUrls] = useState<{ excel: string; pdf: string } | null>(null);

  const generarMutation = trpc.renta.reportes.generarBorrador210.useMutation({
    onSuccess: (data) => {
      toast.success("Borrador y anexos generados");
      setUltimoResultado(data.resultado);
      setUrls({ excel: data.signedUrl, pdf: data.signedUrlPdf });
      utils.renta.reportes.list.invalidate({ rentaClienteId });
    },
    onError: (err) => toast.error(err.message || "No se pudo generar el borrador"),
  });

  const fmt = (n: number | null) => n == null ? "—" : `$${n.toLocaleString("es-CO")}`;
  const nombreTipo = (tipo: string) => tipo === "ANEXOS_PDF" ? "Anexos (PDF)" : "Borrador Formulario 210 (Excel)";

  return (
    <ColapsableCard titulo="Borrador Formulario 210 y Anexos" defaultOpen={false}>
      <p className="text-sm text-muted-foreground">
        Reúne los activos, pasivos, ingresos y deducciones/rentas exentas ya cargados, calcula el
        patrimonio líquido, la renta líquida gravable por cédula (con el tope de 1.340 UVT aplicado a la
        Cédula General), y el impuesto según la tabla del Art. 241 E.T. Genera el Excel del borrador y un
        PDF con 2 anexos (detalle de ingresos/INCRNGO/deducciones/exentas, y detalle de activos/pasivos).
        Es un documento de apoyo — no reemplaza la revisión profesional.
      </p>

      <Button
        onClick={() => generarMutation.mutate({ rentaClienteId, anioGravable })}
        disabled={generarMutation.isPending}
        className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white"
      >
        {generarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
        Generar borrador y anexos
      </Button>

      {urls && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(urls.excel, "_blank")}>
            <Download className="w-3.5 h-3.5" /> Descargar Excel (borrador 210)
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(urls.pdf, "_blank")}>
            <Download className="w-3.5 h-3.5" /> Descargar PDF (anexos)
          </Button>
        </div>
      )}

      {ultimoResultado && (
        <div className="border rounded-md p-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between"><span>Patrimonio líquido</span><span className="font-medium">{fmt(ultimoResultado.patrimonioLiquido)}</span></div>
          <div className="flex items-center justify-between"><span>Renta líquida gravable total</span><span className="font-medium">{fmt(ultimoResultado.rentaLiquidaGravableTotal)}</span></div>
          <div className="flex items-center justify-between font-medium border-t pt-1.5">
            <span>Impuesto de renta ({(ultimoResultado.impuestoRenta.tarifaMarginal * 100).toFixed(0)}%)</span>
            <span>{fmt(ultimoResultado.impuestoRenta.impuesto)}</span>
          </div>
          {ultimoResultado.totalDescuentosTributarios > 0 && (
            <>
              <div className="flex items-center justify-between text-red-600">
                <span>(-) Descuentos tributarios</span><span>-{fmt(ultimoResultado.totalDescuentosTributarios)}</span>
              </div>
              <div className="flex items-center justify-between font-medium border-t pt-1.5">
                <span>Impuesto neto de renta</span><span>{fmt(ultimoResultado.impuestoNetoDespuesDescuentos)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Total retenciones practicadas</span><span>{fmt(ultimoResultado.totalRetenciones)}</span>
          </div>
          <div className="border-t pt-1.5 space-y-1">
            <p className="text-xs text-muted-foreground">Anticipo próximo año — dos métodos, elige cuál aplica:</p>
            <div className="flex items-center justify-between">
              <span>Método 1 (impuesto actual × 75% − retenciones)</span><span className="font-medium">{fmt(ultimoResultado.anticipoMetodo1)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Método 2 (promedio actual/anterior × 75% − retenciones)</span><span className="font-medium">{fmt(ultimoResultado.anticipoMetodo2)}</span>
            </div>
          </div>

        </div>
      )}

      {!!reportesQuery.data?.length && (
        <div className="space-y-1 pt-2 border-t">
          <span className="text-xs text-muted-foreground">Generados anteriormente</span>
          {reportesQuery.data.map((r: any) => (
            <ReporteRentaDownloadLink
              key={r.id} id={r.id} fileKey={r.fileKey} fecha={r.createdAt} etiqueta={nombreTipo(r.tipo)}
              esAdmin={user?.role === "admin"} onEliminado={() => utils.renta.reportes.list.invalidate({ rentaClienteId })}
            />
          ))}
        </div>
      )}
    </ColapsableCard>
  );
}

function ReporteRentaDownloadLink({ id, fileKey, fecha, etiqueta, esAdmin, onEliminado }: {
  id: number; fileKey: string; fecha: string; etiqueta?: string; esAdmin: boolean; onEliminado: () => void;
}) {
  const urlQuery = trpc.renta.reportes.getDownloadUrl.useQuery({ fileKey }, { enabled: false });
  const eliminarMutation = trpc.renta.reportes.eliminar.useMutation({
    onSuccess: () => { toast.success("Eliminado"); onEliminado(); },
    onError: (err) => toast.error(err.message || "No se pudo eliminar"),
  });
  const handleClick = async () => {
    const result = await urlQuery.refetch();
    if (result.data?.signedUrl) window.open(result.data.signedUrl, "_blank");
  };
  const handleEliminar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("¿Eliminar este archivo del historial?")) return;
    eliminarMutation.mutate({ id });
  };
  return (
    <div className="flex items-center justify-between text-sm border-b py-1.5 gap-2">
      <button onClick={handleClick} className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:bg-muted/50 rounded px-1">
        <Download className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{etiqueta ? `${etiqueta} — ` : ""}{new Date(fecha).toLocaleString("es-CO")}</span>
      </button>
      {esAdmin && (
        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 shrink-0" onClick={handleEliminar} disabled={eliminarMutation.isPending}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve((reader.result as string).split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/** Carpeta de Drive con los soportes que envía el cliente (ej. el Excel de
 * la exógena) — el enlace se asigna dentro de un diálogo (no queda visible
 * como texto plano); una vez asignado, quedan solo los botones "Cargar
 * soporte" y "Ver carpeta". */
function DriveCard({ rentaClienteId, anioGravable, soloLectura }: { rentaClienteId: number; anioGravable: number; soloLectura?: boolean }) {
  const utils = trpc.useUtils();
  const [showAsignar, setShowAsignar] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [showSubir, setShowSubir] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rentaClienteQuery = trpc.renta.clientes.list.useQuery({ anioGravable });
  const clienteActual = rentaClienteQuery.data?.find((c: any) => c.id === rentaClienteId);

  const guardarMutation = trpc.renta.clientes.guardarDrive.useMutation({
    onSuccess: () => { toast.success("Carpeta guardada"); utils.renta.clientes.list.invalidate(); setShowAsignar(false); },
    onError: (err) => toast.error(err.message || "No se pudo guardar"),
  });
  const subirMutation = trpc.renta.clientes.subirArchivoDrive.useMutation({
    onSuccess: () => { toast.success("Archivo subido a Drive"); setArchivo(null); setShowSubir(false); if (fileRef.current) fileRef.current.value = ""; },
    onError: (err) => toast.error(err.message || "No se pudo subir el archivo"),
  });

  const handleSubir = async () => {
    if (!archivo) return;
    setSubiendo(true);
    try {
      const fileBase64 = await fileToBase64(archivo);
      await subirMutation.mutateAsync({ rentaClienteId, fileName: archivo.name, fileBase64, contentType: archivo.type || "application/octet-stream" });
    } catch (e: any) {
      toast.error(e.message || "Error al leer el archivo");
    } finally {
      setSubiendo(false);
    }
  };

  const abrirAsignar = () => { setDriveUrl(clienteActual?.driveFolderUrl || ""); setShowAsignar(true); };
  const [showSolicitud, setShowSolicitud] = useState(false);

  return (
    <ColapsableCard titulo="Carpeta de Drive (soportes del cliente)">
      <p className="text-sm text-muted-foreground">
        Carpeta donde el cliente envía sus soportes (ej. el Excel de la exógena).
      </p>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowSolicitud(true)}>
        <ClipboardList className="w-3.5 h-3.5" /> Solicitar Documentos
      </Button>
      {!clienteActual?.driveFolderUrl ? (
        soloLectura ? (
          <p className="text-sm text-muted-foreground">Sin carpeta asignada.</p>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={abrirAsignar}>
            <FolderOpen className="w-3.5 h-3.5" /> Asignar carpeta de Drive
          </Button>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {!soloLectura && (
            <Button size="sm" className="gap-1.5 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={() => setShowSubir(true)}>
              <Upload className="w-3.5 h-3.5" /> Cargar soporte
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.open(clienteActual.driveFolderUrl as string, "_blank")}>
            <FolderOpen className="w-3.5 h-3.5" /> Ver carpeta
          </Button>
          {!soloLectura && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={abrirAsignar}>
              <Pencil className="w-3.5 h-3.5" /> Cambiar carpeta
            </Button>
          )}
        </div>
      )}

      <Dialog open={showAsignar} onOpenChange={setShowAsignar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Carpeta de Drive del cliente</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">Enlace de la carpeta</Label>
            <Input value={driveUrl} placeholder="https://drive.google.com/drive/folders/..." onChange={(e) => setDriveUrl(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAsignar(false)}>Cancelar</Button>
            <Button
              onClick={() => guardarMutation.mutate({ rentaClienteId, driveFolderUrl: driveUrl })}
              disabled={guardarMutation.isPending || !driveUrl}
              className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
            >
              {guardarMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSubir} onOpenChange={setShowSubir}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cargar soporte a la carpeta de Drive</DialogTitle></DialogHeader>
          <div className="py-2">
            <input ref={fileRef} type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="text-sm w-full" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubir(false)}>Cancelar</Button>
            <Button onClick={handleSubir} disabled={!archivo || subiendo} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
              {subiendo && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
              Subir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SolicitudDocumentosDialog
        rentaClienteId={rentaClienteId} anioGravable={anioGravable}
        open={showSolicitud} onOpenChange={setShowSolicitud}
      />
    </ColapsableCard>
  );
}

/** Checklist de documentos a solicitarle al cliente — se abre desde la
 * Carpeta de Drive, viene con sugerencias pre-marcadas según lo que la
 * exógena ya trae, se puede ajustar libremente, agregar documentos que no
 * estén en la lista, y dejar observaciones antes de generar el PDF. */
function SolicitudDocumentosDialog({ rentaClienteId, anioGravable, open, onOpenChange }: {
  rentaClienteId: number; anioGravable: number; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const catalogoQuery = trpc.renta.clientes.catalogoDocumentos.useQuery({ rentaClienteId }, { enabled: open });
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [inicializado, setInicializado] = useState(false);
  const [documentosExtra, setDocumentosExtra] = useState<string[]>([]);
  const [nuevoDocumento, setNuevoDocumento] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    if (!open) { setInicializado(false); return; }
    if (catalogoQuery.data && !inicializado) {
      if (catalogoQuery.data.estadoGuardado) {
        // Ya se había marcado algo antes para este cliente — se retoma
        // exactamente como quedó, en vez de recalcular recomendaciones.
        setSeleccionados(new Set(catalogoQuery.data.estadoGuardado.seleccionados));
        setDocumentosExtra(catalogoQuery.data.estadoGuardado.documentosExtra);
        setObservaciones(catalogoQuery.data.estadoGuardado.observaciones);
      } else {
        const recomendados = new Set<string>();
        for (const cat of catalogoQuery.data.categorias) {
          if (catalogoQuery.data.categoriasRecomendadas.includes(cat.categoria)) {
            for (const it of cat.items) recomendados.add(it.id);
          }
        }
        setSeleccionados(recomendados);
      }
      setInicializado(true);
    }
  }, [open, catalogoQuery.data, inicializado]);

  const guardarEstadoMutation = trpc.renta.clientes.guardarEstadoSolicitudDocumentos.useMutation();
  const guardarEstadoActual = () => {
    if (!inicializado) return; // no pisar nada si ni siquiera cargó
    guardarEstadoMutation.mutate({
      rentaClienteId, seleccionados: Array.from(seleccionados), documentosExtra, observaciones,
    });
  };
  const handleCerrar = (siguienteAbierto: boolean) => {
    if (!siguienteAbierto) guardarEstadoActual();
    onOpenChange(siguienteAbierto);
  };

  const generarMutation = trpc.renta.clientes.generarSolicitudDocumentos.useMutation({
    onSuccess: (data) => {
      toast.success("Solicitud generada");
      window.open(data.signedUrl, "_blank");
      guardarEstadoActual();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message || "No se pudo generar el PDF"),
  });

  const toggleItem = (id: string) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleCategoria = (cat: any, marcarTodo: boolean) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      for (const it of cat.items) { if (marcarTodo) next.add(it.id); else next.delete(it.id); }
      return next;
    });
  };
  const agregarDocumentoExtra = () => {
    if (!nuevoDocumento.trim()) return;
    setDocumentosExtra(prev => [...prev, nuevoDocumento.trim()]);
    setNuevoDocumento("");
  };

  const handleGenerar = () => {
    setGenerando(true);
    generarMutation.mutate(
      { rentaClienteId, anioGravable, itemsSeleccionados: Array.from(seleccionados), documentosAdicionales: documentosExtra, observaciones },
      { onSettled: () => setGenerando(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleCerrar}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden min-w-0">
        <DialogHeader>
          <DialogTitle>Solicitud de Documentos al Cliente</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Marca los documentos que le vas a pedir al cliente — las categorías con fondo ámbar son una
          sugerencia según lo que ya trae la exógena cargada, ajusta libremente según lo que necesites.
        </p>
        <div className="space-y-3">
          {catalogoQuery.data?.categorias.map((cat: any) => {
            const recomendada = catalogoQuery.data.categoriasRecomendadas.includes(cat.categoria);
            const todosMarcados = cat.items.every((it: any) => seleccionados.has(it.id));
            return (
              <div key={cat.categoria} className={`border rounded-md p-3 ${recomendada ? "border-amber-300 bg-amber-50/40" : ""}`}>
                <label className="flex items-center gap-2 font-medium text-sm mb-1.5 cursor-pointer">
                  <Checkbox checked={todosMarcados} onCheckedChange={(v) => toggleCategoria(cat, !!v)} />
                  {cat.categoria}
                </label>
                <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1 pl-1">
                  {cat.items.map((it: any) => (
                    <label key={it.id} className="flex items-start gap-2 text-xs cursor-pointer">
                      <Checkbox checked={seleccionados.has(it.id)} onCheckedChange={() => toggleItem(it.id)} className="mt-0.5" />
                      {it.concepto}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="border rounded-md p-3">
            <p className="font-medium text-sm mb-1.5">Otros documentos</p>
            {documentosExtra.length > 0 && (
              <div className="space-y-1 mb-2">
                {documentosExtra.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border-b py-1">
                    <span>{d}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600" onClick={() => setDocumentosExtra(prev => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input value={nuevoDocumento} onChange={(e) => setNuevoDocumento(e.target.value)} placeholder="Documento que se escapó de la lista..." className="h-8" onKeyDown={(e) => { if (e.key === "Enter") agregarDocumentoExtra(); }} />
              <Button size="sm" variant="outline" className="gap-1" onClick={agregarDocumentoExtra}><Plus className="w-3.5 h-3.5" /> Agregar</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Observaciones generales</Label>
            <textarea
              value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
              className="w-full border rounded-md p-2 text-sm min-h-[70px]"
              placeholder="Cualquier indicación adicional para el cliente..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleCerrar(false)}>Cancelar</Button>
          <Button onClick={handleGenerar} disabled={generando} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
            {generando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Generar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NOMBRE_ESTADO_REVISION: Record<string, { texto: string; color: string }> = {
  solicitada: { texto: "Revisión solicitada", color: "bg-amber-50 text-amber-700 border-amber-200" },
  aprobada: { texto: "Revisión aprobada", color: "bg-green-50 text-green-700 border-green-200" },
  rechazada: { texto: "Revisión rechazada", color: "bg-red-50 text-red-700 border-red-200" },
};

/** Flujo de revisión y finalización — solicitar revisión (aparece en la
 * pestaña Revisión del menú), aprobar/rechazar, y una vez aprobada,
 * habilitar la subida de la declaración final con el sello de recibido. */
function RevisionFinalizacionCard({ rentaClienteId, anioGravable }: { rentaClienteId: number; anioGravable: number }) {
  const utils = trpc.useUtils();
  const rentaClienteQuery = trpc.renta.clientes.list.useQuery({ anioGravable });
  const clienteActual = rentaClienteQuery.data?.find((c: any) => c.id === rentaClienteId);
  const [archivoFinal, setArchivoFinal] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidar = () => utils.renta.clientes.list.invalidate();

  const solicitarMutation = trpc.renta.clientes.solicitarRevision.useMutation({
    onSuccess: () => { toast.success("Revisión solicitada"); invalidar(); },
    onError: (err) => toast.error(err.message || "No se pudo solicitar"),
  });
  const subirFinalMutation = trpc.renta.clientes.subirDeclaracionFinal.useMutation({
    onSuccess: () => { toast.success("Declaración final subida — cliente marcado como terminado"); setArchivoFinal(null); if (fileRef.current) fileRef.current.value = ""; invalidar(); },
    onError: (err) => toast.error(err.message || "No se pudo subir la declaración"),
  });

  const handleSubirFinal = async () => {
    if (!archivoFinal) return;
    setSubiendo(true);
    try {
      const fileBase64 = await fileToBase64(archivoFinal);
      await subirFinalMutation.mutateAsync({ rentaClienteId, fileName: archivoFinal.name, fileBase64, contentType: archivoFinal.type || "application/pdf" });
    } catch (e: any) {
      toast.error(e.message || "Error al leer el archivo");
    } finally {
      setSubiendo(false);
    }
  };

  const estado = clienteActual?.estadoRevision;
  const estadoInfo = estado ? NOMBRE_ESTADO_REVISION[estado] : null;

  return (
    <ColapsableCard titulo="Revisión y Finalización" defaultOpen={false}>
      <div className="flex items-center gap-2">
        {estadoInfo ? (
          <Badge variant="outline" className={estadoInfo.color}>{estadoInfo.texto}</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Sin solicitar</Badge>
        )}
        {clienteActual?.terminado && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Terminado</Badge>}
      </div>

      {estado === "rechazada" && clienteActual?.revisionComentario && (
        <p className="text-sm text-red-700 bg-red-50 rounded p-2">Comentario: {clienteActual.revisionComentario}</p>
      )}

      {(!estado || estado === "rechazada") && (
        <Button size="sm" className="gap-1.5 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={() => solicitarMutation.mutate({ rentaClienteId })} disabled={solicitarMutation.isPending}>
          <Send className="w-3.5 h-3.5" /> Solicitar revisión
        </Button>
      )}

      {estado === "solicitada" && (
        <p className="text-sm text-muted-foreground">
          Pendiente de aprobación — se revisa y aprueba/rechaza desde la pestaña Revisión del menú.
        </p>
      )}

      <div className="border-t pt-3 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" /> Subir declaración final (sello de recibido)
        </p>
        {clienteActual?.terminado ? (
          <p className="text-xs text-muted-foreground">Renta terminada — para subir una nueva declaración, reábrela primero desde la pestaña Revisión.</p>
        ) : estado !== "aprobada" ? (
          <p className="text-xs text-muted-foreground">Se habilita una vez la revisión esté aprobada.</p>
        ) : (
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" onChange={(e) => setArchivoFinal(e.target.files?.[0] || null)} className="text-sm flex-1" />
            <Button size="sm" className="gap-1.5 bg-[#EDA011] hover:bg-[#d48f0f] text-white" onClick={handleSubirFinal} disabled={!archivoFinal || subiendo}>
              {subiendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Subir
            </Button>
          </div>
        )}
        {clienteActual?.declaracionFileKey && (
          <DeclaracionFinalDownloadLink fileKey={clienteActual.declaracionFileKey} />
        )}
      </div>
    </ColapsableCard>
  );
}

function DeclaracionFinalDownloadLink({ fileKey }: { fileKey: string }) {
  const urlQuery = trpc.renta.reportes.getDownloadUrl.useQuery({ fileKey }, { enabled: false });
  const handleClick = async () => {
    const result = await urlQuery.refetch();
    if (result.data?.signedUrl) window.open(result.data.signedUrl, "_blank");
  };
  return (
    <button onClick={handleClick} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
      <Download className="w-3.5 h-3.5" /> Ver declaración final subida
    </button>
  );
}
