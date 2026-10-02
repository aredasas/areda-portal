import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Loader2, Upload, Download, CheckCircle2, AlertTriangle, Trash2, Scale, FileSpreadsheet, Search } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

/** Pestaña "Balance" de Informes: se sube el balance de prueba de cada
 * mes y se ve el historial como estado de situación financiera, con el
 * estado de conciliación y la observación de cada cuenta. Ese mismo
 * historial es la hoja "ESF" del Estado de Resultados Mensual. */

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MESES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type Esf = inferRouterOutputs<AppRouter>["informes"]["balance"]["esf"];
type Fila = Esf["activo"][number];
type Serie = Esf["resultado"];

function pesos(valor: number): string {
  const abs = Math.abs(valor);
  if (abs < 0.005) return "$0";
  const decimales = abs < 1 ? 2 : 0;
  return `${valor < 0 ? "-" : ""}$${abs.toLocaleString("es-CO", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
}

function aBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1] || "");
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(archivo);
  });
}

export default function BalancePrueba({ clienteId, anio }: { clienteId: number; anio: number }) {
  const utils = trpc.useUtils();
  const esfQuery = trpc.informes.balance.esf.useQuery({ clienteId, anio });
  const refrescar = () => {
    utils.informes.balance.esf.invalidate({ clienteId, anio });
    // El flujo de efectivo toma de aquí los saldos de caja y bancos.
    utils.informes.flujo.informe.invalidate({ clienteId });
  };

  if (esfQuery.isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (esfQuery.error || !esfQuery.data) return <p className="text-sm text-red-700">{esfQuery.error?.message || "No se pudo cargar el balance."}</p>;
  const esf = esfQuery.data;

  return (
    <div className="space-y-6">
      <CargarCard clienteId={clienteId} anio={anio} esf={esf} onCambio={refrescar} />
      {esf.meses.length > 0 && <EsfCard clienteId={clienteId} anio={anio} esf={esf} onCambio={refrescar} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Cargar el balance del mes
// ---------------------------------------------------------------------

function CargarCard({ clienteId, anio, esf, onCambio }: { clienteId: number; anio: number; esf: Esf; onCambio: () => void }) {
  const [mes, setMes] = useState<string>("auto");
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const cargarMutation = trpc.informes.balance.cargar.useMutation();
  const eliminarMutation = trpc.informes.balance.eliminar.useMutation({
    onSuccess: () => { toast.success("Balance eliminado"); onCambio(); },
    onError: (err) => toast.error(err.message || "No se pudo eliminar"),
  });

  const subir = async (archivo: File) => {
    setSubiendo(true);
    try {
      const r = await cargarMutation.mutateAsync({
        clienteId, nombreArchivo: archivo.name, archivoBase64: await aBase64(archivo),
        anio: mes === "auto" ? null : anio, mes: mes === "auto" ? null : Number(mes),
      });
      const periodo = `${MESES[r.mes].toLowerCase()} de ${r.anio}`;
      toast.success(`Balance de ${periodo} cargado`, {
        description: [
          `${r.cuentasDetalle} cuentas de detalle${r.porTercero ? ", sumadas por cuenta (venía por tercero)" : ""}.`,
          r.periodoDetectado ? "El mes se tomó de los títulos del archivo." : "",
          r.anio !== anio ? `Quedó en ${r.anio}: cambia el año arriba para verlo.` : "",
        ].filter(Boolean).join(" "),
        duration: 9000,
      });
      onCambio();
      if (r.anio !== anio) utils.informes.balance.esf.invalidate({ clienteId, anio: r.anio });
    } catch (err: any) {
      toast.error(err?.message || "No se pudo cargar el balance", { duration: 12000 });
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const eliminar = (m: number) => {
    if (!window.confirm(`¿Eliminar el balance de prueba de ${MESES[m].toLowerCase()} de ${anio}? Sale del historial y el flujo de efectivo de ese mes vuelve a pedir los saldos.`)) return;
    eliminarMutation.mutate({ clienteId, anio, mes: m });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" /> Cargar balance de prueba mensual</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          El balance de prueba de un mes, por cuenta o por tercero, con código, nombre, saldo anterior, débito, crédito y saldo final. Las columnas se ubican solas aunque cambie el formato. Si ya hay un balance de ese mes, el nuevo lo reemplaza.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-64" aria-label="Mes del balance"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Tomar el mes del archivo</SelectItem>
              {MESES.slice(1).map((nombre, i) => <SelectItem key={i + 1} value={String(i + 1)}>{nombre} de {anio}</SelectItem>)}
            </SelectContent>
          </Select>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" data-testid="balance-archivo"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} />
          <Button onClick={() => inputRef.current?.click()} disabled={subiendo} className="gap-2">
            {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {subiendo ? "Leyendo el balance…" : "Seleccionar archivo Excel"}
          </Button>
        </div>

        {esf.cargas.length > 0 && (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Mes</th>
                  <th className="px-3 py-2 text-right font-medium">Cuentas</th>
                  <th className="px-3 py-2 text-left font-medium" title="Activo − pasivo − patrimonio − resultado del ejercicio">¿Cuadra el balance?</th>
                  <th className="px-3 py-2 text-left font-medium" title="Débitos − créditos del mes">Movimiento del mes</th>
                  <th className="px-3 py-2 text-left font-medium" title="El saldo anterior de cada cuenta debe ser el saldo final del mes anterior">Empata con el mes anterior</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {esf.cargas.map(c => (
                  <tr key={c.mes} className="align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium">{MESES[c.mes]}</p>
                      <p className="text-[11px] text-muted-foreground max-w-56 truncate" title={c.nombreArchivo}>{c.nombreArchivo}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.cuentasDetalle}
                      {c.porTercero && <p className="text-[11px] text-muted-foreground">por tercero</p>}
                    </td>
                    <td className="px-3 py-2"><Chequeo ok={Math.abs(c.diferenciaEcuacion) < 1} bien="Cuadra" mal={`Descuadre de ${pesos(c.diferenciaEcuacion)}`} /></td>
                    <td className="px-3 py-2">
                      <Chequeo ok={Math.abs(c.diferenciaMovimiento) < 1} bien="Sumas iguales" mal={`Débitos − créditos: ${pesos(c.diferenciaMovimiento)}`} />
                      {c.cuentasInconsistentes > 0 && (
                        <p className="mt-0.5 text-[11px] text-red-700" title="Saldo anterior ± movimiento no da el saldo final">{c.cuentasInconsistentes} cuenta(s) con saldo final que no da</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {c.sinContinuidad === null
                        ? <span className="text-xs text-muted-foreground">{c.mes === 1 ? "Diciembre anterior sin cargar" : `${MESES[c.mes - 1]} sin cargar`}</span>
                        : c.sinContinuidad.cuentas === 0
                          ? <Chequeo ok bien="Empata" mal="" />
                          : (
                            <div>
                              <Chequeo ok={false} bien="" mal={c.sinContinuidad.cuentas === 1 ? "1 cuenta no empata" : `${c.sinContinuidad.cuentas} cuentas no empatan`} />
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                La mayor: <span className="font-mono">{c.sinContinuidad.mayorCuenta}</span> {c.sinContinuidad.mayorNombre} ({pesos(c.sinContinuidad.mayorDiferencia)})
                              </p>
                            </div>
                          )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-700" disabled={eliminarMutation.isPending}
                        onClick={() => eliminar(c.mes)} title={`Eliminar el balance de ${MESES[c.mes].toLowerCase()}`} aria-label={`Eliminar el balance de ${MESES[c.mes].toLowerCase()}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Chequeo({ ok, bien, mal }: { ok: boolean; bien: string; mal: string }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-emerald-700 whitespace-nowrap"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {bien}</span>
    : <span className="inline-flex items-start gap-1 font-medium text-red-700"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {mal}</span>;
}

// ---------------------------------------------------------------------
// Estado de situación financiera comparativo
// ---------------------------------------------------------------------

const ESTADOS = ["OK", "PE", "RE"] as const;
const estadoColor: Record<string, string> = {
  OK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PE: "bg-amber-50 text-amber-800 border-amber-200",
  RE: "bg-red-50 text-red-700 border-red-200",
};

function EsfCard({ clienteId, anio, esf, onCambio }: { clienteId: number; anio: number; esf: Esf; onCambio: () => void }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const utils = trpc.useUtils();
  const ermMutation = trpc.informes.reportes.generarERM.useMutation({
    onSuccess: (data) => { toast.success("Estado de Resultados Mensual generado, con la hoja ESF"); window.open(data.signedUrl, "_blank"); utils.informes.reportes.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo generar el reporte"),
  });
  const { meses } = esf;
  const texto = busqueda.trim().toLowerCase();
  const visible = (f: Fila) =>
    (!texto || f.cuenta.startsWith(texto) || f.nombre.toLowerCase().includes(texto)) &&
    (filtroEstado === "todos" || (filtroEstado === "sin" ? !f.estado : f.estado === filtroEstado));
  const filtrando = !!texto || filtroEstado !== "todos";

  const num = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
  const fija = "sm:sticky sm:left-0 z-10 px-3 py-1.5 text-left";
  const valor = (v: number) => <span className={v < 0 ? "text-red-700" : undefined}>{pesos(v)}</span>;
  const columnas = meses.length + 4; // cuenta, apertura, meses, estado, observaciones

  const filaTotal = (titulo: string, serie: Serie, fuerte = false) => (
    <tr className={`border-t ${fuerte ? "bg-[#F0EBE8] font-semibold" : "bg-muted/40 font-medium"}`}>
      <td className={`${fija} ${fuerte ? "bg-[#F0EBE8]" : "bg-muted"}`}>{titulo}</td>
      <td className={num}>{valor(serie.inicial)}</td>
      {meses.map(m => <td key={m} className={num}>{valor(serie.valores[m])}</td>)}
      <td colSpan={2} />
    </tr>
  );
  const bloque = (titulo: string, filas: Fila[]) => {
    const mostradas = filas.filter(visible);
    return (
      <>
        <tr className="border-t">
          <td className={`${fija} bg-card pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}>{titulo}</td>
          <td colSpan={columnas - 1} />
        </tr>
        {mostradas.length === 0 && (
          <tr><td className={`${fija} bg-card text-xs text-muted-foreground`}>{filtrando && filas.length > 0 ? "Ninguna cuenta coincide con el filtro." : "Sin cuentas."}</td><td colSpan={columnas - 1} /></tr>
        )}
        {mostradas.map(f => (
          <tr key={f.cuenta} className="border-t border-dashed">
            <td className={`${fija} bg-card`}>
              <span className="font-mono text-xs text-muted-foreground">{f.cuenta}</span>
              <span className="ml-2">{f.nombre || <span className="italic text-muted-foreground">Sin nombre</span>}</span>
            </td>
            <td className={num}>{valor(f.inicial)}</td>
            {meses.map(m => <td key={m} className={num}>{valor(f.valores[m])}</td>)}
            <NotaCuenta clienteId={clienteId} fila={f} onCambio={onCambio} />
          </tr>
        ))}
      </>
    );
  };
  const descuadres = esf.cargas.filter(c => Math.abs(c.diferenciaEcuacion) >= 1);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Scale className="w-4 h-4" /> Estado de situación financiera {anio}</CardTitle>
        <Button size="sm" className="gap-2" onClick={() => ermMutation.mutate({ clienteId, anio, nivel: "resumen" })} disabled={ermMutation.isPending}
          title="La hoja ESF sale en el Excel del Estado de Resultados Mensual">
          {ermMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Descargar con el Estado de Resultados
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Historial del balance, un mes por columna. Esta misma tabla es la hoja <span className="font-medium text-foreground">ESF</span> del Excel del Estado de Resultados Mensual. El estado y la observación de cada cuenta se guardan al escribirlos y salen todos los meses.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar cuenta o nombre…" className="h-9 w-64 pl-8 text-sm" aria-label="Buscar cuenta" />
          </div>
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="h-9 w-48" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS.map(e => <SelectItem key={e} value={e}>Estado {e}</SelectItem>)}
              <SelectItem value="sin">Sin estado</SelectItem>
            </SelectContent>
          </Select>
          {filtrando && <span className="text-xs text-muted-foreground">Los totales son de todas las cuentas, no solo de las filtradas.</span>}
        </div>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#42302E] text-white text-xs">
                <th className={`${fija} bg-[#42302E] font-medium min-w-[14rem] w-[14rem] sm:min-w-[21rem] sm:w-[21rem]`}>Cuenta</th>
                <th className="px-3 py-2 text-right font-medium min-w-[8.5rem]">{esf.etiquetaInicial}</th>
                {meses.map(m => <th key={m} className="px-3 py-2 text-right font-medium whitespace-nowrap min-w-[8.5rem]">{MESES_CORTO[m]} {anio}</th>)}
                <th className="px-2 py-2 text-left font-medium min-w-[5.5rem]">Estado</th>
                <th className="px-2 py-2 text-left font-medium min-w-[20rem]">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {bloque("Activo", esf.activo)}
              {filaTotal("TOTAL ACTIVO", esf.totalActivo)}
              {bloque("Pasivo", esf.pasivo)}
              {filaTotal("TOTAL PASIVO", esf.totalPasivo)}
              {bloque("Patrimonio", esf.patrimonio)}
              <tr className="border-t border-dashed">
                <td className={`${fija} bg-card`} title="Ingresos − gastos − costos, acumulado según el mismo balance">Resultado del ejercicio</td>
                <td className={num}>{valor(esf.resultado.inicial)}</td>
                {meses.map(m => <td key={m} className={num}>{valor(esf.resultado.valores[m])}</td>)}
                <td colSpan={2} />
              </tr>
              {filaTotal("TOTAL PATRIMONIO", esf.totalPatrimonio)}
              {filaTotal("PASIVO + PATRIMONIO", esf.pasivoPatrimonio, true)}
              <tr className="border-t bg-muted/40 font-medium">
                <td className={`${fija} bg-muted`}>DIFERENCIA</td>
                {[esf.diferencia.inicial, ...meses.map(m => esf.diferencia.valores[m])].map((v, i) => (
                  <td key={i} className={num}>
                    {Math.abs(v) < 1 ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Cuadra</span> : <span className="text-red-700">{pesos(v)}</span>}
                  </td>
                ))}
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        {descuadres.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              El balance de {descuadres.map(c => `${MESES[c.mes].toLowerCase()} (${pesos(c.diferenciaEcuacion)})`).join(", ")} no cuadra: activo no es igual a pasivo más patrimonio más el resultado del ejercicio. Es un descuadre de la contabilidad, no de la lectura del archivo.
            </span>
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Con el balance cargado, el Flujo de Efectivo toma de aquí los saldos de caja y bancos del mes.
        </p>
      </CardContent>
    </Card>
  );
}

/** Estado (OK / PE / RE) y observación de una cuenta. Se guardan solos:
 * el estado al elegirlo, la observación al salir de la casilla. */
function NotaCuenta({ clienteId, fila, onCambio }: { clienteId: number; fila: Fila; onCambio: () => void }) {
  const [observacion, setObservacion] = useState(fila.observacion || "");
  const mutation = trpc.informes.balance.guardarNota.useMutation({
    onSuccess: onCambio,
    onError: (err) => toast.error(err.message || "No se pudo guardar"),
  });
  const guardar = (estado: Fila["estado"], texto: string) =>
    mutation.mutate({ clienteId, cuenta: fila.cuenta, estado, observacion: texto.trim() || null });

  return (
    <>
      <td className="px-2 py-1">
        <Select value={fila.estado || "sin"} onValueChange={(v) => guardar(v === "sin" ? null : (v as Fila["estado"]), observacion)} disabled={mutation.isPending}>
          <SelectTrigger className={`h-7 w-[4.5rem] px-2 text-xs ${fila.estado ? estadoColor[fila.estado] : "text-muted-foreground"}`} aria-label={`Estado de la cuenta ${fila.cuenta}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sin" className="text-xs">—</SelectItem>
            {ESTADOS.map(e => <SelectItem key={e} value={e} className="text-xs">{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="px-2 py-1">
        <Input
          value={observacion} onChange={(e) => setObservacion(e.target.value)} maxLength={2000} className="h-7 text-xs" aria-label={`Observación de la cuenta ${fila.cuenta}`}
          onBlur={() => { if (observacion.trim() !== (fila.observacion || "")) guardar(fila.estado, observacion); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </td>
    </>
  );
}
