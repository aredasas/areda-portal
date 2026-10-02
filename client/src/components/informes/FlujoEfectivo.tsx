import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Loader2, Download, CheckCircle2, AlertTriangle, RefreshCw, Wallet, Calculator, Landmark, Pencil, Check, Plus,
  SlidersHorizontal, RotateCcw, ArrowLeftRight,
} from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { SECCIONES_FLUJO, TITULO_SECCION, normalizarPrefijos, parsearPesos, seccionPorDefecto, type SeccionFlujo } from "@shared/flujoEfectivo";

/** Pestaña "Flujo de Efectivo" de Informes. Se arma con el libro auxiliar
 * ya cargado en Estado de Resultados, en cuatro pasos que van de arriba a
 * abajo: qué cuentas son efectivo → calcular cada mes (documentos que
 * mueven esas cuentas, validados por sumas iguales) → digitar los saldos
 * de cada cuenta → el flujo comparativo, conciliado contra esos saldos. */

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MESES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Pesos sin decimales; solo los muestra cuando el valor es de centavos
 * (una variación de −$0,69 no puede verse como "$0"). */
function pesos(valor: number): string {
  const abs = Math.abs(valor);
  if (abs < 0.005) return "$0";
  const decimales = abs < 1 ? 2 : 0;
  return `${valor < 0 ? "-" : ""}$${abs.toLocaleString("es-CO", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
}
const enCaja = (valor: number | null) =>
  valor === null ? "" : valor.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const entero = (n: number) => n.toLocaleString("es-CO");

type Informe = inferRouterOutputs<AppRouter>["informes"]["flujo"]["informe"];

export default function FlujoEfectivo({ clienteId, anio }: { clienteId: number; anio: number }) {
  const utils = trpc.useUtils();
  const informeQuery = trpc.informes.flujo.informe.useQuery({ clienteId, anio });
  const refrescar = () => utils.informes.flujo.informe.invalidate({ clienteId, anio });

  if (informeQuery.isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (informeQuery.error || !informeQuery.data) {
    return <p className="text-sm text-red-700">{informeQuery.error?.message || "No se pudo cargar el flujo de efectivo."}</p>;
  }
  const informe = informeQuery.data;

  return (
    <div className="space-y-6">
      <CuentasEfectivoCard clienteId={clienteId} informe={informe} onCambio={refrescar} />
      <MesesCard clienteId={clienteId} anio={anio} informe={informe} onCambio={refrescar} />
      {informe.meses.length > 0 && (
        <>
          <SaldosCard clienteId={clienteId} anio={anio} informe={informe} onCambio={refrescar} />
          <ComparativoCard clienteId={clienteId} anio={anio} informe={informe} onCambio={refrescar} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 1. Cuentas de efectivo
// ---------------------------------------------------------------------

function CuentasEfectivoCard({ clienteId, informe, onCambio }: { clienteId: number; informe: Informe; onCambio: () => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const guardarMutation = trpc.informes.flujo.guardarCuentasEfectivo.useMutation({
    onSuccess: () => { toast.success("Cuentas de efectivo guardadas"); setEditando(false); onCambio(); },
    onError: (err) => toast.error(err.message || "No se pudieron guardar las cuentas"),
  });
  const guardar = (prefijos: string[]) => {
    const limpios = normalizarPrefijos(prefijos);
    if (limpios.length === 0) { toast.error("Escribe al menos una cuenta (por ejemplo 1105, 1110, 1120)"); return; }
    guardarMutation.mutate({ clienteId, prefijos: limpios });
  };
  const fuera = informe.cuentasDisponibles.filter(c => !c.esEfectivo);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Wallet className="w-4 h-4" /> Cuentas de efectivo y equivalentes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          El flujo se arma con los documentos que mueven estas cuentas. Se escribe el código hasta donde haga falta:
          <span className="font-medium text-foreground"> 1110</span> incluye todas sus subcuentas.
        </p>
        {editando ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus className="h-9 w-72 font-mono text-sm" placeholder="1105, 1110, 1120"
              aria-label="Cuentas de efectivo, separadas por coma"
              onKeyDown={(e) => { if (e.key === "Enter") guardar(texto.split(/[\s,;]+/)); if (e.key === "Escape") setEditando(false); }}
            />
            <Button size="sm" className="gap-1.5" onClick={() => guardar(texto.split(/[\s,;]+/))} disabled={guardarMutation.isPending}>
              {guardarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditando(false)} disabled={guardarMutation.isPending}>Cancelar</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {informe.prefijos.map(p => <Badge key={p} variant="outline" className="font-mono text-sm px-2 py-0.5">{p}</Badge>)}
            <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={() => { setTexto(informe.prefijos.join(", ")); setEditando(true); }}>
              <Pencil className="w-3 h-3" /> Cambiar
            </Button>
            {informe.prefijosPorDefecto && <span className="text-xs text-muted-foreground">Caja, bancos y cuentas de ahorro del PUC; cámbialas si este cliente usa otro plan de cuentas.</span>}
          </div>
        )}
        {fuera.length > 0 && (
          <div className="rounded-md border border-dashed p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Otras cuentas del grupo 11 que trae el auxiliar y <span className="font-medium text-foreground">no</span> están entrando al flujo. Si alguna es efectivo, agrégala:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {fuera.map(c => (
                <Button key={c.cuenta} size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={guardarMutation.isPending}
                  onClick={() => guardar([...informe.prefijos, c.cuenta])} title={`Agregar la cuenta ${c.cuenta} al efectivo`}>
                  <Plus className="w-3 h-3" /> <span className="font-mono">{c.cuenta}</span> {c.nombre && <span className="text-muted-foreground max-w-40 truncate">{c.nombre}</span>}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 2. Meses: cálculo y validación del grupo de documentos
// ---------------------------------------------------------------------

function MesesCard({ clienteId, anio, informe, onCambio }: { clienteId: number; anio: number; informe: Informe; onCambio: () => void }) {
  const [enCurso, setEnCurso] = useState<{ mes: number; i: number; total: number } | null>(null);
  const calcularMutation = trpc.informes.flujo.calcularMes.useMutation();
  const pendientes = informe.estados.filter(e => e.conArchivo && (!e.calculado || e.desactualizado)).map(e => e.mes);

  /** Un mes a la vez: cada uno lee su libro auxiliar completo. */
  const calcular = async (meses: number[]) => {
    let hechos = 0;
    for (let i = 0; i < meses.length; i++) {
      setEnCurso({ mes: meses[i], i: i + 1, total: meses.length });
      try {
        const r = await calcularMutation.mutateAsync({ clienteId, anio, mes: meses[i] });
        hechos++;
        if (r.documentos === 0) toast.warning(`${MESES[meses[i]]}: no hay movimientos en las cuentas de efectivo configuradas`, { duration: 9000 });
        else if (r.descuadrados > 0) toast.warning(`${MESES[meses[i]]}: ${r.descuadrados} documento(s) descuadrado(s)`, { duration: 9000 });
      } catch (err: any) {
        toast.error(`${MESES[meses[i]]}: ${err?.message || "no se pudo calcular"}`, { duration: 12000 });
        break;
      }
      onCambio();
    }
    setEnCurso(null);
    onCambio();
    if (hechos > 0) toast.success(hechos === 1 ? "1 mes calculado" : `${hechos} meses calculados`);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" /> Meses y validación de los documentos</CardTitle>
        {pendientes.length > 0 && (
          <Button size="sm" className="gap-2" onClick={() => calcular(pendientes)} disabled={!!enCurso}>
            {enCurso ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />}
            {enCurso ? `Calculando ${MESES[enCurso.mes]} (${enCurso.i} de ${enCurso.total})…` : pendientes.length === 1 ? `Calcular ${MESES[pendientes[0]]}` : `Calcular ${pendientes.length} meses`}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {informe.estados.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este cliente todavía no tiene libro auxiliar cargado en {anio}. Súbelo en la pestaña <span className="font-medium text-foreground">Estado de Resultados</span>: el flujo usa ese mismo archivo.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              De cada mes se toman los documentos (tipo + número de comprobante) que mueven caja o bancos y se comprueba que tengan sumas iguales.
              {enCurso && " Un auxiliar grande puede tardar uno o dos minutos."}
            </p>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Mes</th>
                    <th className="px-3 py-2 text-left font-medium">Estado</th>
                    <th className="px-3 py-2 text-right font-medium">Documentos</th>
                    <th className="px-3 py-2 text-right font-medium">Líneas</th>
                    <th className="px-3 py-2 text-right font-medium">Débitos</th>
                    <th className="px-3 py-2 text-right font-medium">Créditos</th>
                    <th className="px-3 py-2 text-right font-medium" title="Débitos − créditos del grupo de documentos">Diferencia</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {informe.estados.map(e => {
                    const diferencia = e.totalDebitos - e.totalCreditos;
                    const cuadra = Math.abs(diferencia) < 0.5 && e.descuadrados === 0;
                    return (
                      <tr key={e.mes}>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{MESES[e.mes]}</td>
                        <td className="px-3 py-2"><EstadoMes estado={e} calculando={enCurso?.mes === e.mes} /></td>
                        {e.calculado ? (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums">{entero(e.documentos)}</td>
                            <td className="px-3 py-2 text-right tabular-nums" title={`${entero(e.lineasAuxiliar)} líneas tiene el auxiliar de este mes`}>{entero(e.lineas)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{pesos(e.totalDebitos)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{pesos(e.totalCreditos)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${cuadra ? "text-emerald-700" : "text-red-700 font-medium"}`}>
                              {cuadra ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Sumas iguales</span>
                                : `${pesos(diferencia)}${e.descuadrados > 0 ? ` · ${e.descuadrados} descuadrado(s)` : ""}`}
                            </td>
                          </>
                        ) : <td colSpan={5} className="px-3 py-2 text-xs text-muted-foreground">{e.conArchivo ? "Todavía sin calcular." : "El archivo de este mes no quedó guardado: vuelve a subir el auxiliar en Estado de Resultados."}</td>}
                        <td className="px-2 py-2 text-right">
                          {e.calculado && e.conArchivo && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" disabled={!!enCurso} onClick={() => calcular([e.mes])}
                              title={`Volver a calcular ${MESES[e.mes]}`} aria-label={`Volver a calcular ${MESES[e.mes]}`}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {informe.estados.some(e => e.calculado && !e.desactualizado && e.documentos === 0) && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Hay meses sin ningún movimiento en las cuentas {informe.prefijos.join(", ")}. Lo más probable es que este cliente use otros códigos para caja y bancos: revísalos arriba y vuelve a calcular.</span>
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EstadoMes({ estado, calculando }: { estado: Informe["estados"][number]; calculando: boolean }) {
  if (calculando) return <Badge variant="outline" className="gap-1 bg-blue-50 text-blue-700 border-blue-200"><Loader2 className="w-3 h-3 animate-spin" /> Calculando</Badge>;
  if (estado.desactualizado) return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200" title={estado.motivo || undefined}>Desactualizado</Badge>;
  if (estado.calculado) return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Calculado</Badge>;
  if (!estado.conArchivo) return <Badge variant="outline" className="text-muted-foreground">Sin archivo</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Por calcular</Badge>;
}

// ---------------------------------------------------------------------
// 3. Saldos por cuenta
// ---------------------------------------------------------------------

function SaldosCard({ clienteId, anio, informe, onCambio }: { clienteId: number; anio: number; informe: Informe; onCambio: () => void }) {
  // Abre en el primer mes al que todavía le faltan saldos.
  const [mes, setMes] = useState(() => informe.meses.find(m => !informe.resumen[m].saldosCompletos) ?? informe.meses[informe.meses.length - 1]);
  // Lo que se ha escrito y aún no se guarda. Vive aquí (no se recarga con
  // los datos del servidor) para que no se pierda si la pantalla se
  // actualiza sola mientras se consulta el balance en otra ventana.
  const [digitado, setDigitado] = useState<Record<string, { ini: string; fin: string }>>({});
  const [agregadas, setAgregadas] = useState<string[]>([]);
  const [nueva, setNueva] = useState("");

  const guardarMutation = trpc.informes.flujo.guardarSaldos.useMutation({
    onSuccess: (_data, enviado) => {
      toast.success(`Saldos de ${MESES[enviado.mes].toLowerCase()} guardados`);
      // Lo guardado ya viene del servidor: se suelta lo digitado de ese mes.
      setDigitado(d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${enviado.mes}|`))));
      onCambio();
    },
    onError: (err) => toast.error(err.message || "No se pudieron guardar los saldos"),
  });

  const filas = useMemo(() => {
    const delInforme = informe.efectivo
      .filter(e => e.porMes[mes]?.requerida || e.porMes[mes]?.sugeridoInicial != null)
      .map(e => ({ cuenta: e.cuenta, nombre: e.nombre, ...e.porMes[mes] }));
    const extra = agregadas.filter(c => !delInforme.some(f => f.cuenta === c)).map(cuenta => ({
      cuenta, nombre: informe.efectivo.find(e => e.cuenta === cuenta)?.nombre || "",
      debitos: 0, creditos: 0, variacion: 0, lineas: 0, saldoInicial: null, saldoFinal: null, sugeridoInicial: null,
      finalCalculado: null, diferencia: null, requerida: false,
    }));
    return [...delInforme, ...extra];
  }, [informe, mes, agregadas]);

  const clave = (cuenta: string) => `${mes}|${cuenta}`;
  const texto = (f: (typeof filas)[number]) => digitado[clave(f.cuenta)] ?? { ini: enCaja(f.saldoInicial), fin: enCaja(f.saldoFinal) };
  const escribir = (f: (typeof filas)[number], campo: "ini" | "fin", valor: string) =>
    setDigitado(d => ({ ...d, [clave(f.cuenta)]: { ...texto(f), [campo]: valor } }));
  /** Al salir de la casilla se le pone el formato de miles (si es un número válido). */
  const formatear = (f: (typeof filas)[number], campo: "ini" | "fin") => {
    const n = parsearPesos(texto(f)[campo]);
    if (n !== null) escribir(f, campo, enCaja(n));
  };

  const calculadas = filas.map(f => {
    const t = texto(f);
    const ini = parsearPesos(t.ini);
    const fin = parsearPesos(t.fin);
    const finalCalculado = ini === null ? null : ini + f.variacion;
    return { ...f, t, ini, fin, finalCalculado, diferencia: finalCalculado === null || fin === null ? null : finalCalculado - fin };
  });
  const hayCambios = Object.keys(digitado).some(k => k.startsWith(`${mes}|`));
  const conSugerido = calculadas.filter(f => !f.t.ini.trim() && f.sugeridoInicial != null);
  const mesAnterior = mes === 1 ? `diciembre de ${anio - 1}` : MESES[mes - 1].toLowerCase();
  const suma = (campo: "ini" | "fin" | "finalCalculado" | "diferencia") =>
    calculadas.every(f => f[campo] !== null) && calculadas.length > 0 ? calculadas.reduce((s, f) => s + (f[campo] as number), 0) : null;

  const usarSugeridos = () => setDigitado(d => {
    const copia = { ...d };
    for (const f of conSugerido) {
      const ini = enCaja(f.sugeridoInicial);
      // Una cuenta sin movimiento en el mes termina con el mismo saldo.
      copia[clave(f.cuenta)] = { ini, fin: f.t.fin.trim() || (f.variacion === 0 && f.lineas === 0 ? ini : "") };
    }
    return copia;
  });

  const guardar = () => {
    const saldos: { cuenta: string; saldoInicial: number | null; saldoFinal: number | null }[] = [];
    for (const f of calculadas) {
      for (const [campo, valor, etiqueta] of [["ini", f.ini, "inicial"], ["fin", f.fin, "final"]] as const) {
        if (f.t[campo].trim() && valor === null) { toast.error(`El saldo ${etiqueta} de la cuenta ${f.cuenta} no es un número válido`); return; }
      }
      saldos.push({ cuenta: f.cuenta, saldoInicial: f.ini, saldoFinal: f.fin });
    }
    guardarMutation.mutate({ clienteId, anio, mes, saldos });
  };

  const agregar = () => {
    const cuenta = nueva.replace(/\D/g, "");
    if (cuenta.length < 4) { toast.error("Escribe el código completo de la cuenta"); return; }
    if (!agregadas.includes(cuenta) && !filas.some(f => f.cuenta === cuenta)) setAgregadas(a => [...a, cuenta]);
    setNueva("");
  };

  const celdaNumero = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
  const totalDif = suma("diferencia");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4" /> Saldos de caja y bancos</CardTitle>
        <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
          <SelectTrigger className="w-44 h-9" aria-label="Mes de los saldos"><SelectValue /></SelectTrigger>
          <SelectContent>
            {informe.meses.map(m => (
              <SelectItem key={m} value={String(m)}>{MESES[m]}{informe.resumen[m].saldosCompletos ? "" : " · sin saldos"}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Digita el saldo de cada cuenta al inicio y al final de {MESES[mes].toLowerCase()}, tal como está en el balance. Con el inicial, el portal calcula a cuánto debería cerrar cada cuenta y lo compara con el final que digites.
        </p>
        {conSugerido.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2">
            <span className="text-xs text-muted-foreground flex-1 min-w-48">
              {conSugerido.length === 1 ? "Hay 1 cuenta" : `Hay ${conSugerido.length} cuentas`} con saldo final guardado en {mesAnterior}: puede servir como saldo inicial.
            </span>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={usarSugeridos}>
              <ArrowLeftRight className="w-3 h-3" /> Traer saldos de {mesAnterior}
            </Button>
          </div>
        )}
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Cuenta</th>
                <th className="px-3 py-2 text-right font-medium w-40">Saldo inicial</th>
                <th className="px-3 py-2 text-right font-medium" title="Débitos − créditos de la cuenta en el mes, según el auxiliar">Movimiento del mes</th>
                <th className="px-3 py-2 text-right font-medium">Final calculado</th>
                <th className="px-3 py-2 text-right font-medium w-40">Saldo final</th>
                <th className="px-3 py-2 text-right font-medium" title="Final calculado − saldo final digitado">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {calculadas.map(f => (
                <tr key={f.cuenta}>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs">{f.cuenta}</span>
                    {f.nombre && <span className="ml-2 text-xs text-muted-foreground">{f.nombre}</span>}
                  </td>
                  <td className="px-2 py-1">
                    <Input value={f.t.ini} onChange={(e) => escribir(f, "ini", e.target.value)} onBlur={() => formatear(f, "ini")} inputMode="decimal"
                      placeholder={f.sugeridoInicial != null ? enCaja(f.sugeridoInicial) : ""} aria-label={`Saldo inicial de la cuenta ${f.cuenta}`}
                      className={`h-8 text-right tabular-nums text-sm ${f.t.ini.trim() && f.ini === null ? "border-red-400" : ""}`} />
                  </td>
                  <td className={`${celdaNumero} ${f.variacion < 0 ? "text-red-700" : ""}`}>{pesos(f.variacion)}</td>
                  <td className={`${celdaNumero} text-muted-foreground`}>{f.finalCalculado === null ? "—" : pesos(f.finalCalculado)}</td>
                  <td className="px-2 py-1">
                    <Input value={f.t.fin} onChange={(e) => escribir(f, "fin", e.target.value)} onBlur={() => formatear(f, "fin")} inputMode="decimal"
                      aria-label={`Saldo final de la cuenta ${f.cuenta}`}
                      className={`h-8 text-right tabular-nums text-sm ${f.t.fin.trim() && f.fin === null ? "border-red-400" : ""}`} />
                  </td>
                  <td className={celdaNumero}><Diferencia valor={f.diferencia} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-medium">
                <td className="px-3 py-2">Total efectivo</td>
                <td className={`${celdaNumero} pr-5`}>{suma("ini") === null ? "—" : pesos(suma("ini")!)}</td>
                <td className={celdaNumero}>{pesos(calculadas.reduce((s, f) => s + f.variacion, 0))}</td>
                <td className={celdaNumero}>{suma("finalCalculado") === null ? "—" : pesos(suma("finalCalculado")!)}</td>
                <td className={`${celdaNumero} pr-5`}>{suma("fin") === null ? "—" : pesos(suma("fin")!)}</td>
                <td className={celdaNumero}><Diferencia valor={totalDif} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Código de cuenta" className="h-8 w-40 shrink-0 font-mono text-xs"
              aria-label="Agregar una cuenta de efectivo sin movimiento" onKeyDown={(e) => { if (e.key === "Enter") agregar(); }} />
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={agregar} disabled={!nueva.trim()}
              title="Para una cuenta que tiene saldo pero no tuvo movimiento en el mes">
              <Plus className="w-3 h-3" /> Agregar cuenta sin movimiento
            </Button>
          </div>
          <Button size="sm" className="gap-2" onClick={guardar} disabled={guardarMutation.isPending || (!hayCambios && agregadas.length === 0)}>
            {guardarMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Guardar saldos de {MESES[mes].toLowerCase()}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Diferencia entre lo calculado y lo digitado: verde si cuadra (menos de
 * $1 son centavos del auxiliar), rojo si hay que revisarla. */
function Diferencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(valor) < 1) {
    return <span className="inline-flex items-center gap-1 text-emerald-700" title={valor === 0 ? undefined : `${pesos(valor)} por centavos del auxiliar`}><CheckCircle2 className="w-3.5 h-3.5" /> Cuadra</span>;
  }
  return <span className="font-medium text-red-700">{pesos(valor)}</span>;
}

// ---------------------------------------------------------------------
// 4. Flujo comparativo
// ---------------------------------------------------------------------

function ComparativoCard({ clienteId, anio, informe, onCambio }: { clienteId: number; anio: number; informe: Informe; onCambio: () => void }) {
  const [ajustando, setAjustando] = useState(false);
  const utils = trpc.useUtils();
  const excelMutation = trpc.informes.flujo.generarExcel.useMutation({
    onSuccess: (data) => { toast.success("Flujo de efectivo generado"); window.open(data.signedUrl, "_blank"); utils.informes.reportes.list.invalidate(); },
    onError: (err) => toast.error(err.message || "No se pudo generar el Excel"),
  });
  const { meses, resumen: R, acumulado: A } = informe;
  const seccion = (clave: SeccionFlujo) => informe.secciones.find(s => s.seccion === clave)!;
  const hayInversion = seccion("inversion").filas.length > 0;
  const desactualizados = informe.estados.filter(e => e.desactualizado).map(e => MESES[e.mes]);
  // El aumento neto del flujo debe ser igual al movimiento de las cuentas de efectivo.
  const sinCuadrar = informe.estados.filter(e => e.calculado && Math.abs(e.variacionEfectivo - R[e.mes].aumentoNeto) >= 0.5);
  const excluido = informe.sinEfecto.filter(x => x.cuenta.startsWith("14")).reduce((s, x) => s + Math.abs(x.total), 0);

  const num = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
  // La primera columna se queda fija al desplazar los meses; en celular no,
  // porque ocuparía toda la pantalla y taparía los valores.
  const fija = "sm:sticky sm:left-0 z-10 px-3 py-1.5 text-left";
  const valor = (v: number) => <span className={v < 0 ? "text-red-700" : undefined}>{pesos(v)}</span>;

  const filaTotal = (titulo: string, porMes: (m: number) => number, total: number, fuerte = false) => (
    <tr className={`border-t ${fuerte ? "bg-[#F0EBE8] font-semibold" : "bg-muted/40 font-medium"}`}>
      <td className={`${fija} ${fuerte ? "bg-[#F0EBE8]" : "bg-muted"}`}>{titulo}</td>
      {meses.map(m => <td key={m} className={num}>{valor(porMes(m))}</td>)}
      <td className={`${num} border-l`}>{valor(total)}</td>
    </tr>
  );
  const filaSaldo = (titulo: string, porMes: (m: number) => number | null, total: number | null) => (
    <tr className="border-t">
      <td className={`${fija} bg-card font-medium`}>{titulo}</td>
      {meses.map(m => {
        const v = porMes(m);
        return <td key={m} className={num}>{v === null ? <span className="text-xs text-muted-foreground">Sin saldos</span> : valor(v)}</td>;
      })}
      <td className={`${num} border-l`}>{total === null ? <span className="text-muted-foreground">—</span> : valor(total)}</td>
    </tr>
  );
  const bloque = (clave: SeccionFlujo, titulo: string, nombreTotal: string) => {
    const s = seccion(clave);
    return (
      <Fragment key={clave}>
        <tr className="border-t">
          <td className={`${fija} bg-card pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground`} colSpan={1}>{titulo}</td>
          <td colSpan={meses.length + 1} />
        </tr>
        {s.filas.length === 0 && (
          <tr><td className={`${fija} bg-card text-xs text-muted-foreground`}>Sin movimientos.</td><td colSpan={meses.length + 1} /></tr>
        )}
        {s.filas.map(f => (
          <tr key={f.cuenta} className="border-t border-dashed">
            <td className={`${fija} bg-card align-top`}>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground shrink-0">{f.cuenta}</span>
                <span className="min-w-0 break-words">{f.nombre || <span className="text-muted-foreground italic">Sin nombre</span>}</span>
                {f.ajustada && !ajustando && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title="Sección cambiada para este cliente">ajustada</span>}
              </div>
              {ajustando
                ? <AjusteCuenta clienteId={clienteId} fila={f} onCambio={onCambio} />
                : f.observacion && <p className="mt-0.5 pl-11 text-[11px] leading-snug text-muted-foreground break-words">{f.observacion}</p>}
            </td>
            {meses.map(m => <td key={m} className={`${num} align-top`}>{valor(f.valores[m])}</td>)}
            <td className={`${num} border-l align-top`}>{valor(f.total)}</td>
          </tr>
        ))}
        {filaTotal(nombreTotal, m => s.totales[m], s.total)}
      </Fragment>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Flujo de efectivo comparativo {anio}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={ajustando ? "secondary" : "outline"} className="gap-2" onClick={() => setAjustando(a => !a)}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> {ajustando ? "Terminar ajustes" : "Ajustar secciones y nombres"}
          </Button>
          <Button size="sm" className="gap-2" onClick={() => excelMutation.mutate({ clienteId, anio })} disabled={excelMutation.isPending}>
            {excelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Descargar Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {desactualizados.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{desactualizados.join(", ")}: lo que se muestra es del cálculo anterior. Vuelve a calcular {desactualizados.length === 1 ? "ese mes" : "esos meses"} para actualizarlo.</span>
          </p>
        )}
        {ajustando && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground leading-relaxed">
            Cambia en qué sección entra una cuenta o con qué nombre aparece. Queda guardado para este cliente y aplica a todos los meses, sin recalcular.
          </p>
        )}
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#42302E] text-white text-xs">
                {/* Al ajustar, la columna se ensancha para que quepan la sección y el nombre en una línea. */}
                <th className={`${fija} bg-[#42302E] font-medium ${ajustando ? "min-w-[33rem] w-[33rem]" : "min-w-[13rem] w-[13rem] sm:min-w-[19rem] sm:w-[19rem]"}`}>Cuenta</th>
                {meses.map(m => <th key={m} className="px-3 py-2 text-right font-medium whitespace-nowrap min-w-[8.5rem]">{MESES_CORTO[m]} {anio}</th>)}
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap min-w-[8.5rem] border-l border-white/20">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {bloque("recaudos", "Recaudos", "Total recaudos")}
              {bloque("egresos_operacion", "Egresos de operación", "Total egresos de operación")}
              {filaTotal("Total flujo operativo", m => R[m].operativo, A.operativo, true)}
              {hayInversion && bloque("inversion", "Flujo de inversión", "Total flujo de inversión")}
              {bloque("financiacion", "Flujo de financiación", "Total flujo de financiación")}
              {filaTotal("Aumento neto (disminución neta) de efectivo", m => R[m].aumentoNeto, A.aumentoNeto, true)}
              {filaSaldo("Efectivo al inicio del periodo", m => R[m].saldoInicial, A.saldoInicial)}
              {filaSaldo("Efectivo al corte (calculado)", m => R[m].finalCalculado, A.finalCalculado)}
              {filaSaldo("Efectivo al corte (contabilidad)", m => R[m].saldoFinal, A.saldoFinal)}
              <tr className="border-t bg-muted/40">
                <td className={`${fija} bg-muted font-medium`}>Variación (calculado − contabilidad)</td>
                {meses.map(m => (
                  <td key={m} className={num}>
                    {R[m].variacion === null
                      ? <span className="text-xs text-muted-foreground" title="Digita los saldos de este mes en «Saldos de caja y bancos»">{R[m].cuentasSinSaldo === 1 ? "Falta 1 cuenta" : R[m].cuentasSinSaldo > 1 ? `Faltan ${R[m].cuentasSinSaldo} cuentas` : "Sin saldos"}</span>
                      : <Diferencia valor={R[m].variacion} />}
                  </td>
                ))}
                <td className={`${num} border-l`}><Diferencia valor={A.variacion} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        {sinCuadrar.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              En {sinCuadrar.map(e => `${MESES[e.mes].toLowerCase()} (${pesos(e.variacionEfectivo - R[e.mes].aumentoNeto)})`).join(", ")} el flujo no es igual al movimiento de las cuentas de efectivo: hay documentos descuadrados en el auxiliar.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground leading-relaxed">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-700" />
            <span>
              El aumento neto de cada mes es igual al movimiento de las cuentas de efectivo en el auxiliar.
              {excluido > 0 && ` Se excluyeron ${pesos(excluido)} de costo de venta contra inventario registrados dentro de las mismas facturas: no mueven efectivo y netean cero.`}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Sección y nombre de una cuenta para este cliente (modo "Ajustar"). */
function AjusteCuenta({ clienteId, fila, onCambio }: { clienteId: number; fila: Informe["secciones"][number]["filas"][number]; onCambio: () => void }) {
  const [nombre, setNombre] = useState(fila.nombre);
  const mutation = trpc.informes.flujo.ajustarCuenta.useMutation({
    onSuccess: onCambio,
    onError: (err) => toast.error(err.message || "No se pudo guardar el ajuste"),
  });
  const guardar = (seccion: SeccionFlujo | null, nuevoNombre: string | null) =>
    mutation.mutate({ clienteId, cuenta: fila.cuenta, seccion, nombre: nuevoNombre });
  const nombreCambio = nombre.trim() !== fila.nombre;
  const porDefecto = seccionPorDefecto(fila.cuenta);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-11">
      <Select value={fila.seccion} onValueChange={(v) => guardar(v as SeccionFlujo, fila.nombreAjustado ? fila.nombre : null)} disabled={mutation.isPending}>
        <SelectTrigger className="h-7 w-44 text-xs" aria-label={`Sección de la cuenta ${fila.cuenta}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {SECCIONES_FLUJO.map(s => <SelectItem key={s} value={s} className="text-xs">{TITULO_SECCION[s]}{s === porDefecto ? " (regla general)" : ""}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={255} className="h-7 w-52 text-xs" aria-label={`Nombre de la cuenta ${fila.cuenta}`}
        onKeyDown={(e) => { if (e.key === "Enter" && nombreCambio) guardar(fila.ajustada ? fila.seccion : null, nombre.trim() || null); }} />
      {nombreCambio && (
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={mutation.isPending} onClick={() => guardar(fila.ajustada ? fila.seccion : null, nombre.trim() || null)}
          title="Guardar el nombre" aria-label="Guardar el nombre">
          {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </Button>
      )}
      {(fila.ajustada || fila.nombreAjustado) && (
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-[11px] text-muted-foreground" disabled={mutation.isPending} onClick={() => guardar(null, null)}
          title="Volver a la sección y al nombre de la regla general">
          <RotateCcw className="w-3 h-3" /> Restablecer
        </Button>
      )}
    </div>
  );
}
