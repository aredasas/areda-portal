import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

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
// Frases del detalle que la propia DIAN usa y que indican que el ítem SÍ
// es un ingreso de la persona, aun cuando el archivo no trae un renglón
// sugerido para él (columna "Uso declaración Sugerida" vacía) — el caso
// más común es "Documento soporte" (compras que el pagador reportó a un
// independiente sin factura), que Areda confirmó que sí son ingresos
// reales y deben poder importarse a una cédula.
const FRASES_INGRESO_SIN_RENGLON = ["documento soporte", "documentos soporte"];

function quitarTildes(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function categorizar(renglon: string | null, detalle: string = ""): ItemExogena["categoria"] {
  if (renglon === "R29") return "patrimonio";
  if (renglon === "R30") return "deuda";
  if (renglon) return "ingreso";
  const detalleNormalizado = quitarTildes(detalle.toLowerCase());
  if (FRASES_INGRESO_SIN_RENGLON.some(f => detalleNormalizado.includes(f))) return "ingreso";
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

/** La DIAN publica los topes en UVT convertidos a pesos redondeados al
 * millar más cercano (confirmado contra el archivo Ayuda Renta 2025:
 * 4.500 UVT → $224.096.000, no $224.095.500; 1.625 UVT → $80.923.000,
 * no $80.923.375) — no es una simple multiplicación truncada. Se usa
 * para cualquier tope que se muestre en pantalla o en un documento,
 * para que coincida exacto con la cifra oficial. */
export function redondearPesosDian(valorExacto: number): number {
  return Math.round(valorExacto / 1000) * 1000;
}

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
  movimiento: 1400, // consignaciones bancarias, depósitos o inversiones financieras
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
  tipo: string; nombre: string; tipoValor: "deduccion" | "renta_exenta"; topeUVT: number | null; nota?: string;
}[] = [
  { tipo: "renta_exenta_25_laboral", nombre: "25% renta exenta de rentas de trabajo", tipoValor: "renta_exenta", topeUVT: TOPES_DEDUCCION_2025.rentaExentaLaboral25 },
  { tipo: "cesantias_intereses", nombre: "Cesantías e intereses de cesantías (Art. 206 num. 4 E.T.)", tipoValor: "renta_exenta", topeUVT: null,
    nota: "Exenta si el salario promedio de los últimos 6 meses no supera 350 UVT ($17.429.650) — si lo supera, aplica una tabla decreciente. Verificar manualmente el salario promedio antes de tomar el valor completo." },
  { tipo: "indemnizacion_accidente_enfermedad", nombre: "Indemnización por accidente de trabajo o enfermedad (Art. 206 num. 1 E.T.)", tipoValor: "renta_exenta", topeUVT: null,
    nota: "Exenta en su totalidad — verificar que corresponda efectivamente a esta indemnización." },
  { tipo: "auxilio_funerario", nombre: "Auxilio funerario / gastos de entierro del trabajador (Art. 206 num. 3 E.T.)", tipoValor: "renta_exenta", topeUVT: null,
    nota: "Exenta en su totalidad." },
  { tipo: "aportes_voluntarios_pension_afc", nombre: "Aportes voluntarios pensión / cuentas AFC", tipoValor: "renta_exenta", topeUVT: TOPES_DEDUCCION_2025.aportesVoluntariosPensionAFC },
  { tipo: "salud_prepagada", nombre: "Medicina prepagada / seguros de salud", tipoValor: "deduccion", topeUVT: TOPES_DEDUCCION_2025.saludPrepagada },
  { tipo: "dependientes_economicos", nombre: "Dependientes económicos", tipoValor: "deduccion", topeUVT: TOPES_DEDUCCION_2025.dependientes },
  { tipo: "intereses_vivienda", nombre: "Intereses de vivienda (crédito hipotecario/leasing)", tipoValor: "deduccion", topeUVT: TOPES_DEDUCCION_2025.interesesVivienda },
  { tipo: "gmf_25", nombre: "GMF (4×1000) — 25% deducible (Art. 115 E.T.)", tipoValor: "deduccion", topeUVT: null,
    nota: "Solo el 25% del GMF efectivamente pagado y certificado por el banco es deducible — digitar ya ese 25%, no el GMF total." },
  { tipo: "otro", nombre: "Otra deducción/renta exenta (verificar manualmente)", tipoValor: "deduccion", topeUVT: null },
];

/** Valida un valor digitado contra el tope individual de su tipo de
 * deducción/renta exenta — no reemplaza el criterio del contador, es una
 * alerta cuando el valor supera lo permitido por la norma. */
/** Valida un valor digitado contra el tope individual de su tipo de
 * deducción/renta exenta — no reemplaza el criterio del contador, es una
 * alerta cuando el valor supera lo permitido por la norma.
 *
 * Caso especial — aportes voluntarios a pensión/AFC (Art. 126-1 E.T.):
 * el tope real es el MENOR entre 3.800 UVT y el 30% del ingreso laboral
 * o tributario del año. Si se conoce el ingreso bruto de la cédula
 * (`ingresoBrutoCedula`), se valida contra ambos límites; si no se pasa
 * (ej. al validar sin ese contexto), se valida solo contra los 3.800 UVT
 * como antes. */
export function validarTopeDeduccion(
  tipoDeduccion: string, valor: number, ingresoBrutoCedula?: number,
): { excedeTope: boolean; tope: number | null; topeUVT: number | null } {
  const catalogo = TIPOS_DEDUCCION_RENTA_EXENTA.find(t => t.tipo === tipoDeduccion);
  if (!catalogo || catalogo.topeUVT === null) return { excedeTope: false, tope: null, topeUVT: null };
  let tope = redondearPesosDian(catalogo.topeUVT * UVT_2025);
  if (tipoDeduccion === "aportes_voluntarios_pension_afc" && ingresoBrutoCedula != null) {
    const topePorIngreso = Math.round(ingresoBrutoCedula * 0.30);
    tope = Math.min(tope, topePorIngreso);
  }
  return { excedeTope: valor > tope, tope, topeUVT: catalogo.topeUVT };
}

export type ItemValor = { concepto: string; valor: number; tipoDeduccion?: string | null; tipoGananciaOcasional?: string | null };

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
  /** Retenciones en la fuente practicadas sobre esta cédula — no entran
   * al cálculo de renta líquida gravable, se usan para el anticipo y como
   * referencia de lo ya recaudado. */
  retencion: ItemValor[];
};

