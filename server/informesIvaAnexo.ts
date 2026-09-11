import ExcelJS from "exceljs";
import * as informesIva from "./informesIvaDb";
import * as informesIvaCuentas from "./informesIvaCuentasDb";

const FONT_TITLE = { name: "Arial", size: 13, bold: true };
const FONT_SECCION = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
const FONT_BOLD = { name: "Arial", size: 10, bold: true };
const FONT_ITALIC = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
const MONEY = '$#,##0;($#,##0);"-"';
const SECCION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF42302E" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
const HEADER_FONT = { name: "Arial", size: 9, bold: true };
const ALERTA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } };
const OK_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2FDE7" } };

function tituloSeccion(ws: ExcelJS.Worksheet, texto: string) {
  const r = ws.addRow([texto]);
  r.font = FONT_SECCION as any;
  r.eachCell(c => { c.fill = SECCION_FILL; });
  ws.mergeCells(r.number, 1, r.number, 5);
  return r;
}

function encabezadoTabla(ws: ExcelJS.Worksheet, columnas: string[]) {
  const r = ws.addRow(columnas);
  r.font = HEADER_FONT as any;
  r.eachCell(c => { c.fill = HEADER_FILL; });
  return r;
}

function estadoCuenta(diferencia: number | null, esperado: number): "cuadra" | "diferencia" | "sin_dato" {
  if (diferencia === null) return "sin_dato";
  return Math.abs(diferencia) <= Math.max(5, Math.abs(esperado) * 0.001) ? "cuadra" : "diferencia";
}

const ETIQUETA_ESTADO: Record<string, string> = {
  cuadra: "Cuadra",
  diferencia: "\u26A0 Diferencia",
  sin_dato: "Sin cuenta configurada",
};

/** Arma el Anexo completo de la conciliación de IVA — reúne lo calculado
 * en los pasos 2 a 6 más los 2 valores que se digitan directamente
 * (saldo a favor anterior y retenciones en la fuente), en el orden que
 * pidió Arlex: IVA generado (con su comparación DIAN) → IVA descontable
 * de compras → IVA transitorio y su prorrateo → saldo a favor
 * anterior/retenciones → resumen final. Es una primera versión pensada
 * para irse ajustando con el uso real. */
