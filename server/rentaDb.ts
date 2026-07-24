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
export const CEDULAS: { valor: string; nombre: string; esGeneral: boolean; tieneCostos: boolean }[] = [
  { valor: "trabajo", nombre: "General — Rentas de trabajo (relación laboral)", esGeneral: true, tieneCostos: false },
  { valor: "trabajo_honorarios", nombre: "General — Rentas de trabajo por honorarios/compensación (sin relación laboral)", esGeneral: true, tieneCostos: true },
  { valor: "capital", nombre: "General — Rentas de capital", esGeneral: true, tieneCostos: true },
  { valor: "no_laboral", nombre: "General — Rentas no laborales", esGeneral: true, tieneCostos: true },
  { valor: "pensiones", nombre: "Cédula de Pensiones", esGeneral: false, tieneCostos: false },
  { valor: "dividendos", nombre: "Cédula de Dividendos y Participaciones", esGeneral: false, tieneCostos: false },
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
  tipo: string; nombre: string; tipoValor: "deduccion" | "renta_exenta"; topeUVT: number | null;
}[] = [
  { tipo: "renta_exenta_25_laboral", nombre: "25% renta exenta de rentas de trabajo", tipoValor: "renta_exenta", topeUVT: TOPES_DEDUCCION_2025.rentaExentaLaboral25 },
  { tipo: "aportes_voluntarios_pension_afc", nombre: "Aportes voluntarios pensión / cuentas AFC", tipoValor: "renta_exenta", topeUVT: TOPES_DEDUCCION_2025.aportesVoluntariosPensionAFC },
  { tipo: "salud_prepagada", nombre: "Medicina prepagada / seguros de salud", tipoValor: "deduccion", topeUVT: TOPES_DEDUCCION_2025.saludPrepagada },
  { tipo: "dependientes_economicos", nombre: "Dependientes económicos", tipoValor: "deduccion", topeUVT: TOPES_DEDUCCION_2025.dependientes },
  { tipo: "intereses_vivienda", nombre: "Intereses de vivienda (crédito hipotecario/leasing)", tipoValor: "deduccion", topeUVT: TOPES_DEDUCCION_2025.interesesVivienda },
  { tipo: "otro", nombre: "Otra deducción/renta exenta (verificar manualmente)", tipoValor: "deduccion", topeUVT: null },
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

export type ItemValor = { concepto: string; valor: number; tipoDeduccion?: string | null };

/** Los datos crudos de UNA de las 4 sub-rentas de la Cédula General, o de
 * Pensiones/Dividendos — cada casilla del Formulario 210 corresponde a uno
 * de estos 5 tipos de valor. */
export type DatosCedula = {
  ingresoBruto: ItemValor[];
  ingresoNoConstitutivo: ItemValor[];
  /** Solo aplica a trabajo_honorarios/capital/no_laboral — "trabajo" (con
   * relación laboral) no tiene costos, es renta líquida = ingreso bruto -
   * no constitutivo directamente. */
  costoDeduccionProcedente: ItemValor[];
  rentaExenta: ItemValor[];
  deduccion: ItemValor[];
};

function sumaItems(items: ItemValor[]): number {
  return items.reduce((a, it) => a + it.valor, 0);
}

export type DatosLiquidacion = {
  activos: { concepto: string; valor: number }[];
  pasivos: { concepto: string; valor: number }[];
  cedulas: Record<string, DatosCedula>; // trabajo, trabajo_honorarios, capital, no_laboral, pensiones, dividendos
  patrimonioLiquidoAnioAnterior: number | null;
  impuestoNetoAnioAnterior: number | null;
  saldoAFavorAnterior: number | null;
};

/** Numeración oficial de las casillas principales del Formulario 210
 * (Resolución 000044 de 2024, modificada por la 000120 de 2024 — vigente
 * para AG2023 y siguientes), confirmada directamente contra el
 * instructivo publicado por la DIAN. Se usa para que el borrador muestre
 * el número real de casilla junto a cada valor, no una numeración
 * inventada. */
export const CASILLAS_210 = {
  patrimonioBruto: 29, deudas: 30, patrimonioLiquido: 31,
  trabajo: { ingresoBruto: 32, incrngo: 33, rentaLiquida: 34, rentaExentaAportes: 35, rentaExentaOtras: 36, totalRentaExenta: 37, deduccionVivienda: 38, deduccionOtras: 39, totalDeduccion: 40, limitadas: 41, rentaLiquidaOrdinaria: 42 },
  trabajoHonorarios: { ingresoBruto: 43, incrngo: 44, costos: 45, rentaLiquida: 46, rentaExentaAportes: 47, rentaExentaOtras: 48, totalRentaExenta: 49, deduccionVivienda: 50, deduccionOtras: 51, totalDeduccion: 52, limitadas: 53, rentaLiquidaOrdinaria: 54 },
  capital: { ingresoBruto: 58, incrngo: 59, costos: 60, rentaLiquida: 61, rentaExentaAportes: 63, rentaExentaOtras: 64, totalRentaExenta: 65, deduccionVivienda: 66, deduccionOtras: 67, totalDeduccion: 68, limitadas: 69, rentaLiquidaOrdinaria: 70 },
  noLaboral: { ingresoBruto: 74, incrngo: 76, costos: 77, rentaLiquida: 78, rentaExentaAportes: 80, rentaExentaOtras: 81, totalRentaExenta: 82, deduccionVivienda: 83, deduccionOtras: 84, totalDeduccion: 85, limitadas: 86, rentaLiquidaOrdinaria: 87 },
  rentaLiquidaCedulaGeneral: 88,
  pensiones: { ingresoBruto: 99, incrngo: 100, rentaLiquida: 101, rentaExenta: 102, rentaLiquidaGravable: 103 },
  dividendos: { ingresoBruto: 106 }, // tarifa especial Art. 242, no se suma al 241 — solo referencia
  rentaLiquidaGravableTotal: 111, impuesto: 116, totalImpuestoACargo: 130,
  saldoAFavorAnterior: 132, anticipoAnioAnterior: 131, anticipoProximoAnio: 134,
  totalSaldoAPagar: 137, totalSaldoAFavor: 138,
} as const;

const SUBRENTAS_GENERAL = ["trabajo", "trabajo_honorarios", "capital", "no_laboral"] as const;

export type ResultadoSubRenta = {
  ingresoBruto: number; ingresoNoConstitutivo: number; costoDeduccionProcedente: number;
  rentaLiquida: number; rentaExentaDisponible: number; deduccionDisponible: number;
  rentaExentaDeduccionAsignada: number; rentaLiquidaOrdinaria: number;
};

export type ResultadoLiquidacion = {
  patrimonioBruto: number; deudas: number; patrimonioLiquido: number;
  subRentas: Record<string, ResultadoSubRenta>; // trabajo, trabajo_honorarios, capital, no_laboral
  baseCalculoLimite: number;
  limite40PorcientoOMil340UVT: number;
  totalDisponibleGeneral: number;
  valorDistribuido: number;
  rentaLiquidaCedulaGeneral: number;
  ingresoBrutoPensiones: number; rentaLiquidaPensiones: number; rentaExentaPensiones: number; rentaLiquidaGravablePensiones: number;
  ingresoBrutoDividendos: number;
  rentaLiquidaGravableTotal: number;
  impuestoRenta: { impuesto: number; tarifaMarginal: number; rangoUVT: string };
  patrimonioLiquidoAnioAnterior: number | null;
  impuestoNetoAnioAnterior: number | null;
  saldoAFavorAnterior: number | null;
  anticipoEstimado: number | null;
};

/** Reúne los datos crudos por cédula (ya obtenidos de la base de datos) y
 * calcula la liquidación completa — replica el algoritmo real que el
 * instructivo del Formulario 210 describe para repartir el tope de
 * rentas exentas + deducciones (40% de la base, limitado a 1.340 UVT)
 * entre las 4 sub-rentas de la Cédula General, en el orden que indica la
 * DIAN: primero trabajo, luego trabajo por honorarios, después capital, y
 * por último no laboral — hasta agotar el valor disponible.
 *
 * Simplificaciones conscientes (documentadas también en el borrador):
 * no se manejan pérdidas ni compensaciones de pérdidas de años anteriores
 * por cédula, ni las rentas exentas/ECE que quedan fuera del límite del
 * 40% por convenios de doble tributación — casos especiales que el
 * contador debe ajustar manualmente si aplican. */
export function armarLiquidacion(datos: DatosLiquidacion): ResultadoLiquidacion {
  const patrimonioBruto = datos.activos.reduce((a, it) => a + it.valor, 0);
  const deudas = datos.pasivos.reduce((a, it) => a + it.valor, 0);
  const patrimonioLiquido = Math.max(0, patrimonioBruto - deudas);

  const vacio: DatosCedula = { ingresoBruto: [], ingresoNoConstitutivo: [], costoDeduccionProcedente: [], rentaExenta: [], deduccion: [] };
  const subRentasBase: Record<string, ResultadoSubRenta> = {};
  for (const nombre of SUBRENTAS_GENERAL) {
    const c = datos.cedulas[nombre] || vacio;
    const ingresoBruto = sumaItems(c.ingresoBruto);
    const ingresoNoConstitutivo = sumaItems(c.ingresoNoConstitutivo);
    const costoDeduccionProcedente = nombre === "trabajo" ? 0 : sumaItems(c.costoDeduccionProcedente);
    const rentaLiquida = Math.max(0, ingresoBruto - ingresoNoConstitutivo - costoDeduccionProcedente);
    const rentaExentaDisponible = sumaItems(c.rentaExenta);
    const deduccionDisponible = sumaItems(c.deduccion);
    subRentasBase[nombre] = {
      ingresoBruto, ingresoNoConstitutivo, costoDeduccionProcedente, rentaLiquida,
      rentaExentaDisponible, deduccionDisponible, rentaExentaDeduccionAsignada: 0, rentaLiquidaOrdinaria: rentaLiquida,
    };
  }

  // Base para el límite del 40%/1.340 UVT: suma de ingresos brutos menos
  // ingresos no constitutivos de las 4 sub-rentas (el instructivo no resta
  // costos en este paso — solo se restan al calcular la renta líquida de
  // cada sub-renta por separado).
  const baseCalculoLimite = SUBRENTAS_GENERAL.reduce(
    (a, n) => a + subRentasBase[n].ingresoBruto - subRentasBase[n].ingresoNoConstitutivo, 0,
  );
  const topeUVT = TOPES_DEDUCCION_2025.limiteGlobalDeduccionesRentasExentas * UVT_2025;
  const limite40PorcientoOMil340UVT = Math.min(baseCalculoLimite * 0.4, topeUVT);
  const totalDisponibleGeneral = SUBRENTAS_GENERAL.reduce(
    (a, n) => a + subRentasBase[n].rentaExentaDisponible + subRentasBase[n].deduccionDisponible, 0,
  );
  const valorDistribuido = Math.min(limite40PorcientoOMil340UVT, totalDisponibleGeneral);

  // Reparto en el orden oficial: trabajo → trabajo_honorarios → capital → no_laboral.
  let restante = valorDistribuido;
  for (const nombre of SUBRENTAS_GENERAL) {
    const sr = subRentasBase[nombre];
    const topeIndividual = Math.min(sr.rentaLiquida, sr.rentaExentaDisponible + sr.deduccionDisponible);
    const asignado = Math.max(0, Math.min(restante, topeIndividual));
    sr.rentaExentaDeduccionAsignada = asignado;
    sr.rentaLiquidaOrdinaria = Math.max(0, sr.rentaLiquida - asignado);
    restante -= asignado;
  }

  const rentaLiquidaCedulaGeneral = SUBRENTAS_GENERAL.reduce((a, n) => a + subRentasBase[n].rentaLiquidaOrdinaria, 0);

  const cPensiones = datos.cedulas["pensiones"] || vacio;
  const ingresoBrutoPensiones = sumaItems(cPensiones.ingresoBruto);
  const incrngoPensiones = sumaItems(cPensiones.ingresoNoConstitutivo);
  const rentaLiquidaPensiones = Math.max(0, ingresoBrutoPensiones - incrngoPensiones);
  const rentaExentaPensiones = sumaItems(cPensiones.rentaExenta);
  const rentaLiquidaGravablePensiones = Math.max(0, rentaLiquidaPensiones - rentaExentaPensiones);

  const cDividendos = datos.cedulas["dividendos"] || vacio;
  const ingresoBrutoDividendos = sumaItems(cDividendos.ingresoBruto);

  const rentaLiquidaGravableTotal = rentaLiquidaCedulaGeneral + rentaLiquidaGravablePensiones;
  const impuestoRenta = calcularImpuestoRenta(rentaLiquidaGravableTotal);

  let anticipoEstimado: number | null = null;
  if (datos.impuestoNetoAnioAnterior !== null && datos.impuestoNetoAnioAnterior !== undefined) {
    anticipoEstimado = Math.round(((impuestoRenta.impuesto + datos.impuestoNetoAnioAnterior) / 2) * 0.25);
  }

  return {
    patrimonioBruto, deudas, patrimonioLiquido, subRentas: subRentasBase,
    baseCalculoLimite, limite40PorcientoOMil340UVT, totalDisponibleGeneral, valorDistribuido,
    rentaLiquidaCedulaGeneral,
    ingresoBrutoPensiones, rentaLiquidaPensiones, rentaExentaPensiones, rentaLiquidaGravablePensiones,
    ingresoBrutoDividendos,
    rentaLiquidaGravableTotal, impuestoRenta,
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

function estilarEncabezadoRenta(row: ExcelJS.Row) {
  row.eachCell(c => { c.font = HEADER_FONT as any; c.fill = HEADER_FILL; });
}
const NOTA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF2D0" } };

const NOMBRE_CEDULA: Record<string, string> = {
  trabajo: "Rentas de trabajo", trabajo_honorarios: "Rentas de trabajo por honorarios/compensación (sin relación laboral)",
  capital: "Rentas de capital", no_laboral: "Rentas no laborales",
  pensiones: "Pensiones", dividendos: "Dividendos y participaciones",
};

/** Escribe una fila "casilla — etiqueta — valor", con la casilla en su
 * propia columna para que se vea como el formulario real. */
function filaCasilla(ws: ExcelJS.Worksheet, casilla: number | string, etiqueta: string, valor: number | string, negrita = false) {
  const r = ws.addRow([casilla, etiqueta, valor]);
  r.getCell(1).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF888888" } } as any;
  r.getCell(1).alignment = { horizontal: "center" };
  if (negrita) { r.getCell(2).font = FONT_BOLD as any; r.getCell(3).font = FONT_BOLD as any; }
  return r;
}

/** Genera el Excel del borrador del Formulario 210 — representación
 * gráfica con la numeración REAL de casillas del formulario oficial
 * (Resolución 000044/000120 de 2024, confirmada contra el instructivo de
 * la DIAN), organizada por secciones tal como aparece en el formulario:
 * Patrimonio → Cédula General (4 sub-rentas, en el mismo orden de reparto
 * que usa el servicio de diligenciamiento de la DIAN) → Pensiones →
 * Dividendos (referencia) → Liquidación del impuesto.
 *
 * No reemplaza la revisión profesional ni el diligenciamiento real en el
 * portal de la DIAN — es un apoyo para tenerlo prediligenciado y
 * revisado antes de pasarlo al formulario oficial. */
export async function generarBorrador210(
  resultado: ResultadoLiquidacion, clienteNombre: string, clienteCedula: string, anioGravable: number,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Renta Persona Natural";

  const ws = wb.addWorksheet("Borrador 210");
  ws.addRow([`BORRADOR FORMULARIO 210 · ${clienteNombre} (${clienteCedula}) · Año gravable ${anioGravable}`]).font = FONT_TITLE as any;
  ws.addRow([
    "Numeración real de casillas del Formulario 210 (Res. 000044/000120 de 2024) — apoyo para revisión, no reemplaza",
    "el diligenciamiento oficial ni el criterio profesional. No incluye pérdidas/compensaciones de años anteriores por cédula.",
  ]);
  ws.getRow(2).font = { name: "Arial", size: 9, italic: true } as any;
  ws.addRow([]);
  const hCasilla = ws.addRow(["Casilla", "Concepto", "Valor"]);
  estilarEncabezadoRenta(hCasilla);

  ws.addRow(["SECCIÓN PATRIMONIO"]).font = FONT_BOLD as any;
  filaCasilla(ws, CASILLAS_210.patrimonioBruto, "Total patrimonio bruto", resultado.patrimonioBruto);
  filaCasilla(ws, CASILLAS_210.deudas, "Deudas", resultado.deudas);
  filaCasilla(ws, CASILLAS_210.patrimonioLiquido, "Total patrimonio líquido (29 - 30)", resultado.patrimonioLiquido, true);
  ws.addRow([]);

  ws.addRow(["CÉDULA GENERAL"]).font = FONT_BOLD as any;
  const SUBRENTA_CASILLAS: { key: string; c: typeof CASILLAS_210.trabajo; titulo: string }[] = [
    { key: "trabajo", c: CASILLAS_210.trabajo, titulo: "Rentas de trabajo" },
    { key: "trabajo_honorarios", c: CASILLAS_210.trabajoHonorarios as any, titulo: "Rentas de trabajo por honorarios/compensación (sin relación laboral)" },
    { key: "capital", c: CASILLAS_210.capital as any, titulo: "Rentas de capital" },
    { key: "no_laboral", c: CASILLAS_210.noLaboral as any, titulo: "Rentas no laborales" },
  ];
  for (const { key, c, titulo } of SUBRENTA_CASILLAS) {
    const sr = resultado.subRentas[key];
    ws.addRow([titulo]).font = { name: "Arial", size: 10, bold: true, italic: true } as any;
    filaCasilla(ws, c.ingresoBruto, "Ingresos brutos", sr.ingresoBruto);
    filaCasilla(ws, c.incrngo, "Ingresos no constitutivos de renta", sr.ingresoNoConstitutivo);
    if ("costos" in c) filaCasilla(ws, (c as any).costos, "Costos y deducciones procedentes", sr.costoDeduccionProcedente);
    filaCasilla(ws, c.rentaLiquida, "Renta líquida", sr.rentaLiquida);
    filaCasilla(ws, c.totalRentaExenta, "Total rentas exentas disponibles", sr.rentaExentaDisponible);
    filaCasilla(ws, c.totalDeduccion, "Total deducciones imputables disponibles", sr.deduccionDisponible);
    filaCasilla(ws, c.limitadas, "Rentas exentas y/o deducciones (Limitadas)", sr.rentaExentaDeduccionAsignada);
    filaCasilla(ws, c.rentaLiquidaOrdinaria, "Renta líquida ordinaria", sr.rentaLiquidaOrdinaria, true);
  }
  ws.addRow([]);
  ws.addRow([
    "Cálculo del límite de rentas exentas + deducciones (Cédula General): 40% de la base (ingresos brutos menos ingresos",
    "no constitutivos de las 4 sub-rentas) limitado a 1.340 UVT — repartido en el orden oficial: trabajo, honorarios, capital, no laboral.",
  ]).eachCell(c => { c.fill = NOTA_FILL; c.font = { name: "Arial", size: 9 } as any; });
  ws.addRow(["Base para el cálculo del límite", resultado.baseCalculoLimite]);
  ws.addRow(["Límite (40% o 1.340 UVT, el menor)", resultado.limite40PorcientoOMil340UVT]);
  ws.addRow(["Total disponible (rentas exentas + deducciones de las 4 sub-rentas)", resultado.totalDisponibleGeneral]);
  ws.addRow(["Valor efectivamente repartido", resultado.valorDistribuido]);
  const rCG = filaCasilla(ws, CASILLAS_210.rentaLiquidaCedulaGeneral, "Renta líquida gravable Cédula General", resultado.rentaLiquidaCedulaGeneral, true);
  rCG.font = { name: "Arial", size: 11, bold: true } as any;
  ws.addRow([]);

  ws.addRow(["CÉDULA DE PENSIONES"]).font = FONT_BOLD as any;
  filaCasilla(ws, CASILLAS_210.pensiones.ingresoBruto, "Ingresos brutos por rentas de pensiones", resultado.ingresoBrutoPensiones);
  filaCasilla(ws, CASILLAS_210.pensiones.rentaLiquida, "Renta líquida", resultado.rentaLiquidaPensiones);
  filaCasilla(ws, CASILLAS_210.pensiones.rentaExenta, "Rentas exentas de pensiones", resultado.rentaExentaPensiones);
  filaCasilla(ws, CASILLAS_210.pensiones.rentaLiquidaGravable, "Renta líquida gravable cédula de pensiones", resultado.rentaLiquidaGravablePensiones, true);
  ws.addRow([]);

  ws.addRow(["CÉDULA DE DIVIDENDOS Y PARTICIPACIONES (referencia)"]).font = FONT_BOLD as any;
  filaCasilla(ws, CASILLAS_210.dividendos.ingresoBruto, "Dividendos y participaciones", resultado.ingresoBrutoDividendos);
  ws.addRow([
    "Los dividendos tienen tarifa especial propia (Art. 242 E.T.) — no se suman a la renta líquida gravable general,",
    "se liquidan aparte. Verificar el cálculo específico de este impuesto.",
  ]).eachCell(c => { c.fill = NOTA_FILL; c.font = { name: "Arial", size: 9 } as any; });
  ws.addRow([]);

  ws.addRow(["LIQUIDACIÓN DEL IMPUESTO"]).font = FONT_BOLD as any;
  filaCasilla(ws, CASILLAS_210.rentaLiquidaGravableTotal, "Renta líquida gravable (Cédula General + Pensiones)", resultado.rentaLiquidaGravableTotal, true);
  ws.addRow([
    `Tarifa marginal aplicada (Art. 241 E.T.): ${(resultado.impuestoRenta.tarifaMarginal * 100).toFixed(0)}% — rango ${resultado.impuestoRenta.rangoUVT}`,
  ]).font = { name: "Arial", size: 9, italic: true } as any;
  const rImpuesto = filaCasilla(ws, CASILLAS_210.impuesto, "IMPUESTO SOBRE LAS RENTAS LÍQUIDAS GRAVABLES", resultado.impuestoRenta.impuesto);
  rImpuesto.font = { name: "Arial", size: 11, bold: true } as any;
  ws.addRow([]);

  ws.addRow(["ANTICIPO Y SALDOS"]).font = FONT_BOLD as any;
  filaCasilla(ws, CASILLAS_210.saldoAFavorAnterior, "Saldo a favor año anterior", resultado.saldoAFavorAnterior ?? "—");
  ws.addRow(["Impuesto neto de renta año anterior (referencia)", resultado.impuestoNetoAnioAnterior ?? "—"]);
  const rAnticipo = filaCasilla(ws, CASILLAS_210.anticipoProximoAnio, "Anticipo estimado para el próximo año (referencia)", resultado.anticipoEstimado ?? "—", true);
  ws.addRow([
    "Nota: fórmula simple de referencia (promedio entre impuesto actual y anterior, al 25%) — el Art. 807 E.T. define",
    "porcentajes distintos según sea la primera, segunda, o siguientes declaraciones; verificar antes de usar como definitivo.",
  ]).eachCell(c => { c.fill = NOTA_FILL; c.font = { name: "Arial", size: 9 } as any; });

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 62;
  ws.getColumn(3).width = 20;
  ws.getColumn(3).numFmt = MONEY;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
