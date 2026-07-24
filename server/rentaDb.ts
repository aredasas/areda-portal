import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

// El reporte de "Consulta de Información Exógena" de la DIAN usa un
// prefijo de espacio de nombres XML poco común en su archivo interno
// (ej. "<x:sheets>" en vez de "<sheets>") — técnicamente válido, pero
// ExcelJS (la librería usada en el resto del módulo Informes) no lo
// reconoce y falla al abrirlo. SheetJS sí lo tolera, así que este parser
// específico usa esa librería en vez de ExcelJS.
//
// Además, el archivo trae un bug propio del exportador de la DIAN: declara
// un rango de datos mucho más chico que el real (ej. "A1:H15" cuando en
// realidad hay 63 filas) — SheetJS sí lee todas las celdas reales
// internamente, pero corta la conversión a filas en el rango declarado. Se
// corrige recalculando el rango real a partir de las celdas que sí existen
// antes de convertir la hoja a filas.

/** Recalcula `!ref` a partir de las celdas que realmente existen en la
 * hoja, en vez de confiar en el rango declarado por el archivo — corrige
 * el caso en que el exportador declaró un rango más chico que los datos
 * reales. */
function corregirRangoHoja(ws: XLSX.WorkSheet): void {
  let maxFila = 0, maxCol = 0;
  for (const key of Object.keys(ws)) {
    const m = key.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    const fila = Number(m[2]);
    const col = XLSX.utils.decode_col(m[1]);
    if (fila > maxFila) maxFila = fila;
    if (col > maxCol) maxCol = col;
  }
  if (maxFila > 0) {
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxFila - 1, c: maxCol } });
  }
}

export type TopesExogena = {
  ingresos: number | null;
  patrimonio: number | null;
  consumoTC: number | null;
  movimiento: number | null;
  compras: number | null;
};

export type ItemExogena = {
  nitTercero: string;
  nombreTercero: string;
  detalle: string;
  valor: number;
  renglon: string | null;
  categoria: "ingreso" | "patrimonio" | "deuda" | "otro";
  infoAdicional: string;
};

export type ResultadoExogena = {
  topes: TopesExogena;
  items: ItemExogena[];
};

/** Extrae el/los renglón(es) del Formulario 210 mencionados en el texto de
 * "Uso declaración Sugerida" (ej. "Tope 1: Ingresos brutos | R32 Ingresos
 * brutos por rentas de trabajo (art. 103 E.T.)" → "R32"). Si menciona más
 * de uno (poco común), se toma el primero — son casos raros y se pueden
 * revisar manualmente en el detalle. */
function extraerRenglon(usoSugerido: string | null | undefined): string | null {
  if (!usoSugerido) return null;
  const m = usoSugerido.match(/\bR\d{1,3}\b/);
  return m ? m[0] : null;
}

/** Clasifica un ítem según su renglón — activos/patrimonio bruto (R29),
 * deudas (R30), o ingreso (cualquier otro renglón con número, típicamente
 * de renta de trabajo/capital/no laboral/pensiones). Filas sin renglón
 * reconocible quedan como "otro" para revisión manual. */
function categorizar(renglon: string | null): ItemExogena["categoria"] {
  if (renglon === "R29") return "patrimonio";
  if (renglon === "R30") return "deuda";
  if (renglon) return "ingreso";
  return "otro";
}

/** Encuentra la fila de encabezado de la tabla de datos, buscando por
 * contenido ("NIT" + "Detalle" + "Valor" en la misma fila) en vez de
 * asumir una posición fija. */
function esFilaEncabezado(valores: any[]): boolean {
  const texto = valores.map(v => (v ? String(v).toUpperCase() : "")).join("|");
  return texto.includes("NIT") && texto.includes("DETALLE") && texto.includes("VALOR");
}

/** UVT y topes del año gravable 2025 (Resolución DIAN, UVT = $49.799).
 * Valores confirmados por varias fuentes tributarias — si cambian para
 * otro año gravable, este es el único lugar que hay que actualizar. */