function sumaItems(items: ItemValor[]): number {
  return items.reduce((a, it) => a + it.valor, 0);
}

export type DatosLiquidacion = {
  activos: { concepto: string; valor: number }[];
  pasivos: { concepto: string; valor: number }[];
  cedulas: Record<string, DatosCedula>; // trabajo, trabajo_honorarios, capital, no_laboral, pensiones, dividendos
  /** Descuentos tributarios (Art. 254-260 E.T. — impuestos pagados en el
   * exterior, donaciones, etc.) — a diferencia de las deducciones/rentas
   * exentas, estos NO reducen la renta líquida gravable: se restan
   * DIRECTAMENTE del impuesto de renta ya calculado, peso a peso. */
  descuentosTributarios: { concepto: string; valor: number }[];
  patrimonioLiquidoAnioAnterior: number | null;
  impuestoNetoAnioAnterior: number | null;
  saldoAFavorAnterior: number | null;
  /** Anticipo que la declaración anterior ya liquidó para el año que se
   * está trabajando ahora — se resta del total a pagar/favor. */
  anticipoAnioActual: number | null;
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

/** Tipos de ganancia ocasional con su tarifa vigente para el año gravable
 * 2025 (confirmada contra el Art. 317 E.T. para loterías/rifas/apuestas, y
 * la tarifa general del 15% para el resto) — hay una reforma tributaria en
 * trámite que subiría estas tarifas a 33%/30%, pero NO es ley todavía para
 * este año gravable; si se aprueba para años futuros, este es el único
 * lugar que habría que actualizar. */
export const TIPOS_GANANCIA_OCASIONAL: { tipo: string; nombre: string; tarifa: number }[] = [
  { tipo: "loteria_rifa_apuesta", nombre: "Loterías, rifas, apuestas y similares (Art. 317 E.T.)", tarifa: 0.20 },
  { tipo: "herencia_legado_donacion", nombre: "Herencias, legados y donaciones", tarifa: 0.15 },
  { tipo: "venta_activos_2_anios", nombre: "Venta de activos fijos poseídos 2 años o más", tarifa: 0.15 },
  { tipo: "liquidacion_sociedad", nombre: "Liquidación de sociedades", tarifa: 0.15 },
  { tipo: "seguro_vida", nombre: "Indemnizaciones por seguro de vida", tarifa: 0.15 },
  { tipo: "otro", nombre: "Otra ganancia ocasional", tarifa: 0.15 },
];

// ==================== SOLICITUD DE DOCUMENTOS AL CLIENTE ====================

export type ItemDocumento = { id: string; concepto: string };
export type CategoriaDocumentos = { categoria: string; items: ItemDocumento[] };

/** Catálogo de documentos que se le suelen pedir a un cliente de renta
 * persona natural — tomado del checklist que Areda ya usaba en Word,
 * organizado por categoría. Cada ítem lleva un id estable (categoria-índice)
 * para poder marcarlo desde la interfaz. */
export const CATALOGO_DOCUMENTOS_RENTA: CategoriaDocumentos[] = [
  { categoria: "Información personal", items: [
    "RUT", "Cámara de comercio", "Declaración del año inmediatamente anterior", "Contraseña de acceso al portal DIAN",
  ] },
  { categoria: "Patrimonio bruto", items: [
    "Extractos bancarios de cuentas de ahorro y corriente (diciembre)", "Certificado del fondo de cesantías",
    "Certificado de inversiones", "Listado de bienes inmuebles y muebles", "Impuesto de vehículo",
    "Impuesto predial", "Certificado de libertad y tradición",
  ] },
  { categoria: "Obligaciones", items: [
    "Relación y certificados de obligaciones financieras", "Certificado de tarjetas de crédito",
    "Certificado de créditos educativos", "Relación de deudas con particulares", "Otras deudas con soporte",
  ] },
  { categoria: "Renta de trabajo", items: [
    "Certificado anual de retención en la fuente (servicios prestados u otros ingresos no laborales)",
    "Certificado de ingresos y retenciones (Formulario 220)",
  ] },
  { categoria: "Renta de pensionados", items: ["Certificado de ingresos pensionales"] },
  { categoria: "Rentas de capital", items: [
    "Información de ingresos por arrendamiento", "Información de gastos por arrendamiento",
    "Certificado de ingresos por rendimientos financieros", "Certificado de ingresos por intereses",
  ] },
  { categoria: "Rentas no laborales", items: [
    "Estados financieros", "Relación de ingresos del negocio", "Información de costos y gastos del negocio",
    "Inventario (mercancías y propiedades)", "Declaraciones de IVA del año anterior", "Pago de industria y comercio",
  ] },
  { categoria: "Deducibles", items: [
    "Certificado de intereses pagados en crédito hipotecario", "Certificado de indemnización (seguros)",
    "Certificado de aporte a fondo de pensiones voluntarios", "Comprobante de retiro de cesantías",
    "Constancia de pagos de medicina prepagada", "Relación de aportes a seguridad social",
    "Certificado de donaciones (si aplica)", "Documento de identidad de los dependientes (especificar el tipo)",
    "Certificado de aporte a fomento a la construcción",
  ] },
].map((cat, ci) => ({
  categoria: cat.categoria,
  items: cat.items.map((concepto, ii) => ({ id: `${ci}-${ii}`, concepto })),
}));

/** A partir de lo que trae la exógena ya cargada, sugiere qué categorías
 * de documentos conviene marcar — es una sugerencia basada en palabras
 * clave del detalle de cada ítem, no un análisis exhaustivo; el contador
 * revisa y ajusta antes de generar la solicitud. */
export function recomendarCategoriasDocumentos(itemsExogena: { categoria: string; detalle: string }[]): Set<string> {
  const recomendadas = new Set<string>(["Información personal", "Deducibles"]); // aplican casi siempre
  const quitarTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const detalleTodo = quitarTildes(itemsExogena.map(it => it.detalle.toLowerCase()).join(" | "));
  const hayCategoria = (cat: string) => itemsExogena.some(it => it.categoria === cat);

  if (hayCategoria("patrimonio")) recomendadas.add("Patrimonio bruto");
  if (hayCategoria("deuda")) recomendadas.add("Obligaciones");
  if (/salari|nomina|laboral/.test(detalleTodo)) recomendadas.add("Renta de trabajo");
  if (/pension/.test(detalleTodo)) recomendadas.add("Renta de pensionados");
  if (/arrend|interes|rendimiento|dividendo/.test(detalleTodo)) recomendadas.add("Rentas de capital");
  if (/honorario|independiente|actividad economica|servicio/.test(detalleTodo)) recomendadas.add("Rentas no laborales");
  return recomendadas;
}


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
  totalRetenciones: number;
  /** Descuentos tributarios (impuestos exterior, donaciones, etc.) — se
   * restan directamente del impuesto de renta ya calculado, no de la
   * base. impuestoNetoDespuesDescuentos nunca baja de 0. */
  totalDescuentosTributarios: number;
  impuestoNetoDespuesDescuentos: number;
  patrimonioLiquidoAnioAnterior: number | null;
  impuestoNetoAnioAnterior: number | null;
  saldoAFavorAnterior: number | null;
  anticipoAnioActual: number | null;
  /** Dos métodos del Art. 807 E.T. para el anticipo del año siguiente —
   * se calculan ambos para que el contador elija cuál aplica (además de
   * verificar si es la primera o segunda declaración, casos especiales
   * que no se calculan aquí). Se calculan sobre el impuesto YA NETO de
   * descuentos tributarios (impuestoNetoDespuesDescuentos), que es el
   * impuesto a cargo real. Ambos ya restan las retenciones y quedan en
   * 0 si el resultado da negativo. */
  anticipoMetodo1: number;
  anticipoMetodo2: number;
  /** Ganancia ocasional — cada tipo tiene su propia tarifa (20% loterías,
   * 15% el resto), por eso se calcula el impuesto por tipo y se suma. */
  gananciaOcasional: {
    porTipo: Record<string, { ingresoBruto: number; costos: number; rentaExenta: number; netoGravable: number; impuesto: number; tarifa: number }>;
    totalIngresoBruto: number;
    totalNetoGravable: number;
    totalImpuesto: number;
  };
  /** Renta por comparación patrimonial (Arts. 236-239 E.T.) — se calcula
   * siempre que se conozca el patrimonio líquido del año anterior (no solo
   * cuando hay un excedente sin justificar), para que el valor sea visible
   * de referencia aunque no dispare una alerta. No incluye ganancia
   * ocasional neta (no modelada como "renta gravable" en este cálculo,
   * son regímenes separados) — si aplica, sumarla manualmente. */
  comparacionPatrimonial: {
    diferenciaPatrimonial: number; totalRentasExentas: number; impuestoPagadoDuranteElAnio: number;
    rentaLiquidaAjustada: number; excedente: number;
  } | null;
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

  const vacio: DatosCedula = { ingresoBruto: [], ingresoNoConstitutivo: [], costoDeduccionProcedente: [], rentaExenta: [], deduccion: [], retencion: [] };
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
  const topeUVT = redondearPesosDian(TOPES_DEDUCCION_2025.limiteGlobalDeduccionesRentasExentas * UVT_2025);
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

  // Retenciones practicadas — de todas las cédulas (Cédula General +
  // pensiones + dividendos), se restan por igual en cualquiera de los dos
  // métodos de anticipo.
  const todasLasCedulas = [...SUBRENTAS_GENERAL, "pensiones", "dividendos"];
  const totalRetenciones = todasLasCedulas.reduce((a, n) => a + sumaItems((datos.cedulas[n] || vacio).retencion), 0);

  // Descuentos tributarios (Art. 254-260 E.T.) — se restan directamente
  // del impuesto ya calculado, no de la base gravable. Nunca bajan de 0.
  const totalDescuentosTributarios = (datos.descuentosTributarios || []).reduce((a, it) => a + it.valor, 0);
  const impuestoNetoDespuesDescuentos = Math.max(0, Math.round(impuestoRenta.impuesto - totalDescuentosTributarios));

  // Anticipo de renta (Art. 807 E.T.) — dos métodos posibles, el
  // contador elige cuál aplica según el caso (primera/segunda/siguiente
  // declaración, o cuál da un valor más razonable). Se calculan sobre el
  // impuesto YA NETO de descuentos tributarios, que es el impuesto a
  // cargo real:
  // Método 1: impuesto neto de este año × 75% − retenciones.
  // Método 2: promedio(impuesto neto año anterior, impuesto neto de este
  // año) × 75% − retenciones.
  // Ambos quedan en 0 si el resultado da negativo.
  const anticipoMetodo1 = Math.max(0, Math.round(impuestoNetoDespuesDescuentos * 0.75 - totalRetenciones));
  let anticipoMetodo2 = 0;
  if (datos.impuestoNetoAnioAnterior !== null && datos.impuestoNetoAnioAnterior !== undefined) {
    const promedio = (impuestoNetoDespuesDescuentos + datos.impuestoNetoAnioAnterior) / 2;
    anticipoMetodo2 = Math.max(0, Math.round(promedio * 0.75 - totalRetenciones));
  }

  // Ganancia ocasional — se calcula el impuesto por tipo (cada uno con su
  // propia tarifa) y se suma. netoGravable = ingreso bruto - costos -
  // renta exenta, sin bajar de 0.
  const cGananciaOcasional = datos.cedulas["ganancia_ocasional"] || vacio;
  const porTipoGO: Record<string, { ingresoBruto: number; costos: number; rentaExenta: number; netoGravable: number; impuesto: number; tarifa: number }> = {};
  for (const tipo of TIPOS_GANANCIA_OCASIONAL) {
    const ingresoBrutoTipo = cGananciaOcasional.ingresoBruto.filter(it => it.tipoGananciaOcasional === tipo.tipo).reduce((a, it) => a + it.valor, 0);
    const costosTipo = cGananciaOcasional.costoDeduccionProcedente.filter(it => it.tipoGananciaOcasional === tipo.tipo).reduce((a, it) => a + it.valor, 0);
    const rentaExentaTipo = cGananciaOcasional.rentaExenta.filter(it => it.tipoGananciaOcasional === tipo.tipo).reduce((a, it) => a + it.valor, 0);
    const netoGravable = Math.max(0, ingresoBrutoTipo - costosTipo - rentaExentaTipo);
    const impuesto = Math.round(netoGravable * tipo.tarifa);
    if (ingresoBrutoTipo > 0 || costosTipo > 0 || rentaExentaTipo > 0) {
      porTipoGO[tipo.tipo] = { ingresoBruto: ingresoBrutoTipo, costos: costosTipo, rentaExenta: rentaExentaTipo, netoGravable, impuesto, tarifa: tipo.tarifa };
    }
  }
  const gananciaOcasional = {
    porTipo: porTipoGO,
    totalIngresoBruto: Object.values(porTipoGO).reduce((a, v) => a + v.ingresoBruto, 0),
    totalNetoGravable: Object.values(porTipoGO).reduce((a, v) => a + v.netoGravable, 0),
    totalImpuesto: Object.values(porTipoGO).reduce((a, v) => a + v.impuesto, 0),
  };

  // Renta por comparación patrimonial (Arts. 236-239 E.T.) — siempre
  // visible cuando se conoce el patrimonio líquido del año anterior, no
  // solo cuando hay excedente sin justificar.
  let comparacionPatrimonial: ResultadoLiquidacion["comparacionPatrimonial"] = null;
  if (datos.patrimonioLiquidoAnioAnterior != null) {
    const totalRentasExentasCP = Object.values(datos.cedulas).reduce(
      (a, c) => a + c.rentaExenta.reduce((s, it) => s + it.valor, 0), 0,
    );
    const impuestoPagadoDuranteElAnio = totalRetenciones + (datos.anticipoAnioActual || 0);
    const diferenciaPatrimonial = patrimonioLiquido - datos.patrimonioLiquidoAnioAnterior;
    const rentaLiquidaAjustada = rentaLiquidaGravableTotal + totalRentasExentasCP - impuestoPagadoDuranteElAnio;
    comparacionPatrimonial = {
      diferenciaPatrimonial, totalRentasExentas: totalRentasExentasCP, impuestoPagadoDuranteElAnio,
      rentaLiquidaAjustada, excedente: diferenciaPatrimonial - rentaLiquidaAjustada,
    };
  }

  return {
    patrimonioBruto, deudas, patrimonioLiquido, subRentas: subRentasBase,
    baseCalculoLimite, limite40PorcientoOMil340UVT, totalDisponibleGeneral, valorDistribuido,
    rentaLiquidaCedulaGeneral,
    ingresoBrutoPensiones, rentaLiquidaPensiones, rentaExentaPensiones, rentaLiquidaGravablePensiones,
    ingresoBrutoDividendos,
    rentaLiquidaGravableTotal, impuestoRenta, totalRetenciones,
    totalDescuentosTributarios, impuestoNetoDespuesDescuentos,
    patrimonioLiquidoAnioAnterior: datos.patrimonioLiquidoAnioAnterior ?? null,
    impuestoNetoAnioAnterior: datos.impuestoNetoAnioAnterior ?? null,
    saldoAFavorAnterior: datos.saldoAFavorAnterior ?? null,
    anticipoAnioActual: datos.anticipoAnioActual ?? null,
    anticipoMetodo1, anticipoMetodo2,
    gananciaOcasional, comparacionPatrimonial,
  };
}