export async function generarAnexoIva(
  clienteId: number, clienteNombre: string, anio: number, periodicidad: informesIva.Periodicidad, periodo: number,
): Promise<Buffer> {
  const meses = informesIva.mesesDelPeriodo(periodicidad, periodo);

  const expediente = await informesIva.getConciliacionIva(clienteId, anio, periodicidad, periodo);
  let estado: any = {};
  try { estado = expediente?.estadoJson ? JSON.parse(expediente.estadoJson) : {}; } catch { estado = {}; }

  const totalIngresos = estado.ingresos?.totalPorClasificacion;
  const totalCompras = estado.compras?.totalPorClasificacion;
  if (!totalIngresos) throw new Error("Falta completar y guardar el Paso 2 (clasificación de ingresos) antes de generar el Anexo.");
  if (!totalCompras) throw new Error("Falta completar y guardar el Paso 4 (clasificación de compras) antes de generar el Anexo — si esta empresa no tiene compras, márcalo en ese paso para poder continuar.");

  const config = await informesIvaCuentas.getConfigCuentasIva(clienteId);
  const cuentaDe = (tipo: informesIvaCuentas.TipoIva) => config.find(c => c.tipoIva === tipo)?.cuenta || null;
  // El IVA generado se mueve por CRÉDITO ("pasivo"); el descontable y el
  // transitorio se mueven por DÉBITO ("activo_gasto") — usar la
  // convención equivocada invierte el signo del saldo real.
  const saldoDe = async (cuenta: string | null, convencion: informesIvaCuentas.ConvencionSaldo = "pasivo") =>
    cuenta ? informesIvaCuentas.getSaldoCuentaEnPeriodo(clienteId, anio, meses, cuenta, convencion) : null;

  // ==================== IVA GENERADO (Paso 3) ====================
  const cuentaGen19 = cuentaDe("generado_19");
  const cuentaGen5 = cuentaDe("generado_5");
  const esperadoGen19 = totalIngresos.gravado_19 * 0.19;
  const esperadoGen5 = totalIngresos.gravado_5 * 0.05;
  const realGen19 = await saldoDe(cuentaGen19);
  const realGen5 = await saldoDe(cuentaGen5);
  const totalDianEmitidoPorMes = await informesIva.getTotalDianEmitidoPorMes(clienteId, anio, meses);
  const totalDianEmitido = totalDianEmitidoPorMes.reduce((a, m) => a + (m.totalEmitidoDian ?? 0), 0);
  const totalFacturadoIngresos = estado.ingresos?.totalContabilidadFacturado ?? 0;

  // ==================== IVA DESCONTABLE — COMPRAS (Paso 5) ====================
  const cuentaDesc19 = cuentaDe("descontable_19");
  const cuentaDesc5 = cuentaDe("descontable_5");
  const esperadoDesc19 = totalCompras.gravado_19 * 0.19;
  const esperadoDesc5 = totalCompras.gravado_5 * 0.05;
  const realDesc19 = await saldoDe(cuentaDesc19, "activo_gasto");
  const realDesc5 = await saldoDe(cuentaDesc5, "activo_gasto");
  const totalContabilidadCompras = estado.compras?.totalContabilidad ?? 0;
  const totalFacturadoCompras = estado.compras?.totalContabilidadFacturado ?? 0;
  const pctFacturadoCompras = totalContabilidadCompras > 0 ? totalFacturadoCompras / totalContabilidadCompras : null;

  // ==================== IVA TRANSITORIO Y PRORRATEO (Paso 6) ====================
  const cuentasTransitorio = await informesIvaCuentas.getTransitorioCuentas(clienteId);
  const baseGravadaTransitorio = totalIngresos.gravado_19 + totalIngresos.gravado_5;
  const baseExcluidaTransitorio = totalIngresos.excluido;
  const baseRelevanteTransitorio = baseGravadaTransitorio + baseExcluidaTransitorio;
  const proporcionTransitorio = baseRelevanteTransitorio > 0 ? baseGravadaTransitorio / baseRelevanteTransitorio : null;
  let saldoTransitorio: number | null = null;
  if (cuentasTransitorio.length > 0) {
    saldoTransitorio = 0;
    for (const cuenta of cuentasTransitorio) {
      saldoTransitorio += await informesIvaCuentas.getSaldoCuentaEnPeriodo(clienteId, anio, meses, cuenta, "activo_gasto");
    }
  }
  const montoDescontableTransitorio = saldoTransitorio !== null && proporcionTransitorio !== null ? saldoTransitorio * proporcionTransitorio : null;
  const montoAGastoTransitorio = saldoTransitorio !== null && montoDescontableTransitorio !== null ? saldoTransitorio - montoDescontableTransitorio : null;

  // ==================== DATOS ADICIONALES (digitados) ====================
  const datosAdicionales = estado.datosAdicionales || { saldoFavorAnterior: 0, retencionesFuente: 0 };

  // ==================== RESUMEN / LIQUIDACIÓN ====================
  const totalIvaGenerado = esperadoGen19 + esperadoGen5;
  const totalIvaDescontableCompras = esperadoDesc19 + esperadoDesc5;
  const totalIvaDescontableTransitorio = montoDescontableTransitorio ?? 0;
  const saldoAPagarOFavor = totalIvaGenerado
    - totalIvaDescontableCompras
    - totalIvaDescontableTransitorio
    - datosAdicionales.retencionesFuente
    - datosAdicionales.saldoFavorAnterior;

  // ==================== EXCEL ====================
  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";
  const ws = wb.addWorksheet("Anexo IVA");
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 18; ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 16; ws.getColumn(5).width = 22;

  ws.addRow([`ANEXO CONCILIACIÓN IVA · ${clienteNombre}`]).font = FONT_TITLE as any;
  ws.addRow([`${periodicidad.charAt(0).toUpperCase() + periodicidad.slice(1)} ${periodo} de ${anio}`]).font = FONT_ITALIC as any;
  ws.addRow([]);

  // --- Sección 1: IVA generado ---
  tituloSeccion(ws, "1. IVA GENERADO");
  encabezadoTabla(ws, ["Tarifa", "Base gravada", "IVA calculado", "Valor real en cuenta", "Estado"]);
  for (const { tarifa, base, esperado, real, cuenta } of [
    { tarifa: "19%", base: totalIngresos.gravado_19, esperado: esperadoGen19, real: realGen19, cuenta: cuentaGen19 },
    { tarifa: "5%", base: totalIngresos.gravado_5, esperado: esperadoGen5, real: realGen5, cuenta: cuentaGen5 },
  ]) {
    const diferencia = real !== null ? esperado - real : null;
    const estadoLinea = cuenta ? estadoCuenta(diferencia, esperado) : "sin_dato";
    const r = ws.addRow([tarifa, base, esperado, real, ETIQUETA_ESTADO[estadoLinea]]);
    if (estadoLinea === "diferencia") r.eachCell(c => c.fill = ALERTA_FILL);
    if (estadoLinea === "cuadra") r.eachCell(c => c.fill = OK_FILL);
  }
  const rTotalGen = ws.addRow(["Total IVA generado", "", totalIvaGenerado, "", ""]);
  rTotalGen.font = FONT_BOLD as any;
  ws.addRow([]);
  ws.addRow(["Observación — comparación contra la DIAN (ingresos, Paso 2)"]).font = FONT_BOLD as any;
  ws.addRow(["Total facturado electrónicamente (contabilidad)", totalFacturadoIngresos]);
  ws.addRow(["Total reportado por la DIAN como Emitido", totalDianEmitido]);
  const diferenciaDian = totalFacturadoIngresos - totalDianEmitido;
  const rDifDian = ws.addRow(["Diferencia", diferenciaDian]);
  if (Math.abs(diferenciaDian) > Math.max(5, Math.abs(totalDianEmitido) * 0.001)) rDifDian.eachCell(c => c.fill = ALERTA_FILL);
  else rDifDian.eachCell(c => c.fill = OK_FILL);
  ws.addRow([]);

  // --- Sección 2: IVA descontable — compras ---
  tituloSeccion(ws, "2. IVA DESCONTABLE — COMPRAS");
  encabezadoTabla(ws, ["Tarifa", "Base gravada", "IVA calculado", "Valor real en cuenta", "Estado"]);
  for (const { tarifa, base, esperado, real, cuenta } of [
    { tarifa: "19%", base: totalCompras.gravado_19, esperado: esperadoDesc19, real: realDesc19, cuenta: cuentaDesc19 },
    { tarifa: "5%", base: totalCompras.gravado_5, esperado: esperadoDesc5, real: realDesc5, cuenta: cuentaDesc5 },
  ]) {
    const diferencia = real !== null ? esperado - real : null;
    const estadoLinea = cuenta ? estadoCuenta(diferencia, esperado) : "sin_dato";
    const r = ws.addRow([tarifa, base, esperado, real, ETIQUETA_ESTADO[estadoLinea]]);
    if (estadoLinea === "diferencia") r.eachCell(c => c.fill = ALERTA_FILL);
    if (estadoLinea === "cuadra") r.eachCell(c => c.fill = OK_FILL);
  }
  const rTotalDesc = ws.addRow(["Total IVA descontable de compras", "", totalIvaDescontableCompras, "", ""]);
  rTotalDesc.font = FONT_BOLD as any;
  ws.addRow([]);
  ws.addRow(["Observación — facturación electrónica de las compras"]).font = FONT_BOLD as any;
  ws.addRow(["Total compras (contabilidad)", totalContabilidadCompras]);
  ws.addRow(["Facturado electrónicamente", totalFacturadoCompras, pctFacturadoCompras !== null ? `${(pctFacturadoCompras * 100).toFixed(1)}%` : "—"]);
  if (pctFacturadoCompras !== null && pctFacturadoCompras < 0.95) {
    ws.addRow(["\u26A0 Una parte importante de las compras no está facturada electrónicamente — revisar antes de tomar el descontable completo."]).font = { name: "Arial", size: 9, italic: true, color: { argb: "FFB45309" } } as any;
  }
  ws.addRow([]);

  // --- Sección 3: IVA transitorio y prorrateo ---
  tituloSeccion(ws, "3. IVA DESCONTABLE TRANSITORIO — PRORRATEO ART. 490 E.T.");
  ws.addRow(["Ingresos gravados (5%+19%)", baseGravadaTransitorio]);
  ws.addRow(["Ingresos excluidos", baseExcluidaTransitorio]);
  ws.addRow(["Proporción descontable", proporcionTransitorio !== null ? `${(proporcionTransitorio * 100).toFixed(1)}%` : "—"]);
  ws.addRow(["Saldo IVA transitorio", saldoTransitorio, cuentasTransitorio.length > 0 ? cuentasTransitorio.join(", ") : "sin cuentas configuradas"]);
  const rDescTransitorio = ws.addRow(["Total IVA descontable transitorio (prorrateado)", "", totalIvaDescontableTransitorio]);
  rDescTransitorio.font = FONT_BOLD as any;
  ws.addRow(["Va al gasto (IVA resultante de prorrateo)", "", montoAGastoTransitorio ?? 0]);
  ws.addRow([]);

  // --- Sección 4: Datos adicionales ---
  tituloSeccion(ws, "4. SALDO A FAVOR ANTERIOR Y RETENCIONES");
  ws.addRow(["Saldo a favor del periodo anterior", datosAdicionales.saldoFavorAnterior]);
  ws.addRow(["Retenciones en la fuente a título de IVA", datosAdicionales.retencionesFuente]);
  ws.addRow([]);

  // --- Sección 5: Resumen / liquidación ---
  tituloSeccion(ws, "5. RESUMEN");
  ws.addRow(["IVA generado", totalIvaGenerado]);
  ws.addRow(["(-) IVA descontable — compras", -totalIvaDescontableCompras]);
  ws.addRow(["(-) IVA descontable — transitorio (prorrateado)", -totalIvaDescontableTransitorio]);
  ws.addRow(["(-) Retenciones en la fuente a título de IVA", -datosAdicionales.retencionesFuente]);
  ws.addRow(["(-) Saldo a favor del periodo anterior", -datosAdicionales.saldoFavorAnterior]);
  const rResultado = ws.addRow([saldoAPagarOFavor >= 0 ? "SALDO A PAGAR" : "SALDO A FAVOR", Math.abs(saldoAPagarOFavor)]);
  rResultado.font = { name: "Arial", size: 12, bold: true } as any;
  rResultado.eachCell(c => c.fill = saldoAPagarOFavor >= 0 ? ALERTA_FILL : OK_FILL);

  ws.getColumn(2).numFmt = MONEY;
  ws.getColumn(3).numFmt = MONEY;
  ws.getColumn(4).numFmt = MONEY;

  ws.addRow([]);
  ws.addRow(["Esta es una primera versión del Anexo — se irá ajustando según se necesite."]).font = FONT_ITALIC as any;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
