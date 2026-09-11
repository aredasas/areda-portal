import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import * as informesIva from "./informesIvaDb";
import * as informesIvaCuentas from "./informesIvaCuentasDb";
import { dibujarPiePaginaAreda } from "./rentaDb";

// ==================== CÁLCULO (compartido entre Excel y PDF) ====================

type LineaCuenta = { base: number; esperado: number; real: number | null; cuentas: string[] };
type LineaDevolucion = { real: number | null; cuentas: string[] };
type ComparacionIvaDian = { esperado: number; real: number | null; haySinDato: boolean };
type DatosAnexoIva = {
  clienteNombre: string; anio: number; periodicidad: informesIva.Periodicidad; periodo: number;
  generado: { tarifa19: LineaCuenta; tarifa5: LineaCuenta; total: number };
  observacionDian: { totalFacturado: number; totalDianEmitido: number; diferencia: number };
  devolucionCompra19: LineaDevolucion; devolucionCompra5: LineaDevolucion;
  descontableCompras: { tarifa19: LineaCuenta; tarifa5: LineaCuenta; total: number };
  observacionFacturado: { totalContabilidad: number; totalFacturado: number; pct: number | null };
  devolucionVenta19: LineaDevolucion; devolucionVenta5: LineaDevolucion;
  transitorio: {
    baseGravada: number; baseExcluida: number; proporcion: number | null;
    cuentas: string[]; saldo: number | null; montoDescontable: number | null; montoAGasto: number | null;
  };
  ivaDianVentas: ComparacionIvaDian; ivaDianCompras: ComparacionIvaDian;
  datosAdicionales: { saldoFavorAnterior: number; retencionesFuente: number };
  resumen: { totalIvaGenerado: number; totalIvaDescontableCompras: number; totalIvaDescontableTransitorio: number; saldoAPagarOFavor: number };
};

/** Reúne y calcula todo lo necesario para el Anexo — bases, valores
 * reales de cada cuenta configurada, comparación contra la DIAN,
 * prorrateo del transitorio, y la liquidación final. Un solo lugar
 * para el cálculo, reutilizado por el Excel y por el PDF, para que
 * ambos formatos SIEMPRE muestren los mismos números. */