export type HallazgoValidacion = {
  severidad: "error" | "advertencia" | "info";
  categoria: string;
  mensaje: string;
};

/** Revisa la liquidación completa contra los topes individuales y
 * generales, y genera recomendaciones — esta lista se piensa para ir
 * creciendo con el tiempo a medida que surjan más validaciones útiles,
 * no es un checklist cerrado. `contexto` trae datos externos (de la
 * exógena) que no vienen en DatosLiquidacion, para poder conciliar. */
export function validarRenta(
  datos: DatosLiquidacion, resultado: ResultadoLiquidacion,
  contexto?: { exogenaIngresoBruto?: number | null; tieneDependientes?: boolean },
): HallazgoValidacion[] {
  const hallazgos: HallazgoValidacion[] = [];
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

  // 1. Tope individual de cada deducción/renta exenta ya cargada.
  for (const [cedula, c] of Object.entries(datos.cedulas)) {
    const ingresoBrutoCedula = c.ingresoBruto.reduce((a, i) => a + i.valor, 0);
    for (const it of [...c.deduccion, ...c.rentaExenta]) {
      if (!it.tipoDeduccion) continue;
      const { excedeTope, tope, topeUVT } = validarTopeDeduccion(it.tipoDeduccion, it.valor, ingresoBrutoCedula);
      if (excedeTope) {
        const notaTope = it.tipoDeduccion === "aportes_voluntarios_pension_afc"
          ? ` (tope real: el menor entre 3.800 UVT y el 30% del ingreso bruto de esta cédula)`
          : ` (${topeUVT} UVT)`;
        hallazgos.push({
          severidad: "error", categoria: "Tope individual",
          mensaje: `"${it.concepto}" (${NOMBRE_CEDULA[cedula] || cedula}) supera el tope de ${fmt(tope!)}${notaTope} — valor cargado: ${fmt(it.valor)}.`,
        });
      }
      const catalogo = TIPOS_DEDUCCION_RENTA_EXENTA.find(t => t.tipo === it.tipoDeduccion);
      if (catalogo?.nota) {
        hallazgos.push({ severidad: "info", categoria: "Verificar manualmente", mensaje: `"${it.concepto}": ${catalogo.nota}` });
      }
    }
  }

  // 2. Tope global de la Cédula General (40% / 1.340 UVT).
  const topeGlobalPesos = redondearPesosDian(TOPES_DEDUCCION_2025.limiteGlobalDeduccionesRentasExentas * UVT_2025);
  const totalGeneralSinCapear = SUBRENTAS_GENERAL.reduce(
    (a, n) => a + datos.cedulas[n]?.deduccion.reduce((s, it) => s + it.valor, 0) + (datos.cedulas[n]?.rentaExenta.reduce((s, it) => s + it.valor, 0) || 0), 0,
  );
  if (totalGeneralSinCapear > resultado.limite40PorcientoOMil340UVT) {
    hallazgos.push({
      severidad: "advertencia", categoria: "Tope global Cédula General",
      mensaje: `Las deducciones y rentas exentas cargadas (${fmt(totalGeneralSinCapear)}) superan el límite calculado (${fmt(resultado.limite40PorcientoOMil340UVT)}) — el sistema ya repartió el máximo permitido entre las sub-rentas, pero el excedente no se aprovecha.`,
    });
  }

  // 3. Costos/deducciones imputables > 60% en trabajo por honorarios.
  const srHonorarios = resultado.subRentas["trabajo_honorarios"];
  if (srHonorarios && srHonorarios.ingresoBruto > 0) {
    const pct = (srHonorarios.costoDeduccionProcedente / srHonorarios.ingresoBruto) * 100;
    if (pct > 60) {
      hallazgos.push({
        severidad: "advertencia", categoria: "Costos honorarios",
        mensaje: `Los costos/deducciones procedentes en Rentas de trabajo por honorarios son ${pct.toFixed(1)}% de los ingresos brutos — supera el 60% de referencia habitual, verificar soportes.`,
      });
    }
  }

  // 4. Dependientes registrados sin la deducción correspondiente.
  if (contexto?.tieneDependientes) {
    const yaTiene = Object.values(datos.cedulas).some(c => c.deduccion.some(it => it.tipoDeduccion === "dependientes_economicos"));
    if (!yaTiene) {
      hallazgos.push({
        severidad: "info", categoria: "Dependientes",
        mensaje: "Hay dependientes económicos registrados pero todavía no se agregó la deducción del 10% correspondiente en ninguna cédula.",
      });
    }
  }

  // 5. Conciliación con los ingresos brutos que la propia exógena reporta.
  if (contexto?.exogenaIngresoBruto != null) {
    const totalIngresosCargados = SUBRENTAS_GENERAL.reduce((a, n) => a + resultado.subRentas[n].ingresoBruto, 0)
      + resultado.ingresoBrutoPensiones + resultado.ingresoBrutoDividendos;
    const diferencia = Math.abs(totalIngresosCargados - contexto.exogenaIngresoBruto);
    if (diferencia > 100000) {
      hallazgos.push({
        severidad: "advertencia", categoria: "Conciliación exógena",
        mensaje: `Los ingresos brutos cargados en las cédulas (${fmt(totalIngresosCargados)}) difieren de los reportados en la exógena (${fmt(contexto.exogenaIngresoBruto)}) por ${fmt(diferencia)} — revisar si falta importar algún ingreso.`,
      });
    }
  }

  // 6. Obligación de declarar (mismos topes que se muestran en la tarjeta de Topes).
  const patrimonioObligaTope = redondearPesosDian(TOPES_DEDUCCION_2025.patrimonio * UVT_2025);
  if (resultado.patrimonioBruto >= patrimonioObligaTope) {
    hallazgos.push({ severidad: "info", categoria: "Obligación de declarar", mensaje: `El patrimonio bruto (${fmt(resultado.patrimonioBruto)}) supera el tope de 4.500 UVT (${fmt(patrimonioObligaTope)}) — obligado a declarar por este criterio.` });
  }

  // 7. Sin retenciones cargadas, teniendo ingresos.
  const hayIngresos = SUBRENTAS_GENERAL.some(n => resultado.subRentas[n].ingresoBruto > 0) || resultado.ingresoBrutoPensiones > 0;
  if (hayIngresos && resultado.totalRetenciones === 0) {
    hallazgos.push({ severidad: "info", categoria: "Retenciones", mensaje: "No hay retenciones practicadas cargadas — confirmar si el cliente no tuvo, o si falta cargarlas (afecta el cálculo del anticipo)." });
  }

  // 8. Dividendos — recordatorio de tarifa especial no calculada aquí.
  if (resultado.ingresoBrutoDividendos > 0) {
    hallazgos.push({ severidad: "info", categoria: "Dividendos", mensaje: "Hay dividendos registrados — su tarifa especial (Art. 242 E.T.) no se calcula en este módulo, liquidar aparte." });
  }

  // 9. Renta por comparación patrimonial (Arts. 236-239 E.T.) — el cálculo
  // en sí siempre se muestra en el resumen (visible aunque no haya
  // problema); aquí solo se marca como hallazgo cuando hay un excedente
  // sin justificar.
  if (resultado.comparacionPatrimonial && resultado.comparacionPatrimonial.excedente > 0) {
    const { diferenciaPatrimonial, rentaLiquidaAjustada, excedente } = resultado.comparacionPatrimonial;
    hallazgos.push({
      severidad: "advertencia", categoria: "Comparación patrimonial (Arts. 236-239 E.T.)",
      mensaje: `El patrimonio líquido creció ${fmt(diferenciaPatrimonial)} pero la renta líquida gravable más rentas exentas menos impuesto pagado en el año solo explica ${fmt(rentaLiquidaAjustada)} — hay ${fmt(excedente)} de incremento patrimonial sin justificar, que debe declararse como renta gravable adicional salvo que se demuestre causa justificativa (no incluye ganancias ocasionales, que se liquidan aparte).`,
    });
  }

  return hallazgos;
}