/** Las 5 cédulas del Formulario 210 — el tope combinado de deducciones +
 * rentas exentas (1.340 UVT) solo aplica dentro de la Cédula General
 * (trabajo/capital/no_laboral); pensiones y dividendos tienen su propio
 * tratamiento y no se mezclan en ese límite. */
export const CEDULAS: { valor: string; nombre: string; esGeneral: boolean }[] = [
  { valor: "trabajo", nombre: "General — Rentas de trabajo", esGeneral: true },
  { valor: "capital", nombre: "General — Rentas de capital", esGeneral: true },
  { valor: "no_laboral", nombre: "General — Rentas no laborales", esGeneral: true },
  { valor: "pensiones", nombre: "Cédula de Pensiones", esGeneral: false },
  { valor: "dividendos", nombre: "Cédula de Dividendos y Participaciones", esGeneral: false },
];

export function esCedulaGeneral(cedula: string | null | undefined): boolean {
  return CEDULAS.find(c => c.valor === cedula)?.esGeneral ?? true; // sin cédula asignada: se asume general (comportamiento previo)
}

export const UVT_2025 = 49799;

/** Tabla de tarifas del Art. 241 del Estatuto Tributario — vigente sin
 * cambios desde la Ley 2010 de 2019 (confirmado directamente contra el
 * texto del artículo). Rangos en UVT sobre la renta líquida gravable. */
const TABLA_TARIFA_241: { desde: number; hasta: number | null; tarifa: number; restarUVT: number; sumarUVT: number }[] = [
  { desde: 0, hasta: 1090, tarifa: 0, restarUVT: 0, sumarUVT: 0 },
  { desde: 1090, hasta: 1700, tarifa: 0.19, restarUVT: 1090, sumarUVT: 0 },
  { desde: 1700, hasta: 4100, tarifa: 0.28, restarUVT: 1700, sumarUVT: 116 },
  { desde: 4100, hasta: 8670, tarifa: 0.33, restarUVT: 4100, sumarUVT: 788 },
  { desde: 8670, hasta: 18970, tarifa: 0.35, restarUVT: 8670, sumarUVT: 2296 },
  { desde: 18970, hasta: 31000, tarifa: 0.37, restarUVT: 18970, sumarUVT: 5901 },
  { desde: 31000, hasta: null, tarifa: 0.39, restarUVT: 31000, sumarUVT: 10352 },
];

/** Calcula el impuesto de renta sobre una renta líquida gravable (en
 * pesos), aplicando la tabla progresiva del Art. 241 — ver la tabla
 * arriba. Devuelve el impuesto en pesos y el rango/tarifa marginal
 * aplicado, para mostrar la fórmula usada en el borrador. */
export function calcularImpuestoRenta(rentaLiquidaGravable: number): { impuesto: number; tarifaMarginal: number; rangoUVT: string } {
  if (rentaLiquidaGravable <= 0) return { impuesto: 0, tarifaMarginal: 0, rangoUVT: "0 UVT" };
  const baseUVT = rentaLiquidaGravable / UVT_2025;
  const rango = TABLA_TARIFA_241.find(r => baseUVT > r.desde && (r.hasta === null || baseUVT <= r.hasta)) || TABLA_TARIFA_241[0];
  const impuestoUVT = (baseUVT - rango.restarUVT) * rango.tarifa + rango.sumarUVT;
  return {
    impuesto: Math.round(impuestoUVT * UVT_2025),
    tarifaMarginal: rango.tarifa,
    rangoUVT: rango.hasta ? `${rango.desde}-${rango.hasta} UVT` : `>${rango.desde} UVT`,
  };
}