async function calcularDatosAnexoIva(
  clienteId: number, clienteNombre: string, anio: number, periodicidad: informesIva.Periodicidad, periodo: number,
): Promise<DatosAnexoIva> {
  const meses = informesIva.mesesDelPeriodo(periodicidad, periodo);

  const expediente = await informesIva.getConciliacionIva(clienteId, anio, periodicidad, periodo);
  let estado: any = {};
  try { estado = expediente?.estadoJson ? JSON.parse(expediente.estadoJson) : {}; } catch { estado = {}; }

  const totalIngresos = estado.ingresos?.totalPorClasificacion;
  const totalCompras = estado.compras?.totalPorClasificacion;
  if (!totalIngresos) throw new Error("Falta completar y guardar el Paso 2 (clasificación de ingresos) antes de generar el Anexo.");
  if (!totalCompras) throw new Error("Falta completar y guardar el Paso 4 (clasificación de compras) antes de generar el Anexo — si esta empresa no tiene compras, márcalo en ese paso para poder continuar.");

  // La clasificación unificada de cuentas de IVA reemplaza el modelo
  // anterior de "una cuenta por rol" — cada categoría puede sumar
  // varias cuentas.
  const saldoPor = (categoria: informesIvaCuentas.CategoriaIva, convencion: informesIvaCuentas.ConvencionSaldo) =>
    informesIvaCuentas.getSaldoSumadoPorCategoria(clienteId, anio, meses, categoria, convencion);

  const { saldo: realGen19, cuentas: cuentasGen19 } = await saldoPor("generado_19", "pasivo");
  const { saldo: realGen5, cuentas: cuentasGen5 } = await saldoPor("generado_5", "pasivo");
  const { saldo: devCompra19, cuentas: cuentasDevCompra19 } = await saldoPor("generado_devolucion_compra_19", "pasivo");
  const { saldo: devCompra5, cuentas: cuentasDevCompra5 } = await saldoPor("generado_devolucion_compra_5", "pasivo");
  const esperadoGen19 = totalIngresos.gravado_19 * 0.19;
  const esperadoGen5 = totalIngresos.gravado_5 * 0.05;
  const totalDianEmitidoPorMes = await informesIva.getTotalDianEmitidoPorMes(clienteId, anio, meses);
  const totalDianEmitido = totalDianEmitidoPorMes.reduce((a, m) => a + (m.totalEmitidoDian ?? 0), 0);
  const totalFacturadoIngresos = estado.ingresos?.totalContabilidadFacturado ?? 0;

  const { saldo: realDesc19, cuentas: cuentasDesc19 } = await saldoPor("descontable_19", "activo_gasto");
  const { saldo: realDesc5, cuentas: cuentasDesc5 } = await saldoPor("descontable_5", "activo_gasto");
  const { saldo: devVenta19, cuentas: cuentasDevVenta19 } = await saldoPor("descontable_devolucion_venta_19", "activo_gasto");
  const { saldo: devVenta5, cuentas: cuentasDevVenta5 } = await saldoPor("descontable_devolucion_venta_5", "activo_gasto");
  const esperadoDesc19 = totalCompras.gravado_19 * 0.19;
  const esperadoDesc5 = totalCompras.gravado_5 * 0.05;
  const totalContabilidadCompras = estado.compras?.totalContabilidad ?? 0;
  const totalFacturadoCompras = estado.compras?.totalContabilidadFacturado ?? 0;
  const pctFacturadoCompras = totalContabilidadCompras > 0 ? totalFacturadoCompras / totalContabilidadCompras : null;

  // El IVA que la DIAN reporta — el archivo no discrimina el IVA por
  // tarifa dentro de cada documento, así que solo se compara el TOTAL
  // (19%+5% juntos) contra lo que la DIAN reporta.
  const ivaDianVentasPorMes = await informesIva.getTotalIvaDianVentasPorMes(clienteId, anio, meses);
  const haySinDatoVentas = ivaDianVentasPorMes.some(m => m.valor === null);
  const ivaDianVentas: ComparacionIvaDian = {
    esperado: esperadoGen19 + esperadoGen5,
    real: haySinDatoVentas ? null : ivaDianVentasPorMes.reduce((a, m) => a + (m.valor ?? 0), 0),
    haySinDato: haySinDatoVentas,
  };
  const ivaDianComprasPorMes = await informesIva.getTotalIvaDianComprasPorMes(clienteId, anio, meses);
  const haySinDatoCompras = ivaDianComprasPorMes.some(m => m.valor === null);
  const ivaDianCompras: ComparacionIvaDian = {
    esperado: esperadoDesc19 + esperadoDesc5,
    real: haySinDatoCompras ? null : ivaDianComprasPorMes.reduce((a, m) => a + (m.valor ?? 0), 0),
    haySinDato: haySinDatoCompras,
  };

  const { saldo: saldoTransitorio, cuentas: cuentasTransitorio } = await saldoPor("transitorio", "activo_gasto");
  const baseGravadaTransitorio = totalIngresos.gravado_19 + totalIngresos.gravado_5;
  const baseExcluidaTransitorio = totalIngresos.excluido;
  const baseRelevanteTransitorio = baseGravadaTransitorio + baseExcluidaTransitorio;
  const proporcionTransitorio = baseRelevanteTransitorio > 0 ? baseGravadaTransitorio / baseRelevanteTransitorio : null;
  const montoDescontableTransitorio = saldoTransitorio !== null && proporcionTransitorio !== null ? saldoTransitorio * proporcionTransitorio : null;
  const montoAGastoTransitorio = saldoTransitorio !== null && montoDescontableTransitorio !== null ? saldoTransitorio - montoDescontableTransitorio : null;

  const datosAdicionales = estado.datosAdicionales || { saldoFavorAnterior: 0, retencionesFuente: 0 };

  const totalIvaGenerado = esperadoGen19 + esperadoGen5;
  const totalIvaDescontableCompras = esperadoDesc19 + esperadoDesc5;
  const totalIvaDescontableTransitorio = montoDescontableTransitorio ?? 0;
  const saldoAPagarOFavor = totalIvaGenerado
    - totalIvaDescontableCompras
    - totalIvaDescontableTransitorio
    - datosAdicionales.retencionesFuente
    - datosAdicionales.saldoFavorAnterior;

  return {
    clienteNombre, anio, periodicidad, periodo,
    generado: {
      tarifa19: { base: totalIngresos.gravado_19, esperado: esperadoGen19, real: realGen19, cuentas: cuentasGen19 },
      tarifa5: { base: totalIngresos.gravado_5, esperado: esperadoGen5, real: realGen5, cuentas: cuentasGen5 },
      total: totalIvaGenerado,
    },
    observacionDian: { totalFacturado: totalFacturadoIngresos, totalDianEmitido, diferencia: totalFacturadoIngresos - totalDianEmitido },
    devolucionCompra19: { real: devCompra19, cuentas: cuentasDevCompra19 },
    devolucionCompra5: { real: devCompra5, cuentas: cuentasDevCompra5 },
    descontableCompras: {
      tarifa19: { base: totalCompras.gravado_19, esperado: esperadoDesc19, real: realDesc19, cuentas: cuentasDesc19 },
      tarifa5: { base: totalCompras.gravado_5, esperado: esperadoDesc5, real: realDesc5, cuentas: cuentasDesc5 },
      total: totalIvaDescontableCompras,
    },
    observacionFacturado: { totalContabilidad: totalContabilidadCompras, totalFacturado: totalFacturadoCompras, pct: pctFacturadoCompras },
    devolucionVenta19: { real: devVenta19, cuentas: cuentasDevVenta19 },
    devolucionVenta5: { real: devVenta5, cuentas: cuentasDevVenta5 },
    transitorio: {
      baseGravada: baseGravadaTransitorio, baseExcluida: baseExcluidaTransitorio, proporcion: proporcionTransitorio,
      cuentas: cuentasTransitorio, saldo: saldoTransitorio, montoDescontable: montoDescontableTransitorio, montoAGasto: montoAGastoTransitorio,
    },
    ivaDianVentas, ivaDianCompras,
    datosAdicionales,
    resumen: { totalIvaGenerado, totalIvaDescontableCompras, totalIvaDescontableTransitorio, saldoAPagarOFavor },
  };
}