/** Parsea un Excel simple de 2 columnas (Nombre, Cédula) para importar en
 * bloque el listado de clientes de renta — acepta el nombre y la cédula
 * en cualquiera de las 2 primeras columnas con encabezado, sin importar
 * el orden exacto de las palabras del encabezado (usa sinónimos simples).
 * Ignora filas vacías o sin cédula. */
export function parseListadoClientesRenta(buffer: Buffer): { nombre: string; cedula: string }[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const filas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null });
  if (filas.length === 0) return [];

  const encabezado = filas[0].map(v => String(v ?? "").trim().toUpperCase());
  let colNombre = encabezado.findIndex(h => h.includes("NOMBRE"));
  let colCedula = encabezado.findIndex(h => h.includes("CEDULA") || h.includes("CÉDULA") || h.includes("NIT") || h.includes("IDENTIFICACION") || h.includes("IDENTIFICACIÓN"));
  // Si no se reconoce el encabezado, se asume Nombre en A y Cédula en B.
  if (colNombre === -1) colNombre = 0;
  if (colCedula === -1) colCedula = 1;

  const resultado: { nombre: string; cedula: string }[] = [];
  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i];
    if (!fila) continue;
    const nombre = String(fila[colNombre] ?? "").trim();
    const cedulaRaw = fila[colCedula];
    if (!nombre || cedulaRaw === null || cedulaRaw === undefined || cedulaRaw === "") continue;
    const cedula = String(cedulaRaw).trim().replace(/[.,\s]/g, "");
    if (!cedula) continue;
    resultado.push({ nombre, cedula });
  }
  return resultado;
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
        // Confirmado contra el archivo real: la columna B (índice 1) es
        // siempre el nombre del tercero que reporta — se usa directo en
        // vez de adivinar por palabra clave o posición relativa, que
        // venía fallando (mostraba el declarante en vez del informante).
        const nombreColumnaB = values.length > 1 && values[1] ? 1 : -1;

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
          nombreTercero: nombreColumnaB >= 0 ? nombreColumnaB : (nombreIdxs[1] ?? nombreIdxs[0] ?? -1),
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
      categoria: categorizar(renglon, detalleTexto),
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
  ws.addRow(["Total retenciones practicadas (todas las cédulas)", resultado.totalRetenciones]);
  filaCasilla(ws, CASILLAS_210.anticipoAnioAnterior, "Anticipo ya liquidado el año anterior para este año", resultado.anticipoAnioActual ?? "—");
  ws.addRow([]);
  ws.addRow(["Anticipo para el próximo año — dos métodos (Art. 807 E.T.), verificar cuál aplica:"]).font = FONT_BOLD as any;
  filaCasilla(ws, CASILLAS_210.anticipoProximoAnio, "Método 1: impuesto neto de este año × 75% − retenciones", resultado.anticipoMetodo1);
  filaCasilla(ws, CASILLAS_210.anticipoProximoAnio, "Método 2: promedio(impuesto año anterior, este año) × 75% − retenciones", resultado.anticipoMetodo2);
  ws.addRow([
    "Nota: el Art. 807 E.T. define además si corresponde 0% (primera declaración), 25% o 50% en vez de 75% según el",
    "caso — verificar antes de usar como definitivo. Ambos métodos ya quedan en 0 si el resultado da negativo.",
  ]).eachCell(c => { c.fill = NOTA_FILL; c.font = { name: "Arial", size: 9 } as any; });

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 62;
  ws.getColumn(3).width = 20;
  ws.getColumn(3).numFmt = MONEY;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const SUBRENTAS_ANEXO: { key: string; titulo: string }[] = [
  { key: "trabajo", titulo: "Rentas de trabajo" },
  { key: "trabajo_honorarios", titulo: "Rentas de trabajo por honorarios/compensación (sin relación laboral)" },
  { key: "capital", titulo: "Rentas de capital" },
  { key: "no_laboral", titulo: "Rentas no laborales" },
];