export const TOPES_DEDUCCION_2025 = {
  ingresos: 1400, // tope de ingresos brutos para obligación de declarar (referencia)
  patrimonio: 4500,
  consumoTC: 1400,
  compras: 1400,
  rentaExentaLaboral25: 790, // Art. 206 num. 10 E.T. — 25% rentas de trabajo
  aportesVoluntariosPensionAFC: 3800, // renta exenta, hasta 30% del ingreso
  saludPrepagada: 192, // 16 UVT/mes
  dependientes: 384, // 32 UVT/mes, 10% del ingreso
  interesesVivienda: 1200, // Art. 119 E.T.
  limiteGlobalDeduccionesRentasExentas: 1340, // 40% de la renta líquida, o este tope, el que sea menor
};

/** Catálogo de tipos de deducción/renta exenta con su tope individual 2025
 * — al elegir uno de estos tipos, el valor digitado se valida contra su
 * propio límite, además del límite global combinado de 1.340 UVT. "Otro"
 * queda sin tope automático para conceptos que no encajan en el catálogo
 * (el contador debe verificarlo manualmente). */
export const TIPOS_DEDUCCION_RENTA_EXENTA: {
  tipo: string; nombre: string; seccion: "deduccion" | "rentaExenta"; topeUVT: number | null;
}[] = [
  { tipo: "renta_exenta_25_laboral", nombre: "25% renta exenta de rentas de trabajo", seccion: "rentaExenta", topeUVT: TOPES_DEDUCCION_2025.rentaExentaLaboral25 },
  { tipo: "aportes_voluntarios_pension_afc", nombre: "Aportes voluntarios pensión / cuentas AFC", seccion: "rentaExenta", topeUVT: TOPES_DEDUCCION_2025.aportesVoluntariosPensionAFC },
  { tipo: "salud_prepagada", nombre: "Medicina prepagada / seguros de salud", seccion: "deduccion", topeUVT: TOPES_DEDUCCION_2025.saludPrepagada },
  { tipo: "dependientes_economicos", nombre: "Dependientes económicos", seccion: "deduccion", topeUVT: TOPES_DEDUCCION_2025.dependientes },
  { tipo: "intereses_vivienda", nombre: "Intereses de vivienda (crédito hipotecario/leasing)", seccion: "deduccion", topeUVT: TOPES_DEDUCCION_2025.interesesVivienda },
  { tipo: "otro", nombre: "Otra deducción/renta exenta (verificar manualmente)", seccion: "deduccion", topeUVT: null },
];

/** Valida un valor digitado contra el tope individual de su tipo de
 * deducción/renta exenta — no reemplaza el criterio del contador, es una
 * alerta cuando el valor supera lo permitido por la norma. */
export function validarTopeDeduccion(tipoDeduccion: string, valor: number): { excedeTope: boolean; tope: number | null; topeUVT: number | null } {
  const catalogo = TIPOS_DEDUCCION_RENTA_EXENTA.find(t => t.tipo === tipoDeduccion);
  if (!catalogo || catalogo.topeUVT === null) return { excedeTope: false, tope: null, topeUVT: null };
  const tope = catalogo.topeUVT * UVT_2025;
  return { excedeTope: valor > tope, tope, topeUVT: catalogo.topeUVT };
}

export type DatosLiquidacion = {
  activos: { concepto: string; valor: number }[];
  pasivos: { concepto: string; valor: number }[];
  ingresosPorCedula: Record<string, { concepto: string; valor: number }[]>;
  deduccionesRentasExentasPorCedula: Record<string, { concepto: string; valor: number; tipoDeduccion: string | null }[]>;
  patrimonioLiquidoAnioAnterior: number | null;
  impuestoNetoAnioAnterior: number | null;
  saldoAFavorAnterior: number | null;
};