function estadoCuenta(diferencia: number | null, esperado: number): "cuadra" | "diferencia" | "sin_dato" {
  if (diferencia === null) return "sin_dato";
  return Math.abs(diferencia) <= Math.max(5, Math.abs(esperado) * 0.001) ? "cuadra" : "diferencia";
}

// ==================== EXCEL ====================

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

const ETIQUETA_ESTADO: Record<string, string> = {
  cuadra: "Cuadra",
  diferencia: "\u26A0 Diferencia",
  sin_dato: "Sin cuenta configurada",
};

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

function filaLineaExcel(ws: ExcelJS.Worksheet, tarifa: string, linea: LineaCuenta) {
  const diferencia = linea.real !== null ? linea.esperado - linea.real : null;
  const estadoLinea = linea.cuentas.length > 0 ? estadoCuenta(diferencia, linea.esperado) : "sin_dato";
  const r = ws.addRow([tarifa, linea.base, linea.esperado, linea.real, ETIQUETA_ESTADO[estadoLinea]]);
  if (estadoLinea === "diferencia") r.eachCell(c => c.fill = ALERTA_FILL);
  if (estadoLinea === "cuadra") r.eachCell(c => c.fill = OK_FILL);
}

export async function generarAnexoIva(
  clienteId: number, clienteNombre: string, anio: number, periodicidad: informesIva.Periodicidad, periodo: number,
): Promise<Buffer> {
  const d = await calcularDatosAnexoIva(clienteId, clienteNombre, anio, periodicidad, periodo);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";
  const ws = wb.addWorksheet("Anexo IVA");
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 18; ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 16; ws.getColumn(5).width = 22;

  ws.addRow([`ANEXO CONCILIACIÓN IVA · ${d.clienteNombre}`]).font = FONT_TITLE as any;
  ws.addRow([`${d.periodicidad.charAt(0).toUpperCase() + d.periodicidad.slice(1)} ${d.periodo} de ${d.anio}`]).font = FONT_ITALIC as any;
  ws.addRow([]);

  tituloSeccion(ws, "1. IVA GENERADO");
  encabezadoTabla(ws, ["Tarifa", "Base gravada", "IVA calculado", "Valor real en cuenta", "Estado"]);
  filaLineaExcel(ws, "19%", d.generado.tarifa19);
  filaLineaExcel(ws, "5%", d.generado.tarifa5);
  const rTotalGen = ws.addRow(["Total IVA generado", "", d.generado.total, "", ""]);
  rTotalGen.font = FONT_BOLD as any;
  ws.addRow([]);
  if (d.devolucionCompra19.cuentas.length > 0 || d.devolucionCompra5.cuentas.length > 0) {
    ws.addRow(["IVA generado en devoluciones en compra"]).font = FONT_BOLD as any;
    if (d.devolucionCompra19.cuentas.length > 0) ws.addRow(["19%", "", "", d.devolucionCompra19.real, "", d.devolucionCompra19.cuentas.join(", ")]);
    if (d.devolucionCompra5.cuentas.length > 0) ws.addRow(["5%", "", "", d.devolucionCompra5.real, "", d.devolucionCompra5.cuentas.join(", ")]);
    ws.addRow([]);
  }
  ws.addRow(["Observación — comparación contra la DIAN (ingresos, Paso 2)"]).font = FONT_BOLD as any;
  ws.addRow(["Total facturado electrónicamente (contabilidad)", d.observacionDian.totalFacturado]);
  ws.addRow(["Total reportado por la DIAN como Emitido", d.observacionDian.totalDianEmitido]);
  const rDifDian = ws.addRow(["Diferencia", d.observacionDian.diferencia]);
  if (Math.abs(d.observacionDian.diferencia) > Math.max(5, Math.abs(d.observacionDian.totalDianEmitido) * 0.001)) rDifDian.eachCell(c => c.fill = ALERTA_FILL);
  else rDifDian.eachCell(c => c.fill = OK_FILL);
  ws.addRow([]);
  ws.addRow(["Observación — IVA reportado por la DIAN en los documentos de venta"]).font = FONT_BOLD as any;
  ws.addRow(["IVA esperado (19%+5%)", d.ivaDianVentas.esperado]);
  if (d.ivaDianVentas.haySinDato) {
    ws.addRow(["IVA según la DIAN", "sin dato — regenera la comparación DIAN de algún mes"]);
  } else if (d.ivaDianVentas.real !== null) {
    ws.addRow(["IVA según la DIAN", d.ivaDianVentas.real]);
    const difIvaDianVentas = d.ivaDianVentas.esperado - d.ivaDianVentas.real;
    const rDifIvaDianVentas = ws.addRow(["Diferencia contra la DIAN", difIvaDianVentas]);
    if (Math.abs(difIvaDianVentas) > Math.max(5, Math.abs(d.ivaDianVentas.esperado) * 0.001)) rDifIvaDianVentas.eachCell(c => c.fill = ALERTA_FILL);
    else rDifIvaDianVentas.eachCell(c => c.fill = OK_FILL);
  }
  ws.addRow([]);

  tituloSeccion(ws, "2. IVA DESCONTABLE — COMPRAS");
  encabezadoTabla(ws, ["Tarifa", "Base gravada", "IVA calculado", "Valor real en cuenta", "Estado"]);
  filaLineaExcel(ws, "19%", d.descontableCompras.tarifa19);
  filaLineaExcel(ws, "5%", d.descontableCompras.tarifa5);
  const rTotalDesc = ws.addRow(["Total IVA descontable de compras", "", d.descontableCompras.total, "", ""]);
  rTotalDesc.font = FONT_BOLD as any;
  ws.addRow([]);
  if (d.devolucionVenta19.cuentas.length > 0 || d.devolucionVenta5.cuentas.length > 0) {
    ws.addRow(["IVA descontable en devoluciones en venta"]).font = FONT_BOLD as any;
    if (d.devolucionVenta19.cuentas.length > 0) ws.addRow(["19%", "", "", d.devolucionVenta19.real, "", d.devolucionVenta19.cuentas.join(", ")]);
    if (d.devolucionVenta5.cuentas.length > 0) ws.addRow(["5%", "", "", d.devolucionVenta5.real, "", d.devolucionVenta5.cuentas.join(", ")]);
    ws.addRow([]);
  }
  ws.addRow(["Observación — facturación electrónica de las compras"]).font = FONT_BOLD as any;
  ws.addRow(["Total compras (contabilidad)", d.observacionFacturado.totalContabilidad]);
  ws.addRow(["Facturado electrónicamente", d.observacionFacturado.totalFacturado, d.observacionFacturado.pct !== null ? `${(d.observacionFacturado.pct * 100).toFixed(1)}%` : "—"]);
  if (d.observacionFacturado.pct !== null && d.observacionFacturado.pct < 0.95) {
    ws.addRow(["\u26A0 Una parte importante de las compras no está facturada electrónicamente — revisar antes de tomar el descontable completo."]).font = { name: "Arial", size: 9, italic: true, color: { argb: "FFB45309" } } as any;
  }
  ws.addRow([]);
  ws.addRow(["Observación — IVA reportado por la DIAN en los documentos de compra"]).font = FONT_BOLD as any;
  ws.addRow(["IVA esperado (19%+5%)", d.ivaDianCompras.esperado]);
  if (d.ivaDianCompras.haySinDato) {
    ws.addRow(["IVA según la DIAN", "sin dato — regenera la comparación DIAN de algún mes"]);
  } else if (d.ivaDianCompras.real !== null) {
    ws.addRow(["IVA según la DIAN", d.ivaDianCompras.real]);
    const difIvaDianCompras = d.ivaDianCompras.esperado - d.ivaDianCompras.real;
    const rDifIvaDianCompras = ws.addRow(["Diferencia contra la DIAN", difIvaDianCompras]);
    if (Math.abs(difIvaDianCompras) > Math.max(5, Math.abs(d.ivaDianCompras.esperado) * 0.001)) rDifIvaDianCompras.eachCell(c => c.fill = ALERTA_FILL);
    else rDifIvaDianCompras.eachCell(c => c.fill = OK_FILL);
  }
  ws.addRow([]);

  tituloSeccion(ws, "3. IVA DESCONTABLE TRANSITORIO — PRORRATEO ART. 490 E.T.");
  ws.addRow(["Ingresos gravados (5%+19%)", d.transitorio.baseGravada]);
  ws.addRow(["Ingresos excluidos", d.transitorio.baseExcluida]);
  ws.addRow(["Proporción descontable", d.transitorio.proporcion !== null ? `${(d.transitorio.proporcion * 100).toFixed(1)}%` : "—"]);
  ws.addRow(["Saldo IVA transitorio", d.transitorio.saldo, d.transitorio.cuentas.length > 0 ? d.transitorio.cuentas.join(", ") : "sin cuentas configuradas"]);
  const rDescTransitorio = ws.addRow(["Total IVA descontable transitorio (prorrateado)", "", d.resumen.totalIvaDescontableTransitorio]);
  rDescTransitorio.font = FONT_BOLD as any;
  ws.addRow(["Va al gasto (IVA resultante de prorrateo)", "", d.transitorio.montoAGasto ?? 0]);
  ws.addRow([]);

  tituloSeccion(ws, "4. SALDO A FAVOR ANTERIOR Y RETENCIONES");
  ws.addRow(["Saldo a favor del periodo anterior", d.datosAdicionales.saldoFavorAnterior]);
  ws.addRow(["Retenciones en la fuente a título de IVA", d.datosAdicionales.retencionesFuente]);
  ws.addRow([]);

  tituloSeccion(ws, "5. RESUMEN");
  ws.addRow(["IVA generado", d.resumen.totalIvaGenerado]);
  ws.addRow(["(-) IVA descontable — compras", -d.resumen.totalIvaDescontableCompras]);
  ws.addRow(["(-) IVA descontable — transitorio (prorrateado)", -d.resumen.totalIvaDescontableTransitorio]);
  ws.addRow(["(-) Retenciones en la fuente a título de IVA", -d.datosAdicionales.retencionesFuente]);
  ws.addRow(["(-) Saldo a favor del periodo anterior", -d.datosAdicionales.saldoFavorAnterior]);
  const rResultado = ws.addRow([d.resumen.saldoAPagarOFavor >= 0 ? "SALDO A PAGAR" : "SALDO A FAVOR", Math.abs(d.resumen.saldoAPagarOFavor)]);
  rResultado.font = { name: "Arial", size: 12, bold: true } as any;
  rResultado.eachCell(c => c.fill = d.resumen.saldoAPagarOFavor >= 0 ? ALERTA_FILL : OK_FILL);

  ws.getColumn(2).numFmt = MONEY;
  ws.getColumn(3).numFmt = MONEY;
  ws.getColumn(4).numFmt = MONEY;

  ws.addRow([]);
  ws.addRow(["Esta es una primera versión del Anexo — se irá ajustando según se necesite."]).font = FONT_ITALIC as any;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ==================== PDF (mismo estilo que los Anexos de Renta) ====================

const ETIQUETA_ESTADO_PDF: Record<string, string> = {
  cuadra: "Cuadra",
  diferencia: "Diferencia",
  sin_dato: "Sin cuenta configurada",
};

/** Arma el Anexo completo de la conciliación de IVA en PDF — mismo
 * estilo visual que los anexos del módulo de Renta Persona Natural
 * (encabezado con cliente/periodo, filas concepto-valor alineadas,
 * líneas divisorias, logo de Areda al pie de cada página). */
export async function generarAnexoIvaPdf(
  clienteId: number, clienteNombre: string, anio: number, periodicidad: informesIva.Periodicidad, periodo: number,
): Promise<Buffer> {
  const d = await calcularDatosAnexoIva(clienteId, clienteNombre, anio, periodicidad, periodo);
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "letter", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 100;
  const xLabel = 50;
  const xValor = doc.page.width - 50;

  function saltoDePaginaSiHaceFalta(alturaNecesaria: number) {
    if (doc.y + alturaNecesaria > doc.page.height - doc.page.margins.bottom) {
      dibujarPiePaginaAreda(doc);
      doc.addPage();
    }
  }

  function encabezado(titulo: string) {
    doc.fontSize(13).font("Helvetica-Bold").text(titulo, { align: "center" });
    const nombrePeriodicidad = periodicidad.charAt(0).toUpperCase() + periodicidad.slice(1);
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
      .text(`${clienteNombre} · ${nombrePeriodicidad} ${periodo} de ${anio}`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1);
  }

  function tituloAnexo(texto: string) {
    saltoDePaginaSiHaceFalta(30);
    doc.font("Helvetica-Bold").fontSize(11).text(texto);
    doc.moveDown(0.2);
  }

  function filaTexto(label: string, valor: string, opciones?: { negrita?: boolean; color?: string; indent?: number }) {
    saltoDePaginaSiHaceFalta(14);
    const anchoLabel = anchoUtil - 150 - (opciones?.indent || 0);
    const y = doc.y;
    doc.font(opciones?.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(opciones?.color || "#000000");
    doc.text(label, xLabel + (opciones?.indent || 0), y, { width: anchoLabel, height: 12, ellipsis: true });
    const yTrasLabel = doc.y;
    doc.text(valor, xLabel, y, { width: anchoUtil, align: "right" });
    const yTrasValor = doc.y;
    doc.y = Math.max(yTrasLabel, yTrasValor);
    doc.fillColor("#000000");
  }

  function lineaDivisoria() {
    doc.moveTo(xLabel, doc.y).lineTo(xValor, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.3);
  }

  function notaObservacion(texto: string, color: string = "#555555") {
    saltoDePaginaSiHaceFalta(20);
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(color).text(texto, xLabel, doc.y, { width: anchoUtil });
    doc.fillColor("#000000").font("Helvetica").fontSize(9.5);
    doc.moveDown(0.2);
  }

  encabezado("ANEXO CONCILIACIÓN IVA");

  tituloAnexo("1. IVA GENERADO");
  for (const { tarifa, linea } of [{ tarifa: "19%", linea: d.generado.tarifa19 }, { tarifa: "5%", linea: d.generado.tarifa5 }]) {
    const diferencia = linea.real !== null ? linea.esperado - linea.real : null;
    const estadoLinea = linea.cuentas.length > 0 ? estadoCuenta(diferencia, linea.esperado) : "sin_dato";
    filaTexto(`Base gravada ${tarifa}`, fmt(linea.base), { indent: 8 });
    filaTexto(`IVA calculado ${tarifa}`, fmt(linea.esperado), { indent: 8 });
    filaTexto(`Valor real en cuentas${linea.cuentas.length > 0 ? ` (${linea.cuentas.join(", ")})` : ""}`, linea.real !== null ? fmt(linea.real) : "—", { indent: 8 });
    filaTexto(`Estado ${tarifa}`, ETIQUETA_ESTADO_PDF[estadoLinea], { indent: 8, color: estadoLinea === "diferencia" ? "#b91c1c" : estadoLinea === "cuadra" ? "#15803d" : "#555555" });
    doc.moveDown(0.15);
  }
  lineaDivisoria();
  filaTexto("Total IVA generado", fmt(d.generado.total), { negrita: true });
  doc.moveDown(0.5);
  if (d.devolucionCompra19.cuentas.length > 0 || d.devolucionCompra5.cuentas.length > 0) {
    notaObservacion("IVA generado en devoluciones en compra:");
    if (d.devolucionCompra19.cuentas.length > 0) filaTexto(`19% (${d.devolucionCompra19.cuentas.join(", ")})`, d.devolucionCompra19.real !== null ? fmt(d.devolucionCompra19.real) : "—", { indent: 8 });
    if (d.devolucionCompra5.cuentas.length > 0) filaTexto(`5% (${d.devolucionCompra5.cuentas.join(", ")})`, d.devolucionCompra5.real !== null ? fmt(d.devolucionCompra5.real) : "—", { indent: 8 });
    doc.moveDown(0.5);
  }
  notaObservacion("Observación — comparación contra la DIAN (ingresos, Paso 2):");
  filaTexto("Total facturado electrónicamente (contabilidad)", fmt(d.observacionDian.totalFacturado), { indent: 8 });
  filaTexto("Total reportado por la DIAN como Emitido", fmt(d.observacionDian.totalDianEmitido), { indent: 8 });
  const okDian = Math.abs(d.observacionDian.diferencia) <= Math.max(5, Math.abs(d.observacionDian.totalDianEmitido) * 0.001);
  filaTexto("Diferencia", fmt(d.observacionDian.diferencia), { indent: 8, negrita: true, color: okDian ? "#15803d" : "#b91c1c" });
  doc.moveDown(0.5);
  notaObservacion("Observación — IVA reportado por la DIAN en los documentos de venta:");
  filaTexto("IVA esperado (19%+5%)", fmt(d.ivaDianVentas.esperado), { indent: 8 });
  if (d.ivaDianVentas.haySinDato) {
    filaTexto("IVA según la DIAN", "sin dato — regenera la comparación DIAN", { indent: 8, color: "#b45309" });
  } else if (d.ivaDianVentas.real !== null) {
    const difIvaDianVentas = d.ivaDianVentas.esperado - d.ivaDianVentas.real;
    const okIvaDianVentas = Math.abs(difIvaDianVentas) <= Math.max(5, Math.abs(d.ivaDianVentas.esperado) * 0.001);
    filaTexto("IVA según la DIAN", fmt(d.ivaDianVentas.real), { indent: 8 });
    filaTexto("Diferencia contra la DIAN", fmt(difIvaDianVentas), { indent: 8, negrita: true, color: okIvaDianVentas ? "#15803d" : "#b91c1c" });
  }
  doc.moveDown(0.8);

  tituloAnexo("2. IVA DESCONTABLE — COMPRAS");
  for (const { tarifa, linea } of [{ tarifa: "19%", linea: d.descontableCompras.tarifa19 }, { tarifa: "5%", linea: d.descontableCompras.tarifa5 }]) {
    const diferencia = linea.real !== null ? linea.esperado - linea.real : null;
    const estadoLinea = linea.cuentas.length > 0 ? estadoCuenta(diferencia, linea.esperado) : "sin_dato";
    filaTexto(`Base gravada ${tarifa}`, fmt(linea.base), { indent: 8 });
    filaTexto(`IVA calculado ${tarifa}`, fmt(linea.esperado), { indent: 8 });
    filaTexto(`Valor real en cuentas${linea.cuentas.length > 0 ? ` (${linea.cuentas.join(", ")})` : ""}`, linea.real !== null ? fmt(linea.real) : "—", { indent: 8 });
    filaTexto(`Estado ${tarifa}`, ETIQUETA_ESTADO_PDF[estadoLinea], { indent: 8, color: estadoLinea === "diferencia" ? "#b91c1c" : estadoLinea === "cuadra" ? "#15803d" : "#555555" });
    doc.moveDown(0.15);
  }
  lineaDivisoria();
  filaTexto("Total IVA descontable de compras", fmt(d.descontableCompras.total), { negrita: true });
  doc.moveDown(0.5);
  if (d.devolucionVenta19.cuentas.length > 0 || d.devolucionVenta5.cuentas.length > 0) {
    notaObservacion("IVA descontable en devoluciones en venta:");
    if (d.devolucionVenta19.cuentas.length > 0) filaTexto(`19% (${d.devolucionVenta19.cuentas.join(", ")})`, d.devolucionVenta19.real !== null ? fmt(d.devolucionVenta19.real) : "—", { indent: 8 });
    if (d.devolucionVenta5.cuentas.length > 0) filaTexto(`5% (${d.devolucionVenta5.cuentas.join(", ")})`, d.devolucionVenta5.real !== null ? fmt(d.devolucionVenta5.real) : "—", { indent: 8 });
    doc.moveDown(0.5);
  }
  notaObservacion("Observación — facturación electrónica de las compras:");
  filaTexto("Total compras (contabilidad)", fmt(d.observacionFacturado.totalContabilidad), { indent: 8 });
  filaTexto(
    "Facturado electrónicamente",
    `${fmt(d.observacionFacturado.totalFacturado)} (${d.observacionFacturado.pct !== null ? `${(d.observacionFacturado.pct * 100).toFixed(1)}%` : "—"})`,
    { indent: 8 },
  );
  if (d.observacionFacturado.pct !== null && d.observacionFacturado.pct < 0.95) {
    notaObservacion("Una parte importante de las compras no está facturada electrónicamente — revisar antes de tomar el descontable completo.", "#b45309");
  }
  doc.moveDown(0.5);
  notaObservacion("Observación — IVA reportado por la DIAN en los documentos de compra:");
  filaTexto("IVA esperado (19%+5%)", fmt(d.ivaDianCompras.esperado), { indent: 8 });
  if (d.ivaDianCompras.haySinDato) {
    filaTexto("IVA según la DIAN", "sin dato — regenera la comparación DIAN", { indent: 8, color: "#b45309" });
  } else if (d.ivaDianCompras.real !== null) {
    const difIvaDianCompras = d.ivaDianCompras.esperado - d.ivaDianCompras.real;
    const okIvaDianCompras = Math.abs(difIvaDianCompras) <= Math.max(5, Math.abs(d.ivaDianCompras.esperado) * 0.001);
    filaTexto("IVA según la DIAN", fmt(d.ivaDianCompras.real), { indent: 8 });
    filaTexto("Diferencia contra la DIAN", fmt(difIvaDianCompras), { indent: 8, negrita: true, color: okIvaDianCompras ? "#15803d" : "#b91c1c" });
  }
  doc.moveDown(0.8);

  tituloAnexo("3. IVA DESCONTABLE TRANSITORIO — PRORRATEO ART. 490 E.T.");
  filaTexto("Ingresos gravados (5%+19%)", fmt(d.transitorio.baseGravada), { indent: 8 });
  filaTexto("Ingresos excluidos", fmt(d.transitorio.baseExcluida), { indent: 8 });
  filaTexto("Proporción descontable", d.transitorio.proporcion !== null ? `${(d.transitorio.proporcion * 100).toFixed(1)}%` : "—", { indent: 8 });
  filaTexto(
    `Saldo IVA transitorio${d.transitorio.cuentas.length > 0 ? ` (${d.transitorio.cuentas.join(", ")})` : ""}`,
    d.transitorio.saldo !== null ? fmt(d.transitorio.saldo) : "—", { indent: 8 },
  );
  lineaDivisoria();
  filaTexto("Total IVA descontable transitorio (prorrateado)", fmt(d.resumen.totalIvaDescontableTransitorio), { negrita: true });
  filaTexto("Va al gasto (IVA resultante de prorrateo)", fmt(d.transitorio.montoAGasto ?? 0));
  doc.moveDown(0.8);

  tituloAnexo("4. SALDO A FAVOR ANTERIOR Y RETENCIONES");
  filaTexto("Saldo a favor del periodo anterior", fmt(d.datosAdicionales.saldoFavorAnterior));
  filaTexto("Retenciones en la fuente a título de IVA", fmt(d.datosAdicionales.retencionesFuente));
  doc.moveDown(0.8);

  saltoDePaginaSiHaceFalta(120);
  tituloAnexo("5. RESUMEN");
  filaTexto("IVA generado", fmt(d.resumen.totalIvaGenerado));
  filaTexto("(-) IVA descontable — compras", `-${fmt(d.resumen.totalIvaDescontableCompras)}`, { color: "#b91c1c" });
  filaTexto("(-) IVA descontable — transitorio (prorrateado)", `-${fmt(d.resumen.totalIvaDescontableTransitorio)}`, { color: "#b91c1c" });
  filaTexto("(-) Retenciones en la fuente a título de IVA", `-${fmt(d.datosAdicionales.retencionesFuente)}`, { color: "#b91c1c" });
  filaTexto("(-) Saldo a favor del periodo anterior", `-${fmt(d.datosAdicionales.saldoFavorAnterior)}`, { color: "#b91c1c" });
  lineaDivisoria();
  doc.fontSize(12);
  filaTexto(
    d.resumen.saldoAPagarOFavor >= 0 ? "SALDO A PAGAR" : "SALDO A FAVOR",
    fmt(Math.abs(d.resumen.saldoAPagarOFavor)),
    { negrita: true, color: d.resumen.saldoAPagarOFavor >= 0 ? "#b91c1c" : "#15803d" },
  );
  doc.fontSize(9.5);

  doc.moveDown(1.5);
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555555")
    .text("Esta es una primera versión del Anexo — se irá ajustando según se necesite.", { align: "center" });
  doc.fillColor("#000000");

  dibujarPiePaginaAreda(doc);
  doc.end();
  return done;
}