/** Genera los 2 anexos de renta en un solo PDF (uno por página): el
 * Anexo 1 con el detalle de ingresos/INCRNGO/costos/deducciones/rentas
 * exentas por cédula (muy similar a lo que se ve en pantalla), y el
 * Anexo 2 con el detalle de activos y pasivos. Es un documento de apoyo
 * para el cliente/revisión — no reemplaza el borrador Excel ni el
 * diligenciamiento oficial. */
/** Logo horizontal de Areda (fondo transparente) — se incluye en el pie de
 * cada página de los anexos en PDF. Base64 para no depender de un archivo
 * externo en el deploy. */
const LOGO_AREDA_BASE64 = "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";

/** Dibuja el logo centrado en el pie de la página actual del documento. */
function dibujarPiePaginaAreda(doc: PDFKit.PDFDocument) {
  try {
    const anchoLogo = 90;
    const altoLogo = anchoLogo * (207 / 654);
    const x = (doc.page.width - anchoLogo) / 2;
    const y = doc.page.height - altoLogo - 28;
    doc.image(Buffer.from(LOGO_AREDA_BASE64, "base64"), x, y, { width: anchoLogo });
  } catch {
    // Si el logo no se puede dibujar por algún motivo, no debe romper la
    // generación del PDF — se omite en silencio.
  }
}