export type ResultadoLiquidacion = {
  patrimonioBruto: number;
  deudas: number;
  patrimonioLiquido: number;
  ingresosPorCedula: Record<string, number>;
  totalDeduccionesRentasExentasPorCedula: Record<string, number>;
  totalDeduccionesRentasExentasGeneral: number;
  totalDeduccionesRentasExentasGeneralCapeado: number;
  rentaLiquidaCedulaGeneral: number;
  rentaLiquidaPensiones: number;
  rentaLiquidaGravableTotal: number;
  impuestoRenta: { impuesto: number; tarifaMarginal: number; rangoUVT: string };
  patrimonioLiquidoAnioAnterior: number | null;
  impuestoNetoAnioAnterior: number | null;
  saldoAFavorAnterior: number | null;
  anticipoEstimado: number | null;
};

const CEDULAS_GENERAL_CALC = ["trabajo", "capital", "no_laboral"];

/** Reúne los totales de activos/pasivos/ingresos/deducciones ya obtenidos
 * de la base de datos y calcula la liquidación — patrimonio líquido,
 * renta líquida gravable por cédula (con el tope de deducciones/rentas
 * exentas de 1.340 UVT aplicado solo a la Cédula General), el impuesto
 * según la tabla del Art. 241, y un anticipo estimado (fórmula simple de
 * referencia — el Art. 807 tiene reglas adicionales según si es la
 * primera declaración o hubo cambios grandes en el impuesto, que el
 * contador debe verificar antes de usar esta cifra como definitiva). */
export function armarLiquidacion(datos: DatosLiquidacion): ResultadoLiquidacion {
  const patrimonioBruto = datos.activos.reduce((a, it) => a + it.valor, 0);
  const deudas = datos.pasivos.reduce((a, it) => a + it.valor, 0);
  const patrimonioLiquido = Math.max(0, patrimonioBruto - deudas);

  const ingresosPorCedula: Record<string, number> = {};
  for (const [cedula, items] of Object.entries(datos.ingresosPorCedula)) {
    ingresosPorCedula[cedula] = items.reduce((a, it) => a + it.valor, 0);
  }

  const totalDeduccionesRentasExentasPorCedula: Record<string, number> = {};
  for (const [cedula, items] of Object.entries(datos.deduccionesRentasExentasPorCedula)) {
    totalDeduccionesRentasExentasPorCedula[cedula] = items.reduce((a, it) => a + it.valor, 0);
  }

  const totalDeduccionesRentasExentasGeneral = CEDULAS_GENERAL_CALC
    .reduce((a, c) => a + (totalDeduccionesRentasExentasPorCedula[c] || 0), 0);
  const topeGlobal = TOPES_DEDUCCION_2025.limiteGlobalDeduccionesRentasExentas * UVT_2025;
  const totalDeduccionesRentasExentasGeneralCapeado = Math.min(totalDeduccionesRentasExentasGeneral, topeGlobal);

  const ingresosGeneral = CEDULAS_GENERAL_CALC.reduce((a, c) => a + (ingresosPorCedula[c] || 0), 0);
  const rentaLiquidaCedulaGeneral = Math.max(0, ingresosGeneral - totalDeduccionesRentasExentasGeneralCapeado);

  const ingresosPensiones = ingresosPorCedula["pensiones"] || 0;
  const rentasExentasPensiones = totalDeduccionesRentasExentasPorCedula["pensiones"] || 0;
  const rentaLiquidaPensiones = Math.max(0, ingresosPensiones - rentasExentasPensiones);

  const rentaLiquidaGravableTotal = rentaLiquidaCedulaGeneral + rentaLiquidaPensiones;
  const impuestoRenta = calcularImpuestoRenta(rentaLiquidaGravableTotal);

  let anticipoEstimado: number | null = null;
  if (datos.impuestoNetoAnioAnterior !== null && datos.impuestoNetoAnioAnterior !== undefined) {
    anticipoEstimado = Math.round(((impuestoRenta.impuesto + datos.impuestoNetoAnioAnterior) / 2) * 0.25);
  }

  return {
    patrimonioBruto, deudas, patrimonioLiquido, ingresosPorCedula,
    totalDeduccionesRentasExentasPorCedula, totalDeduccionesRentasExentasGeneral, totalDeduccionesRentasExentasGeneralCapeado,
    rentaLiquidaCedulaGeneral, rentaLiquidaPensiones, rentaLiquidaGravableTotal, impuestoRenta,
    patrimonioLiquidoAnioAnterior: datos.patrimonioLiquidoAnioAnterior ?? null,
    impuestoNetoAnioAnterior: datos.impuestoNetoAnioAnterior ?? null,
    saldoAFavorAnterior: datos.saldoAFavorAnterior ?? null,
    anticipoEstimado,
  };
}

