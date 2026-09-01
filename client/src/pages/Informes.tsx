import { useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  Upload, FileSpreadsheet, Loader2, Download, CheckCircle2, XCircle, Clock, Plus,
  Sparkles, LineChart, Landmark, Banknote, Receipt, Construction,
  BookOpen, Pencil, Check, X, Search, Wrench, FileBarChart,
} from "lucide-react";
import { toast } from "sonner";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const estadoBadge: Record<string, { label: string; className: string; icon: any }> = {
  procesando: { label: "Procesando", className: "bg-yellow-100 text-yellow-700", icon: Clock },
  completado: { label: "Completado", className: "bg-green-100 text-green-700", icon: CheckCircle2 },
  error: { label: "Error", className: "bg-red-100 text-red-700", icon: XCircle },
};

export default function Informes() {
  const { user } = useAuth();
  const now = new Date();
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [nivelERM, setNivelERM] = useState<"resumen" | "detalle">("resumen");
  const [nivelERI, setNivelERI] = useState<"resumen" | "detalle">("resumen");
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subiendoCentros, setSubiendoCentros] = useState(false);
  const fileInputCentrosRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const clientesQuery = trpc.informes.clientes.list.useQuery();

  const cargasQuery = trpc.informes.cargas.list.useQuery(
    { clienteId: clienteId as number, anio },
    { enabled: clienteId !== null },
  );
  const reportesQuery = trpc.informes.reportes.list.useQuery(
    { clienteId: clienteId as number, anio },
    { enabled: clienteId !== null },
  );
  const centrosQuery = trpc.informes.centrosCosto.list.useQuery(
    { clienteId: clienteId as number },
    { enabled: clienteId !== null },
  );
  const cuentasPendientesQuery = trpc.informes.cuentas.pendientesDeNombre.useQuery();

  const generarERMMutation = trpc.informes.reportes.generarERM.useMutation({
    onSuccess: (data) => {
      toast.success("Estado de Resultados Mensual generado");
      window.open(data.signedUrl, "_blank");
      utils.informes.reportes.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo generar el reporte"),
  });
  const generarERIMutation = trpc.informes.reportes.generarERI.useMutation({
    onSuccess: (data) => {
      toast.success("Reporte ERI generado");
      window.open(data.signedUrl, "_blank");
      utils.informes.reportes.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo generar el reporte"),
  });
  const reclasificarMutation = trpc.informes.cuentas.reclasificar.useMutation({
    onSuccess: (data) => {
      if (data.intentadas === 0) {
        toast.info("No hay cuentas pendientes de nombre");
      } else {
        toast.success(`Se reclasificaron ${data.clasificadas} de ${data.intentadas} cuenta(s)`);
      }
      utils.informes.cuentas.pendientesDeNombre.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo reclasificar"),
  });

  function handleSubirArchivo(file: File) {
    if (!clienteId) return;
    setSubiendo(true);
    setProgreso(0);
    const xhr = new XMLHttpRequest();
    const params = new URLSearchParams({
      clienteId: String(clienteId),
      nombreArchivo: file.name,
    });
    xhr.open("POST", `/api/informes/upload?${params.toString()}`);
    xhr.setRequestHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgreso(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setSubiendo(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        const periodosOk = (data.periodos || []).filter((p: any) => !p.error);
        const periodosError = (data.periodos || []).filter((p: any) => p.error);
        const periodosTxt = periodosOk
          .map((p: any) => `${MESES[p.mes - 1]} ${p.anio} (${p.filas.toLocaleString()} filas)`)
          .join(", ");
        if (periodosOk.length > 0) {
          toast.success(
            periodosOk.length > 1
              ? `Se detectaron ${periodosOk.length} periodos: ${periodosTxt}`
              : `Archivo procesado: ${periodosTxt || `${data.totalFilas?.toLocaleString()} filas`}`,
          );
        }
        if (periodosError.length > 0) {
          for (const p of periodosError) {
            toast.error(`${MESES[p.mes - 1]} ${p.anio} no se pudo guardar: ${p.error}`);
          }
        }
        if (data.filasOmitidas > 0) {
          toast.info(`${data.filasOmitidas.toLocaleString()} fila(s) se omitieron (subtotales, anuladas, o sin cuenta/fecha reconocible).`);
        }
        if (data.columnasPorIA) {
          toast.info("Este archivo tenía un formato distinto al habitual — las columnas se identificaron con ayuda de IA.");
        }
        if (data.nombresDeCuentaEncontrados > 0) {
          toast.info(`Se detectaron los nombres de ${data.nombresDeCuentaEncontrados} cuenta(s) directamente en el archivo.`);
        }
        if (data.cuentasNuevas?.length) {
          if (data.clasificacionExitosa) {
            toast.info(`${data.cuentasNuevas.length} cuenta(s) nueva(s) clasificada(s) por IA`);
          } else {
            toast.warning(`${data.cuentasNuevas.length} cuenta(s) nueva(s) encontradas, pero la clasificación por IA falló — puedes reintentarla abajo en "Cuentas sin nombre".`);
          }
        }
        utils.informes.cargas.list.invalidate();
        utils.informes.cuentas.pendientesDeNombre.invalidate();
        utils.informes.cuentas.catalogoCliente.invalidate({ clienteId });
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          toast.error(err.error || "Error al subir el archivo");
        } catch {
          toast.error("Error al subir el archivo");
        }
      }
    };
    xhr.onerror = () => { setSubiendo(false); toast.error("Error de red al subir el archivo"); };
    xhr.send(file);
  }

  function subirCentrosCosto(file: File) {
    if (!clienteId) return;
    setSubiendoCentros(true);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/informes/upload-centros-costo?clienteId=${clienteId}`);
    xhr.setRequestHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    xhr.onload = () => {
      setSubiendoCentros(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        toast.success(`Catálogo cargado: ${data.centrosSembrados} centro(s) sembrado(s)/actualizado(s)`);
        utils.informes.centrosCosto.list.invalidate();
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          toast.error(err.error || "Error al subir el catálogo");
        } catch {
          toast.error("Error al subir el catálogo");
        }
      }
    };
    xhr.onerror = () => { setSubiendoCentros(false); toast.error("Error de red al subir el catálogo"); };
    xhr.send(file);
  }

  const detectarCentrosMutation = trpc.informes.centrosCosto.detectarDesdeSaldos.useMutation({
    onSuccess: (data) => {
      if (data.creados > 0) toast.success(`${data.creados} centro(s) de costo detectado(s) desde los datos ya cargados`);
      else toast.info("No se encontraron centros de costo nuevos en los datos ya cargados");
      utils.informes.centrosCosto.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo detectar"),
  });

  const deduplicarMutation = trpc.informes.cargas.deduplicarSaldos.useMutation({
    onSuccess: (data) => {
      if (data.filasEliminadas > 0) toast.success(`Se encontraron y corrigieron ${data.filasEliminadas} fila(s) duplicada(s) — genera de nuevo los informes para ver los valores correctos.`);
      else toast.info("No se encontraron datos duplicados para este cliente.");
    },
    onError: (err) => toast.error(err.message || "No se pudo reparar"),
  });

  const tieneCentros = !!centrosQuery.data?.length;
  const cuentasPendientes = cuentasPendientesQuery.data || [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold">Informes</h1>
          <p className="text-muted-foreground text-sm">
            Herramientas contables generales — el histórico se guarda por cliente, según cuál selecciones arriba:
            estado de resultados, comparación DIAN, conciliación bancaria, y apoyo de impuestos
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Select value={clienteId ? String(clienteId) : undefined} onValueChange={(v) => setClienteId(Number(v))}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Selecciona un cliente" /></SelectTrigger>
            <SelectContent>
              {clientesQuery.data?.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.razonSocial}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(anio)} onValueChange={(v) => setAnio(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!clienteId ? (
          <p className="text-sm text-muted-foreground">Selecciona un cliente para continuar.</p>
        ) : (
          <Tabs defaultValue="resultados">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="resultados" className="gap-1.5"><LineChart className="w-3.5 h-3.5" /> Estado de Resultados</TabsTrigger>
              <TabsTrigger value="dian" className="gap-1.5"><Landmark className="w-3.5 h-3.5" /> Comparación DIAN</TabsTrigger>
              <TabsTrigger value="bancaria" className="gap-1.5"><Banknote className="w-3.5 h-3.5" /> Conciliación Bancaria</TabsTrigger>
              <TabsTrigger value="impuestos" className="gap-1.5"><Receipt className="w-3.5 h-3.5" /> Apoyo Impuestos</TabsTrigger>
              {user?.role === "admin" && (
                <TabsTrigger value="gestionCliente" className="gap-1.5"><FileBarChart className="w-3.5 h-3.5" /> Gestión Cliente</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="resultados" className="space-y-6 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Upload className="w-4 h-4" /> Cargar libro auxiliar / movimiento
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Libro auxiliar / movimiento del cliente seleccionado arriba. Puede traer un solo mes o
                    varios (ej. un semestre completo) — el periodo de cada fila se detecta automáticamente por su
                    fecha, no hace falta indicarlo. <strong>Si ya cargaste alguno de esos meses antes, el nuevo
                    archivo reemplaza los valores anteriores de ese periodo</strong> — para actualizar un mes en
                    particular, sube un archivo que contenga ese mes (solo o junto con otros); para actualizar todo
                    el año, sube un archivo con todos los meses que quieras corregir.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSubirArchivo(f); }}
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={subiendo}
                    className="gap-2"
                  >
                    {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    {subiendo ? `Subiendo... ${progreso}%` : "Seleccionar archivo"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Cargas de {anio}</CardTitle>
                  <Button
                    size="sm" variant="outline" className="gap-2"
                    onClick={() => clienteId && window.confirm("¿Revisar y reparar posibles datos duplicados de este cliente? Es seguro — solo actúa si encuentra duplicados reales.") && deduplicarMutation.mutate({ clienteId })}
                    disabled={deduplicarMutation.isPending || !clienteId}
                  >
                    {deduplicarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                    Reparar duplicados
                  </Button>
                </CardHeader>
                <CardContent>
                  {cargasQuery.isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : !cargasQuery.data?.length ? (
                    <p className="text-sm text-muted-foreground">Sin cargas para este año todavía.</p>
                  ) : (
                    <div className="space-y-2">
                      {cargasQuery.data.map((c: any) => {
                        const badge = estadoBadge[c.estado] || estadoBadge.procesando;
                        const Icon = badge.icon;
                        return (
                          <div key={c.id} className="border rounded-md p-2 text-sm space-y-1">
                            <div className="flex items-center justify-between">
                              <span>{MESES[c.mes - 1]} — {c.nombreArchivo}</span>
                              <div className="flex items-center gap-2">
                                {c.totalFilas && <span className="text-muted-foreground">{c.totalFilas.toLocaleString()} filas</span>}
                                <Badge className={badge.className}>
                                  <Icon className="w-3 h-3 mr-1" />{badge.label}
                                </Badge>
                              </div>
                            </div>
                            {c.estado === "error" && c.mensajeError && (
                              <p className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">{c.mensajeError}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {cuentasPendientes.length > 0 && (
                <Card className="border-orange-300">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> Cuentas sin nombre ({cuentasPendientes.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Estas cuentas aparecieron en alguna carga pero no se les pudo asignar nombre automáticamente
                      (la clasificación por IA falló esa vez): {cuentasPendientes.slice(0, 15).join(", ")}
                      {cuentasPendientes.length > 15 ? "…" : ""}
                    </p>
                    <Button
                      size="sm" variant="outline" className="gap-2"
                      onClick={() => reclasificarMutation.mutate()}
                      disabled={reclasificarMutation.isPending}
                    >
                      {reclasificarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Reintentar clasificación con IA
                    </Button>
                  </CardContent>
                </Card>
              )}

              <CatalogoClienteCard clienteId={clienteId} />

              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="text-base">Estado de Resultados Mensual Comparativo (principal)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Todo el año {anio} del cliente seleccionado, un mes por columna más el acumulado.
                    Suma todos los centros de costo combinados — sirve igual para clientes con o sin centro de costo,
                    y es la base contra la que se validan los demás informes.
                  </p>
                  <div className="flex items-center gap-3">
                    <Select value={nivelERM} onValueChange={(v) => setNivelERM(v as "resumen" | "detalle")}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="resumen">Resumen (cuentas a 4 dígitos)</SelectItem>
                        <SelectItem value="detalle">Detalle completo (subcuentas)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => generarERMMutation.mutate({ clienteId, anio, nivel: nivelERM })}
                      disabled={generarERMMutation.isPending}
                      className="gap-2"
                    >
                      {generarERMMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                      Generar ERM {anio}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Centros de costo</CardTitle>
                  <input
                    ref={fileInputCentrosRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) subirCentrosCosto(f); }}
                  />
                  <Button
                    size="sm" variant="outline" className="gap-2"
                    onClick={() => clienteId && detectarCentrosMutation.mutate({ clienteId })}
                    disabled={detectarCentrosMutation.isPending || !clienteId}
                  >
                    {detectarCentrosMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    Detectar desde datos ya cargados
                  </Button>
                  <Button
                    size="sm" variant="outline" className="gap-2"
                    onClick={() => fileInputCentrosRef.current?.click()}
                    disabled={subiendoCentros}
                  >
                    {subiendoCentros ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {subiendoCentros ? "Subiendo..." : "Subir catálogo (Excel)"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {centrosQuery.isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : !tieneCentros ? (
                    <p className="text-sm text-muted-foreground">
                      Este cliente todavía no tiene centros de costo. El ERM funciona igual sin ellos; el
                      ERI por centro solo aplica si los defines. Sube un archivo con código y nombre de cada
                      centro (cualquier formato) para sembrarlos de una vez.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {centrosQuery.data!.length} centro(s) de costo definido(s). Puedes volver a subir un
                      archivo en cualquier momento para agregar o actualizar nombres.
                    </p>
                  )}
                </CardContent>
              </Card>

              {tieneCentros && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Generar ERI por centro de costo (derivado)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Mismo formato del ERM (meses en columnas, hasta {MESES[mes - 1]} {anio}) pero en una sola
                      hoja "General" con todos los centros combinados, y una hoja aparte por cada centro de
                      costo con sus propias cuentas 4/5/6.
                    </p>
                    <div className="flex items-center gap-3">
                      <Select value={nivelERI} onValueChange={(v) => setNivelERI(v as "resumen" | "detalle")}>
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="resumen">Resumen (cuentas a 4 dígitos)</SelectItem>
                          <SelectItem value="detalle">Detalle completo (subcuentas)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => generarERIMutation.mutate({ clienteId, anio, mes, nivel: nivelERI })}
                        disabled={generarERIMutation.isPending}
                        className="gap-2"
                      >
                        {generarERIMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                        Generar ERI de {MESES[mes - 1]}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!!reportesQuery.data?.length && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Reportes generados en {anio}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {reportesQuery.data.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                        <span>
                          {r.tipo === "ERM"
                            ? `ERM ${r.anio} (${r.nivel})`
                            : r.tipo === "DIAN"
                              ? `Comparación DIAN ${MESES[r.mes - 1]} ${r.anio}`
                              : `ERI ${MESES[r.mes - 1]} ${r.anio}`}
                        </span>
                        <ReporteDownloadLink fileKey={r.fileKey} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="dian" className="mt-4">
              <ComparacionDianCard clienteId={clienteId} anio={anio} mes={mes} setMes={setMes} reportes={reportesQuery.data} />
            </TabsContent>
            <TabsContent value="bancaria" className="mt-4">
              <ProximamenteCard
                icono={Banknote}
                titulo="Revisión / Conciliación bancaria"
                descripcion="Se sube el extracto bancario y los movimientos de la pasarela de pagos, y se comparan contra el mes de contabilidad."
              />
            </TabsContent>
            <TabsContent value="impuestos" className="mt-4">
              <ProximamenteCard
                icono={Receipt}
                titulo="Apoyo de impuestos"
                descripcion="Consumo, IVA y retención — herramientas de apoyo para la liquidación y revisión de estos impuestos."
              />
            </TabsContent>
            {user?.role === "admin" && (
              <TabsContent value="gestionCliente" className="mt-4">
                <GestionClienteTab clienteId={clienteId as number} anio={anio} mes={mes} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}

function ProximamenteCard({ icono: Icono, titulo, descripcion }: { icono: any; titulo: string; descripcion: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 flex flex-col items-center text-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icono className="w-5 h-5" />
          <Construction className="w-4 h-4" />
        </div>
        <h3 className="font-medium">{titulo}</h3>
        <p className="text-sm text-muted-foreground max-w-md">{descripcion}</p>
        <Badge variant="outline" className="text-xs">En construcción</Badge>
      </CardContent>
    </Card>
  );
}

function ReporteDownloadLink({ fileKey }: { fileKey: string }) {
  const { data, isLoading } = trpc.informes.reportes.getDownloadUrl.useQuery({ fileKey });
  if (isLoading) return <Loader2 className="w-3 h-3 animate-spin" />;
  return (
    <a href={data?.signedUrl} target="_blank" rel="noreferrer">
      <Button size="sm" variant="outline" className="gap-1"><Download className="w-3 h-3" /> Descargar</Button>
    </a>
  );
}

/** Catálogo de nombres de cuenta propio de este cliente — se siembra solo
 * desde el archivo cuando trae nombre de cuenta (ej. "Cuenta contable"), y
 * se puede corregir o agregar a mano para clientes cuyo archivo nunca trae
 * nombre (ej. Colfamil). Tiene prioridad sobre la clasificación genérica de
 * IA al armar los reportes. */
function CatalogoClienteCard({ clienteId }: { clienteId: number }) {
  const utils = trpc.useUtils();
  const { data: catalogo, isLoading } = trpc.informes.cuentas.catalogoCliente.useQuery({ clienteId });
  const actualizarMutation = trpc.informes.cuentas.actualizarNombreCliente.useMutation({
    onSuccess: () => {
      toast.success("Nombre actualizado");
      utils.informes.cuentas.catalogoCliente.invalidate({ clienteId });
    },
    onError: (err) => toast.error(err.message || "No se pudo actualizar"),
  });

  const [editando, setEditando] = useState<string | null>(null);
  const [nombreEdit, setNombreEdit] = useState("");
  const [nuevaCuenta, setNuevaCuenta] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [subiendoCatalogo, setSubiendoCatalogo] = useState(false);
  const fileInputCatalogoRef = useRef<HTMLInputElement>(null);

  const guardarEdicion = (cuenta: string) => {
    if (!nombreEdit.trim()) return;
    actualizarMutation.mutate({ clienteId, cuenta, nombre: nombreEdit.trim() });
    setEditando(null);
  };

  const agregarCuenta = () => {
    if (!nuevaCuenta.trim() || !nuevoNombre.trim()) return;
    actualizarMutation.mutate({ clienteId, cuenta: nuevaCuenta.trim(), nombre: nuevoNombre.trim() });
    setNuevaCuenta("");
    setNuevoNombre("");
  };

  const subirCatalogo = (file: File) => {
    setSubiendoCatalogo(true);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/informes/upload-catalogo?clienteId=${clienteId}`);
    xhr.setRequestHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    xhr.onload = () => {
      setSubiendoCatalogo(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        toast.success(`Catálogo cargado: ${data.cuentasSembradas} cuenta(s) sembradas/actualizadas`);
        utils.informes.cuentas.catalogoCliente.invalidate({ clienteId });
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          toast.error(err.error || "Error al subir el catálogo");
        } catch {
          toast.error("Error al subir el catálogo");
        }
      }
    };
    xhr.onerror = () => { setSubiendoCatalogo(false); toast.error("Error de red al subir el catálogo"); };
    xhr.send(file);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> Catálogo de cuentas de este cliente
        </CardTitle>
        <input
          ref={fileInputCatalogoRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) subirCatalogo(f); }}
        />
        <Button
          size="sm" variant="outline" className="gap-2"
          onClick={() => fileInputCatalogoRef.current?.click()}
          disabled={subiendoCatalogo}
        >
          {subiendoCatalogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {subiendoCatalogo ? "Subiendo..." : "Subir catálogo (Excel)"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          El nombre real que este cliente le da a sus cuentas — se llena solo con lo que traiga el libro
          auxiliar (columna de nombre de cuenta, si existe) y tiene prioridad sobre la clasificación genérica de IA.
          Si tienes el plan de cuentas completo del cliente, súbelo con el botón de arriba (cualquier formato,
          siempre que tenga una columna de código y una de nombre) para sembrarlo todo de una vez. También puedes
          corregir o agregar cuentas una por una abajo.
        </p>

        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : !catalogo?.length ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay nada en este catálogo — se llenará solo si el archivo trae nombres de cuenta,
            o puedes agregar entradas manualmente abajo.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {catalogo.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 text-sm border-b py-1.5">
                <span className="font-mono text-xs w-24 shrink-0">{c.cuenta}</span>
                {editando === c.cuenta ? (
                  <>
                    <Input
                      value={nombreEdit}
                      onChange={(e) => setNombreEdit(e.target.value)}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") guardarEdicion(c.cuenta); }}
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => guardarEdicion(c.cuenta)}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditando(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate">{c.nombre}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {c.origen === "manual" ? "Manual" : "Del archivo"}
                    </Badge>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setEditando(c.cuenta); setNombreEdit(c.nombre); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            value={nuevaCuenta}
            onChange={(e) => setNuevaCuenta(e.target.value)}
            placeholder="Código de cuenta"
            className="h-8 w-36 font-mono text-sm"
          />
          <Input
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            placeholder="Nombre de la cuenta"
            className="h-8 flex-1 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") agregarCuenta(); }}
          />
          <Button size="sm" variant="outline" className="gap-1" onClick={agregarCuenta}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


/** Informe con destino al cliente — resume, en orden cronológico, todo lo
 * hecho por su cuenta durante el mes seleccionado (tareas, vencimientos,
 * revisión, cargues de libro auxiliar, generación de reportes contables).
 * Solo visible para administradores (ver TabsTrigger condicional arriba). */
/** Calcula el lunes de la semana en la que cae una fecha dada (semana
 * de lunes a domingo, convención colombiana habitual). */
function lunesDeLaSemana(fecha: Date): Date {
  const d = new Date(fecha);
  const diaSemana = d.getDay(); // 0=domingo, 1=lunes, ... 6=sábado
  const diasHaciaLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  d.setDate(d.getDate() - diasHaciaLunes);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fechaAInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function GestionClienteTab({ clienteId, anio, mes }: { clienteId: number; anio: number; mes: number }) {
  const [tipoPeriodo, setTipoPeriodo] = useState<"semana" | "quincena" | "mes">("mes");
  const [quincena, setQuincena] = useState<"1" | "2">("1");
  const [semanaInicio, setSemanaInicio] = useState(() => fechaAInputValue(lunesDeLaSemana(new Date())));

  const generarMutation = trpc.informes.gestionCliente.generar.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.totalActividades > 0
          ? `Informe generado — ${data.totalActividades} actividad(es) encontradas`
          : "Informe generado — no se encontraron actividades en el periodo",
      );
      window.open(data.signedUrl, "_blank");
    },
    onError: (err) => toast.error(err.message || "No se pudo generar el informe"),
  });

  // Al cambiar a "semana", se posiciona por defecto en la semana del mes/año
  // ya seleccionados arriba, para no arrancar en una fecha desconectada.
  const handleTipoPeriodo = (nuevo: "semana" | "quincena" | "mes") => {
    if (nuevo === "semana") setSemanaInicio(fechaAInputValue(lunesDeLaSemana(new Date(anio, mes - 1, 1))));
    setTipoPeriodo(nuevo);
  };

  const { fechaInicio, fechaFin, etiquetaPeriodo } = (() => {
    if (tipoPeriodo === "semana") {
      const inicio = new Date(semanaInicio + "T00:00:00");
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + 6);
      fin.setHours(23, 59, 59, 999);
      const fmt = (d: Date) => d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
      return { fechaInicio: inicio, fechaFin: fin, etiquetaPeriodo: `${fmt(inicio)} al ${fmt(fin)}` };
    }
    if (tipoPeriodo === "quincena") {
      const inicio = quincena === "1" ? new Date(anio, mes - 1, 1) : new Date(anio, mes - 1, 16);
      const fin = quincena === "1" ? new Date(anio, mes - 1, 15, 23, 59, 59) : new Date(anio, mes, 0, 23, 59, 59);
      return { fechaInicio: inicio, fechaFin: fin, etiquetaPeriodo: `${quincena === "1" ? "1ra" : "2da"} quincena de ${MESES[mes - 1]} ${anio}` };
    }
    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);
    return { fechaInicio: inicio, fechaFin: fin, etiquetaPeriodo: `${MESES[mes - 1]} ${anio}` };
  })();

  const handleGenerar = () => {
    generarMutation.mutate({ clienteId, fechaInicio: fechaInicio.toISOString(), fechaFin: fechaFin.toISOString() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileBarChart className="w-4 h-4" /> Informe de Gestión al Cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Genera un informe en PDF, con destino al cliente, que resume todas las tareas, vencimientos
          tributarios, revisiones, cargues de libro auxiliar, y generación de reportes contables realizados
          durante el periodo elegido. Incluye la fecha, el detalle, y el responsable de cada actividad.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Periodo</Label>
            <Select value={tipoPeriodo} onValueChange={(v) => handleTipoPeriodo(v as any)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="semana">Semana</SelectItem>
                <SelectItem value="quincena">Quincena</SelectItem>
                <SelectItem value="mes">Mes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tipoPeriodo === "semana" && (
            <div className="space-y-1">
              <Label className="text-xs">Semana que inicia el (lunes)</Label>
              <Input type="date" value={semanaInicio} onChange={(e) => setSemanaInicio(e.target.value)} className="w-40" />
            </div>
          )}

          {tipoPeriodo === "quincena" && (
            <div className="space-y-1">
              <Label className="text-xs">Quincena de {MESES[mes - 1]} {anio}</Label>
              <Select value={quincena} onValueChange={(v) => setQuincena(v as any)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1ra quincena (1 al 15)</SelectItem>
                  <SelectItem value="2">2da quincena (16 al fin de mes)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {tipoPeriodo === "mes" && (
            <p className="text-xs text-muted-foreground pb-2">Usa el mes y año seleccionados arriba.</p>
          )}
        </div>

        <Button onClick={handleGenerar} disabled={generarMutation.isPending} className="gap-2">
          {generarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Generar informe — {etiquetaPeriodo}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Compara el archivo de reporte de documentos de la DIAN contra el libro
 * auxiliar del mismo mes. Cruza primero por número de documento (facturas
 * propias / documento soporte), y lo que no cruza así lo intenta por NIT
 * del tercero + valor (facturas de compra de terceros). Genera un Excel
 * con lo que queda sin contraparte en cada lado. */
function ComparacionDianCard({ clienteId, anio, mes, setMes, reportes }: {
  clienteId: number; anio: number; mes: number; setMes: (m: number) => void; reportes: any[] | undefined;
}) {
  const [archivoDian, setArchivoDian] = useState<File | null>(null);
  const [comparando, setComparando] = useState(false);
  const fileDianRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const auxiliarDisponibleQuery = trpc.informes.dian.auxiliarDisponible.useQuery({ clienteId, anio, mes });

  const compararMutation = trpc.informes.dian.comparar.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Comparación lista: ${data.soloEnDian} en la DIAN sin registrar, ${data.soloEnContabilidad} en contabilidad sin documento electrónico.`,
      );
      window.open(data.signedUrl, "_blank");
      setArchivoDian(null);
      utils.informes.reportes.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo generar la comparación"),
  });

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const hayAuxiliarCargado = !!auxiliarDisponibleQuery.data;
  const puedeComparar = !!archivoDian && hayAuxiliarCargado;
  const comparacionesGeneradas = (reportes || []).filter((r: any) => r.tipo === "DIAN");

  const handleComparar = async () => {
    if (!archivoDian || !puedeComparar) return;
    setComparando(true);
    try {
      const dianBase64 = await fileToBase64(archivoDian);
      await compararMutation.mutateAsync({ clienteId, anio, mes, dianBase64 });
    } catch (error: any) {
      toast.error(error.message || "Error al leer el archivo");
    } finally {
      setComparando(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="w-4 h-4" /> Comparación mensual DIAN vs. contabilidad
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sube el reporte de documentos electrónicos de la DIAN de un mes. Se compara contra el libro
            auxiliar de ese mismo mes que ya cargaste en "Estado de Resultados" — un solo auxiliar sirve de
            base para todo, aquí solo se sube el archivo de la DIAN. Se cruza primero por número de
            documento, y lo que no cruce así se intenta por NIT del tercero + valor. El resultado son dos
            listas: lo que está en contabilidad sin documento electrónico (para verificar si son servicios
            públicos u otros pagos que no lo requieren), y —de especial cuidado— lo que está en la DIAN sin
            registrar en contabilidad.
          </p>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-16">Mes:</span>
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MESES.map((nombre, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {auxiliarDisponibleQuery.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : hayAuxiliarCargado ? (
            <div className="flex items-center gap-2 text-sm bg-green-50 text-green-800 border border-green-200 rounded-md p-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Usando el libro auxiliar ya cargado para {MESES[mes - 1]} {anio}: {auxiliarDisponibleQuery.data!.nombreArchivo}
              {auxiliarDisponibleQuery.data!.totalFilas ? ` (${auxiliarDisponibleQuery.data!.totalFilas!.toLocaleString()} filas)` : ""}.
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm bg-orange-50 text-orange-800 border border-orange-200 rounded-md p-2">
              <XCircle className="w-4 h-4 shrink-0" />
              No hay un libro auxiliar cargado para {MESES[mes - 1]} {anio}. Ve a "Estado de Resultados" y
              súbelo ahí primero — esta pestaña solo necesita el archivo de la DIAN.
            </div>
          )}

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Archivo de la DIAN</span>
            <input
              ref={fileDianRef} type="file" accept=".xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setArchivoDian(f); }}
            />
            <Button variant="outline" size="sm" className="gap-2 w-full sm:w-auto justify-start" onClick={() => fileDianRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> {archivoDian?.name || "Seleccionar archivo"}
            </Button>
          </div>

          <Button
            onClick={handleComparar}
            disabled={!puedeComparar || comparando || compararMutation.isPending}
            className="gap-2"
          >
            {comparando || compararMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Comparar y generar Excel
          </Button>
        </CardContent>
      </Card>

      {comparacionesGeneradas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparaciones generadas en {anio}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {comparacionesGeneradas.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                <span>Comparación DIAN {MESES[r.mes - 1]} {r.anio}</span>
                <ReporteDownloadLink fileKey={r.fileKey} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