/** Genera el PDF de solicitud de documentos para el cliente — mismo estilo
 * visual que los anexos (encabezado, logo al pie), con los conceptos que
 * el contador haya marcado como necesarios, agrupados por categoría, más
 * los documentos adicionales y las observaciones que se hayan escrito. */
export async function generarSolicitudDocumentos(
  clienteNombre: string, clienteCedula: string, anioGravable: number,
  itemsSeleccionados: Set<string>, documentosAdicionales: string[], observaciones: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "letter", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 100;
  const xLabel = 50;

  doc.fontSize(13).font("Helvetica-Bold").text("SOLICITUD DE DOCUMENTOS", { align: "center" });
  doc.fontSize(11).font("Helvetica-Bold").text(`Declaración de renta — Año gravable ${anioGravable}`, { align: "center" });
  doc.moveDown(1);

  doc.fontSize(10).font("Helvetica").fillColor("#000000").text(
    `Señor(a) ${clienteNombre}, esta es la solicitud de documentos adicionales para la elaboración de su ` +
    `declaración de renta. Por favor allegar los siguientes documentos, según apliquen a su situación:`,
    { width: anchoUtil, align: "justify" },
  );
  doc.moveDown(1);

  for (const cat of CATALOGO_DOCUMENTOS_RENTA) {
    const itemsMarcados = cat.items.filter(it => itemsSeleccionados.has(it.id));
    if (itemsMarcados.length === 0) continue;
    doc.font("Helvetica-Bold").fontSize(10.5).text(cat.categoria);
    doc.moveDown(0.15);
    for (const it of itemsMarcados) {
      doc.font("Helvetica").fontSize(9.5).text(`[   ] ${it.concepto}`, xLabel + 8, doc.y, { width: anchoUtil - 8 });
    }
    doc.moveDown(0.5);
  }

  if (documentosAdicionales.length > 0) {
    doc.font("Helvetica-Bold").fontSize(10.5).text("Otros documentos solicitados");
    doc.moveDown(0.15);
    for (const texto of documentosAdicionales) {
      doc.font("Helvetica").fontSize(9.5).text(`[   ] ${texto}`, xLabel + 8, doc.y, { width: anchoUtil - 8 });
    }
    doc.moveDown(0.5);
  }

  if (observaciones.trim()) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(10.5).text("Observaciones generales");
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(9.5).text(observaciones.trim(), xLabel, doc.y, { width: anchoUtil, align: "justify" });
    doc.moveDown(0.5);
  }

  doc.moveDown(2);
  doc.moveTo(xLabel + 60, doc.y).lineTo(xLabel + 60 + 220, doc.y).strokeColor("#333333").stroke();
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(9.5).text("Firma Contribuyente", xLabel + 60, doc.y, { width: 220, align: "center" });

  dibujarPiePaginaAreda(doc);
  doc.end();
  return done;
}