export async function parseExogenaDian(filePathOrBuffer: string | Buffer): Promise<ResultadoExogena> {
  const buffer = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : require("fs").readFileSync(filePathOrBuffer);
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  corregirRangoHoja(ws);
  // header: 1 → cada fila como array de valores (por posición), igual que
  // el resto del módulo Informes, en vez de objetos por nombre de columna
  // (los encabezados de este archivo no son aptos como claves directas).
  const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  const topes: TopesExogena = { ingresos: null, patrimonio: null, consumoTC: null, movimiento: null, compras: null };
  const items: ItemExogena[] = [];
  let encabezadoEncontrado = false;
  let idx: { nitTercero: number; nombreTercero: number; detalle: number; valor: number; usoSugerido: number; infoAdicional: number } | null = null;

  for (const values of filas) {
    if (!values || values.length === 0) continue;

    if (!encabezadoEncontrado) {
      if (esFilaEncabezado(values)) {
        encabezadoEncontrado = true;
        // Hay dos columnas "NIT" (quien reporta, y el tercero reportado) —
        // la segunda ocurrencia de "NIT" es el NIT del tercero real.
        const nitIdxs: number[] = [];
        values.forEach((v, i) => { if (v && String(v).toUpperCase().includes("NIT")) nitIdxs.push(i); });
        const nombreIdxs: number[] = [];
        values.forEach((v, i) => { if (v && String(v).toUpperCase().includes("NOMBRE")) nombreIdxs.push(i); });
        const detalleIdx = values.findIndex(v => v && String(v).toUpperCase().includes("DETALLE"));
        const valorIdx = values.findIndex(v => v && String(v).toUpperCase().includes("VALOR"));
        const usoIdx = values.findIndex(v => v && String(v).toUpperCase().includes("USO"));
        const infoIdx = values.findIndex(v => v && String(v).toUpperCase().includes("INFORMACI"));
        idx = {
          nitTercero: nitIdxs[1] ?? nitIdxs[0] ?? -1,
          nombreTercero: nombreIdxs[1] ?? nombreIdxs[0] ?? -1,
          detalle: detalleIdx, valor: valorIdx, usoSugerido: usoIdx, infoAdicional: infoIdx,
        };
      }
      continue;
    }

    const detalleRaw = idx!.detalle >= 0 ? values[idx!.detalle] : null;
    const valorRaw = idx!.valor >= 0 ? values[idx!.valor] : null;
    if (valorRaw === null || valorRaw === undefined || valorRaw === "") continue;
    const valor = Number(valorRaw);
    if (Number.isNaN(valor)) continue;

    const detalleTexto = detalleRaw ? String(detalleRaw).trim() : "";

    // Las 5 filas de "Tope X - ..." son resúmenes ya calculados por la
    // DIAN, no líneas de detalle de un tercero — se guardan aparte.
    if (/^Tope\s*1/i.test(detalleTexto)) { topes.ingresos = valor; continue; }
    if (/^Tope\s*2/i.test(detalleTexto)) { topes.patrimonio = valor; continue; }
    if (/^Tope\s*3/i.test(detalleTexto)) { topes.consumoTC = valor; continue; }
    if (/^Tope\s*4/i.test(detalleTexto)) { topes.movimiento = valor; continue; }
    if (/^Tope\s*5/i.test(detalleTexto)) { topes.compras = valor; continue; }

    const usoSugerido = idx!.usoSugerido >= 0 ? values[idx!.usoSugerido] : null;
    const renglon = extraerRenglon(usoSugerido ? String(usoSugerido) : null);
    items.push({
      nitTercero: idx!.nitTercero >= 0 ? String(values[idx!.nitTercero] ?? "").trim() : "",
      nombreTercero: idx!.nombreTercero >= 0 ? String(values[idx!.nombreTercero] ?? "").trim() : "",
      detalle: detalleTexto,
      valor,
      renglon,
      categoria: categorizar(renglon),
      infoAdicional: idx!.infoAdicional >= 0 ? String(values[idx!.infoAdicional] ?? "").trim() : "",
    });
  }

  return { topes, items };
}

