import { useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Upload, FileSpreadsheet, Loader2, Download, CheckCircle2, XCircle, Clock, Plus } from "lucide-react";
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
  const now = new Date();
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [nivelERM, setNivelERM] = useState<"resumen" | "detalle">("resumen");
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const seedColfamilMutation = trpc.informes.centrosCosto.seedColfamil.useMutation({
    onSuccess: () => {
      toast.success("Centros de costo sembrados");
      utils.informes.centrosCosto.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "No se pudo sembrar el catálogo"),
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
        if (data.cuentasNuevas?.length) {
          toast.info(`${data.cuentasNuevas.length} cuenta(s) nueva(s) clasificada(s) por IA`);
        }
        utils.informes.cargas.list.invalidate();
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

  const clienteSeleccionado = clientesQuery.data?.find((c: any) => c.id === clienteId);
  const tieneCentros = !!centrosQuery.data?.length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold">Informes</h1>
          <p className="text-muted-foreground text-sm">
            Estado de Resultados Mensual comparativo, por cliente · con centro de costo opcional
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
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Cargar libro auxiliar / movimiento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Libro auxiliar / movimiento para {clienteSeleccionado?.razonSocial}. Puede traer un solo mes o
                  varios (ej. un semestre completo) — el periodo de cada fila se detecta automáticamente por su
                  fecha, no hace falta indicarlo. Si ya cargaste alguno de esos meses antes, el nuevo archivo
                  reemplaza los valores anteriores de ese periodo.
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
              <CardHeader>
                <CardTitle className="text-base">Cargas de {anio}</CardTitle>
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
                        <div key={c.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                          <span>{MESES[c.mes - 1]} — {c.nombreArchivo}</span>
                          <div className="flex items-center gap-2">
                            {c.totalFilas && <span className="text-muted-foreground">{c.totalFilas.toLocaleString()} filas</span>}
                            <Badge className={badge.className} title={c.estado === "error" ? c.mensajeError : undefined}>
                              <Icon className="w-3 h-3 mr-1" />{badge.label}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="text-base">Estado de Resultados Mensual Comparativo (principal)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Todo el año {anio} de {clienteSeleccionado?.razonSocial}, un mes por columna más el acumulado.
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
              <CardHeader>
                <CardTitle className="text-base">Centros de costo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {centrosQuery.isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : !tieneCentros ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Este cliente todavía no tiene centros de costo. El ERM funciona igual sin ellos; el
                      ERI por centro solo aplica si los defines.
                    </p>
                    <Button
                      size="sm" variant="outline" className="gap-2"
                      onClick={() => seedColfamilMutation.mutate({ clienteId })}
                      disabled={seedColfamilMutation.isPending}
                    >
                      <Plus className="w-3 h-3" /> Sembrar catálogo de Colfamil (23 puntos + Adm)
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {centrosQuery.data!.length} centro(s) de costo definido(s) para este cliente.
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
                    Estado de resultados de {MESES[mes - 1]} {anio} desglosado por centro de costo, con punto
                    de equilibrio y pareto de utilidad sobre todos los meses ya cargados del año.
                  </p>
                  <Button
                    onClick={() => generarERIMutation.mutate({ clienteId, anio, mes })}
                    disabled={generarERIMutation.isPending}
                    className="gap-2"
                  >
                    {generarERIMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Generar ERI de {MESES[mes - 1]}
                  </Button>
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
                        {r.tipo === "ERM" ? `ERM ${r.anio} (${r.nivel})` : `ERI ${MESES[r.mes - 1]} ${r.anio}`}
                      </span>
                      <ReporteDownloadLink fileKey={r.fileKey} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
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