export async function generarAnexosRenta(
  datos: DatosLiquidacion, resultado: ResultadoLiquidacion, clienteNombre: string, clienteCedula: string, anioGravable: number,
  dependientes: { nombre: string; tipoDocumento: string; numeroDocumento: string }[] = [],
): Promise<Buffer> {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "letter", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 100;
  const xLabel = 50;
  const xValor = doc.page.width - 50;

  function encabezado(titulo: string) {
    doc.fontSize(13).font("Helvetica-Bold").text(titulo, { align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
      .text(`${clienteNombre} (${clienteCedula}) · Año gravable ${anioGravable}`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1);
  }

  function filaTexto(label: string, valor: string, opciones?: { negrita?: boolean; color?: string; indent?: number }) {
    const anchoLabel = anchoUtil - 150 - (opciones?.indent || 0);
    const y = doc.y;
    doc.font(opciones?.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(opciones?.color || "#000000");
    // height:12 obliga a pdfkit a truncar con "…" en una sola línea en vez
    // de saltar de línea — sin el height explícito, ellipsis no truncaba
    // (seguía envolviendo el texto y desalineaba las filas siguientes).
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

  // ================= ANEXO 1: Ingresos, INCRNGO, deducciones, rentas exentas =================
  encabezado("ANEXO 1 — DETALLE DE INGRESOS, INCRNGO, DEDUCCIONES Y RENTAS EXENTAS");

  for (const { key, titulo } of SUBRENTAS_ANEXO) {
    const c = datos.cedulas[key];
    if (!c || c.ingresoBruto.length === 0) continue; // solo las cédulas con datos, para no saturar

    doc.font("Helvetica-Bold").fontSize(11).text(titulo);
    doc.moveDown(0.2);
    for (const it of c.ingresoBruto) filaTexto(it.concepto, fmt(it.valor), { indent: 8 });
    for (const it of c.ingresoNoConstitutivo) filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    for (const it of c.costoDeduccionProcedente) filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    for (const it of c.deduccion) filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    for (const it of c.rentaExenta) filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    doc.moveDown(0.2);
    lineaDivisoria();
    const sr = resultado.subRentas[key];
    filaTexto("Total renta cédula", fmt(sr?.rentaLiquidaOrdinaria || 0), { negrita: true });
    doc.moveDown(0.8);
  }

  if (resultado.ingresoBrutoPensiones > 0) {
    doc.font("Helvetica-Bold").fontSize(11).text("Pensiones");
    doc.moveDown(0.2);
    for (const it of datos.cedulas["pensiones"]?.ingresoBruto || []) filaTexto(it.concepto, fmt(it.valor), { indent: 8 });
    for (const it of datos.cedulas["pensiones"]?.ingresoNoConstitutivo || []) filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    for (const it of datos.cedulas["pensiones"]?.rentaExenta || []) filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    lineaDivisoria();
    filaTexto("Renta líquida gravable cédula de pensiones", fmt(resultado.rentaLiquidaGravablePensiones), { negrita: true });
    doc.moveDown(0.8);
  }

  if (resultado.ingresoBrutoDividendos > 0) {
    doc.font("Helvetica-Bold").fontSize(11).text("Dividendos y participaciones (referencia — tarifa especial Art. 242 E.T., no incluida aquí)");
    doc.moveDown(0.2);
    for (const it of datos.cedulas["dividendos"]?.ingresoBruto || []) filaTexto(it.concepto, fmt(it.valor), { indent: 8 });
    doc.moveDown(0.8);
  }

  if (resultado.gananciaOcasional.totalIngresoBruto > 0) {
    doc.font("Helvetica-Bold").fontSize(11).text("Ganancia Ocasional (tarifa fija propia, no la tabla del Art. 241)");
    doc.moveDown(0.2);
    const cGO = datos.cedulas["ganancia_ocasional"];
    for (const tipoInfo of TIPOS_GANANCIA_OCASIONAL) {
      const v = resultado.gananciaOcasional.porTipo[tipoInfo.tipo];
      if (!v) continue;
      doc.font("Helvetica-Bold").fontSize(9.5).text(`${tipoInfo.nombre} (${(v.tarifa * 100).toFixed(0)}%)`, xLabel + 8);
      doc.moveDown(0.1);
      for (const it of (cGO?.ingresoBruto || []).filter(it => it.tipoGananciaOcasional === tipoInfo.tipo)) {
        filaTexto(it.concepto, fmt(it.valor), { indent: 16 });
      }
      for (const it of (cGO?.costoDeduccionProcedente || []).filter(it => it.tipoGananciaOcasional === tipoInfo.tipo)) {
        filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 16, color: "#b91c1c" });
      }
      for (const it of (cGO?.rentaExenta || []).filter(it => it.tipoGananciaOcasional === tipoInfo.tipo)) {
        filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 16, color: "#b91c1c" });
      }
      filaTexto("Neto gravable", fmt(v.netoGravable), { indent: 8 });
      filaTexto(`Impuesto (${(v.tarifa * 100).toFixed(0)}%)`, fmt(v.impuesto), { indent: 8, negrita: true });
      doc.moveDown(0.3);
    }
    lineaDivisoria();
    filaTexto("Total impuesto de ganancia ocasional", fmt(resultado.gananciaOcasional.totalImpuesto), { negrita: true });
    doc.moveDown(0.8);
  }

  lineaDivisoria();
  filaTexto("Renta líquida gravable total (Cédula General + Pensiones)", fmt(resultado.rentaLiquidaGravableTotal), { negrita: true });
  filaTexto(`Impuesto de renta (tarifa marginal ${(resultado.impuestoRenta.tarifaMarginal * 100).toFixed(0)}%, Art. 241 E.T.)`, fmt(resultado.impuestoRenta.impuesto), { negrita: true });
  if (datos.descuentosTributarios.length > 0) {
    for (const it of datos.descuentosTributarios) {
      filaTexto(it.concepto, `-${fmt(it.valor)}`, { indent: 8, color: "#b91c1c" });
    }
    filaTexto("Impuesto neto de renta", fmt(resultado.impuestoNetoDespuesDescuentos), { negrita: true });
  }
  doc.moveDown(0.8);
  filaTexto("Total retenciones practicadas", fmt(resultado.totalRetenciones));
  doc.moveDown(0.3);
  doc.fontSize(8.5).font("Helvetica-Oblique").fillColor("#555555")
    .text("Anticipo de renta para el próximo año — dos métodos (Art. 807 E.T.), verificar cuál aplica:");
  doc.fillColor("#000000");
  filaTexto("Método 1: impuesto actual × 75% - retenciones", fmt(resultado.anticipoMetodo1));
  filaTexto("Método 2: promedio(impuesto anterior, actual) × 75% - retenciones", fmt(resultado.anticipoMetodo2));

  // ================= ANEXO 2: Activos y Pasivos =================
  dibujarPiePaginaAreda(doc);
  doc.addPage();
  encabezado("ANEXO 2 — DETALLE DE ACTIVOS Y PASIVOS");

  doc.font("Helvetica-Bold").fontSize(11).text("Activos");
  doc.moveDown(0.2);
  if (datos.activos.length === 0) {
    doc.font("Helvetica").fontSize(9.5).fillColor("#777777").text("Sin activos cargados.");
    doc.fillColor("#000000");
  } else {
    for (const it of datos.activos) filaTexto(it.concepto, fmt(it.valor), { indent: 8 });
  }
  doc.moveDown(0.2);
  lineaDivisoria();
  filaTexto("Total activos (patrimonio bruto)", fmt(resultado.patrimonioBruto), { negrita: true });
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(11).text("Pasivos");
  doc.moveDown(0.2);
  if (datos.pasivos.length === 0) {
    doc.font("Helvetica").fontSize(9.5).fillColor("#777777").text("Sin pasivos cargados.");
    doc.fillColor("#000000");
  } else {
    for (const it of datos.pasivos) filaTexto(it.concepto, fmt(it.valor), { indent: 8 });
  }
  doc.moveDown(0.2);
  lineaDivisoria();
  filaTexto("Total pasivos (deudas)", fmt(resultado.deudas), { negrita: true });
  doc.moveDown(1);

  lineaDivisoria();
  doc.fontSize(11);
  filaTexto("PATRIMONIO LÍQUIDO", fmt(resultado.patrimonioLiquido), { negrita: true });

  if (dependientes.length > 0) {
    doc.moveDown(1.5);
    doc.font("Helvetica-Bold").fontSize(11).text("Dependientes económicos");
    doc.moveDown(0.2);
    for (const d of dependientes) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9.5).fillColor("#000000");
      doc.text(d.nombre, xLabel + 8, y, { width: anchoUtil - 200, height: 12, ellipsis: true });
      doc.text(`${d.tipoDocumento} ${d.numeroDocumento}`, xLabel, y, { width: anchoUtil, align: "right" });
      doc.y = Math.max(doc.y, y + 12);
    }
  }

  dibujarPiePaginaAreda(doc);
  doc.end();
  return done;
}