/** Arma el resumen agrupado por renglón — la base del resumen automático
 * que se muestra en la pestaña de Liquidación (ingresos por cédula,
 * patrimonio, etc.), sumando todas las líneas que comparten renglón. */
export function resumirPorRenglon(items: ItemExogena[]): { renglon: string; categoria: string; valor: number; cantidadItems: number }[] {
  const mapa = new Map<string, { categoria: string; valor: number; cantidadItems: number }>();
  for (const item of items) {
    const clave = item.renglon || "(sin renglón)";
    if (!mapa.has(clave)) mapa.set(clave, { categoria: item.categoria, valor: 0, cantidadItems: 0 });
    const acc = mapa.get(clave)!;
    acc.valor += item.valor;
    acc.cantidadItems++;
  }
  return Array.from(mapa.entries())
    .map(([renglon, v]) => ({ renglon, ...v }))
    .sort((a, b) => b.valor - a.valor);
}

const FONT_TITLE = { name: "Arial", size: 12, bold: true };
const FONT_BOLD = { name: "Arial", size: 10, bold: true };
const MONEY = '$#,##0;($#,##0);"-"';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF42302E" } };
const HEADER_FONT = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const NOTA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF2D0" } };

const NOMBRE_CEDULA: Record<string, string> = {
  trabajo: "Rentas de trabajo", capital: "Rentas de capital", no_laboral: "Rentas no laborales",
  pensiones: "Pensiones", dividendos: "Dividendos y participaciones",
};

/** Genera el Excel del borrador del Formulario 210 con la liquidación
 * calculada — no es la representación gráfica exacta del formulario
 * oficial, es un resumen ejecutivo de los renglones principales y el
 * cálculo del impuesto, para revisión antes de digitarlo en el portal
 * de la DIAN. */
export async function generarBorrador210(
  resultado: ResultadoLiquidacion, clienteNombre: string, clienteCedula: string, anioGravable: number,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Renta Persona Natural";
  const fmt = (n: number) => n;

  const ws = wb.addWorksheet("Borrador 210");
  ws.addRow([`BORRADOR FORMULARIO 210 · ${clienteNombre} (${clienteCedula}) · Año gravable ${anioGravable}`]).font = FONT_TITLE as any;
  ws.addRow([
    "Este es un resumen de apoyo con los renglones principales y el cálculo del impuesto — no reemplaza la",
    "revisión profesional ni es la representación gráfica exacta del formulario oficial de la DIAN.",
  ]);
  ws.getRow(2).font = { name: "Arial", size: 9, italic: true } as any;
  ws.addRow([]);

  ws.addRow(["PATRIMONIO"]).font = FONT_BOLD as any;
  ws.addRow(["Patrimonio bruto (activos)", fmt(resultado.patrimonioBruto)]);
  ws.addRow(["Deudas (pasivos)", fmt(resultado.deudas)]);
  const rPL = ws.addRow(["Patrimonio líquido", fmt(resultado.patrimonioLiquido)]);
  rPL.font = FONT_BOLD as any;
  ws.addRow(["Patrimonio líquido año anterior (referencia)", resultado.patrimonioLiquidoAnioAnterior ?? "—"]);
  ws.addRow([]);

  ws.addRow(["INGRESOS POR CÉDULA"]).font = FONT_BOLD as any;
  for (const [cedula, nombre] of Object.entries(NOMBRE_CEDULA)) {
    ws.addRow([nombre, fmt(resultado.ingresosPorCedula[cedula] || 0)]);
  }
  ws.addRow([]);

  ws.addRow(["DEDUCCIONES Y RENTAS EXENTAS POR CÉDULA"]).font = FONT_BOLD as any;
  for (const [cedula, nombre] of Object.entries(NOMBRE_CEDULA)) {
    ws.addRow([nombre, fmt(resultado.totalDeduccionesRentasExentasPorCedula[cedula] || 0)]);
  }
  ws.addRow(["Total Cédula General (trabajo + capital + no laboral)", fmt(resultado.totalDeduccionesRentasExentasGeneral)]);
  const rCap = ws.addRow(["  → Limitado al tope de 1.340 UVT", fmt(resultado.totalDeduccionesRentasExentasGeneralCapeado)]);
  if (resultado.totalDeduccionesRentasExentasGeneral > resultado.totalDeduccionesRentasExentasGeneralCapeado) {
    rCap.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFCC0000" } } as any;
  }
  ws.addRow([]);

  ws.addRow(["RENTA LÍQUIDA GRAVABLE E IMPUESTO"]).font = FONT_BOLD as any;
  ws.addRow(["Renta líquida gravable — Cédula General", fmt(resultado.rentaLiquidaCedulaGeneral)]);
  ws.addRow(["Renta líquida gravable — Pensiones", fmt(resultado.rentaLiquidaPensiones)]);
  const rTotal = ws.addRow(["Renta líquida gravable total", fmt(resultado.rentaLiquidaGravableTotal)]);
  rTotal.font = FONT_BOLD as any;
  ws.addRow([
    `Tarifa marginal aplicada (Art. 241 E.T.): ${(resultado.impuestoRenta.tarifaMarginal * 100).toFixed(0)}% — rango ${resultado.impuestoRenta.rangoUVT}`,
  ]).font = { name: "Arial", size: 9, italic: true } as any;
  const rImpuesto = ws.addRow(["IMPUESTO DE RENTA", fmt(resultado.impuestoRenta.impuesto)]);
  rImpuesto.font = { name: "Arial", size: 11, bold: true } as any;
  ws.addRow([]);

  ws.addRow([
    "Nota: los dividendos y participaciones (si aplica) tienen tarifa especial propia (Art. 242 E.T.), no se suman a",
    "esta renta líquida gravable general — verificar aparte.",
  ]).eachCell(c => { c.fill = NOTA_FILL; c.font = { name: "Arial", size: 9 } as any; });
  ws.addRow([]);

  ws.addRow(["ANTICIPO Y SALDOS"]).font = FONT_BOLD as any;
  ws.addRow(["Impuesto neto de renta año anterior", resultado.impuestoNetoAnioAnterior ?? "—"]);
  ws.addRow(["Saldo a favor año anterior", resultado.saldoAFavorAnterior ?? "—"]);
  const rAnticipo = ws.addRow(["Anticipo estimado para el próximo año (referencia)", resultado.anticipoEstimado ?? "—"]);
  rAnticipo.font = FONT_BOLD as any;
  ws.addRow([
    "Nota: fórmula simple de referencia (promedio entre impuesto actual y anterior, al 25%) — el Art. 807 E.T. define",
    "porcentajes distintos según sea la primera, segunda, o siguientes declaraciones; verificar antes de usar como definitivo.",
  ]).eachCell(c => { c.fill = NOTA_FILL; c.font = { name: "Arial", size: 9 } as any; });

  ws.getColumn(1).width = 55;
  ws.getColumn(2).width = 20;
  ws.getColumn(2).numFmt = MONEY;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
