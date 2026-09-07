import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { informesTiposDocumentoConfig, informesComprobantesExcluidos, type InformeTipoDocumentoConfig } from "../drizzle/schema";

// Utilidades de reconocimiento de columnas — mismo enfoque que el resto del
// módulo Informes (sinónimo + coincidencia de palabra completa), pero
// independientes porque los campos que se necesitan aquí son distintos
// (número de documento, NIT emisor/receptor, total) a los del libro
// auxiliar para el estado de resultados.
function normalizar(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function buscarColumna(headersNormalizados: string[], sinonimos: string[]): number | null {
  for (const syn of sinonimos) {
    const i = headersNormalizados.findIndex(h => ` ${h} `.includes(` ${syn} `));
    if (i !== -1) return i;
  }
  return null;
}

function soloDigitos(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

/** Convierte el valor crudo de una celda de fecha (Date, texto, o serial de
 * Excel) a un texto legible para mostrar en el reporte — solo para
 * despliegue, no se reinterpreta como fecha real en ningún cálculo. */
function formatearFecha(raw: any): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (raw instanceof Date) return raw.toLocaleDateString("es-CO");
  if (typeof raw === "number") {
    const utcDias = Math.floor(raw - 25569);
    return new Date(utcDias * 86400 * 1000).toLocaleDateString("es-CO");
  }
  return String(raw).trim();
}

/** Extrae el número de documento de un campo que puede venir limpio
 * (ej. "0000006990") o combinado con el tipo/consecutivo dentro de un solo
 * texto (ej. "RP-999-65" en el campo "Comprobante" de algunos softwares
 * contables) — en vez de concatenar todos los dígitos del texto (lo que
 * daría un número sin sentido), toma la corrida de dígitos MÁS LARGA, que
 * en la práctica corresponde al número real del documento (el prefijo de
 * tipo casi nunca es solo dígitos, y los segmentos de consecutivo/checaje
 * suelen ser más cortos que el número principal). */
function extraerNumeroDocumento(raw: string | null | undefined): string {
  const texto = raw || "";
  const corridas = texto.match(/\d+/g) || [];
  if (corridas.length === 0) return "";
  const masLarga = corridas.reduce((a, b) => (b.length > a.length ? b : a));
  return masLarga.replace(/^0+/, "") || "0";
}

// ==================== ARCHIVO DE LA DIAN (reporte de documentos electrónicos) ====================

export type FilaDian = {
  tipo: string;
  folio: string; // sin normalizar, tal cual viene
  prefijo: string;
  fecha: string; // texto tal cual, para mostrar en el reporte
  nitEmisor: string; nombreEmisor: string;
  nitReceptor: string; nombreReceptor: string;
  /** Valor neto de venta/compra, YA sin IVA ni otros impuestos
   * discriminados, y YA con el signo correcto según el tipo de documento
   * (negativo para notas crédito y notas de ajuste del documento
   * soporte, que restan en vez de sumar). Este es el valor que se debe
   * usar en TODAS las comparaciones — el archivo de la DIAN reporta el
   * total con impuestos incluidos, que nunca coincide con el valor de
   * la cuenta contable de ingreso/gasto (esa nunca incluye el IVA). */
  total: number;
  /** El total tal cual venía en el archivo, con impuestos incluidos y
   * sin invertir el signo — solo para trazabilidad/mostrar, nunca para
   * comparar. */
  totalBruto: number;
  /** IVA y otros impuestos discriminados en el archivo, ya con el mismo
   * signo que `total` (negativo si el documento resta). Positivo (o
   * negativo) por defecto en 0 si el archivo no trae esa columna. */
  valorImpuestos: number;
  grupo: "Emitido" | "Recibido" | "Desconocido";
};

/** Tipos de documento cuyo valor RESTA del total en vez de sumar — el
 * archivo de la DIAN los reporta en positivo, pero una nota crédito
 * anula (parcial o totalmente) una factura anterior, y una nota de
 * ajuste del documento soporte corrige uno ya emitido — confirmado por
 * Arlex (contador) con un caso real donde esto inflaba las ventas. */
function signoDelTipoDian(tipoNorm: string): 1 | -1 {
  // Se busca cada palabra por separado (no la frase "NOTA CREDITO" exacta
  // y contigua) porque el nombre real que usa la DIAN es "Nota de crédito
  // electrónica" — normalizado queda "NOTA DE CREDITO ELECTRONICA", con
  // "DE" en medio, que nunca coincidía con la frase exacta buscada antes
  // (bug real: por eso las notas crédito nunca restaban).
  if (tipoNorm.includes("NOTA") && tipoNorm.includes("CREDITO")) return -1;
  if (tipoNorm.includes("AJUSTE") && tipoNorm.includes("DOCUMENTO SOPORTE")) return -1;
  return 1;
}

type ColsDian = {
  tipo: number | null; folio: number; prefijo: number | null; fecha: number | null;
  nitEmisor: number; nombreEmisor: number | null;
  nitReceptor: number; nombreReceptor: number | null;
  total: number; grupo: number | null;
  iva: number | null; otrosImpuestos: number | null;
};

/** Reconoce las columnas del archivo de la DIAN por sinónimo — cada
 * cliente/año puede traer encabezados con nombres ligeramente distintos.
 * Obligatorias: folio, NIT emisor, NIT receptor, total. */
function resolverColumnasDian(headerRaw: any[]): ColsDian {
  const headers = Array.from(headerRaw, h => (h ? normalizar(String(h)) : ""));
  const tipo = buscarColumna(headers, ["TIPO DE DOCUMENTO", "TIPO DOCUMENTO", "TIPO"]);
  const folio = buscarColumna(headers, ["FOLIO", "NUMERO", "CONSECUTIVO"]);
  const prefijo = buscarColumna(headers, ["PREFIJO"]);
  const fecha = buscarColumna(headers, ["FECHA EMISION", "FECHA EXPEDICION", "FECHA"]);
  const nitEmisor = buscarColumna(headers, ["NIT EMISOR"]);
  const nombreEmisor = buscarColumna(headers, ["NOMBRE EMISOR", "RAZON SOCIAL EMISOR"]);
  const nitReceptor = buscarColumna(headers, ["NIT RECEPTOR"]);
  const nombreReceptor = buscarColumna(headers, ["NOMBRE RECEPTOR", "RAZON SOCIAL RECEPTOR"]);
  const total = buscarColumna(headers, ["TOTAL"]);
  const grupo = buscarColumna(headers, ["GRUPO"]);
  // El archivo de la DIAN suele discriminar el IVA (y a veces otro
  // impuesto, ej. consumo) del valor total — para la conciliación
  // interesa el valor NETO (sin impuestos), ya que la cuenta contable de
  // ingreso/gasto nunca incluye el IVA cobrado o pagado.
  const iva = buscarColumna(headers, ["VALOR IVA", "TOTAL IVA", "IVA"]);
  const otrosImpuestos = buscarColumna(headers, ["OTROS IMPUESTOS", "IMPUESTO AL CONSUMO", "VALOR INC", "INC"]);

  const faltantes: string[] = [];
  if (folio === null) faltantes.push("folio/número de documento");
  if (nitEmisor === null) faltantes.push("NIT emisor");
  if (nitReceptor === null) faltantes.push("NIT receptor");
  if (total === null) faltantes.push("total");
  if (faltantes.length > 0) {
    throw new Error(
      `No se pudo identificar la(s) columna(s) ${faltantes.join(", ")} en el archivo de la DIAN. ` +
      `Encabezados encontrados: ${headerRaw.filter(Boolean).map(String).join(", ")}`,
    );
  }
  return { tipo, folio: folio!, prefijo, fecha, nitEmisor: nitEmisor!, nombreEmisor, nitReceptor: nitReceptor!, nombreReceptor, total: total!, grupo, iva, otrosImpuestos };
}


export async function parseArchivoDian(filePathOrBuffer: string | Buffer): Promise<FilaDian[]> {
  // ExcelJS (incluso en modo streaming) no logra leer algunos archivos de
  // relación de documentos electrónicos que exporta la DIAN — se
  // confirmó con un archivo real: no lanza error, simplemente no
  // encuentra ninguna fila. SheetJS sí los lee bien (mismo motivo por el
  // que ya se usa SheetJS para los archivos de exógena).
  const buffer = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : require("fs").readFileSync(filePathOrBuffer);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const todasLasFilas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null });
  if (todasLasFilas.length === 0) return [];

  const header = todasLasFilas[0];
  const cols = resolverColumnasDian(header);
  const filas: FilaDian[] = [];

  for (let i = 1; i < todasLasFilas.length; i++) {
    const values = todasLasFilas[i];
    if (!values) continue;
    const c = cols;
    const folioRaw = values[c.folio];
    if (folioRaw === null || folioRaw === undefined || folioRaw === "") continue;
    const grupoTexto = c.grupo !== null ? String(values[c.grupo] ?? "").toLowerCase() : "";
    const grupo: FilaDian["grupo"] = grupoTexto.includes("emit") ? "Emitido" : grupoTexto.includes("recib") ? "Recibido" : "Desconocido";
    const tipoRaw = c.tipo !== null ? String(values[c.tipo] ?? "").trim() : "";
    const totalBruto = Number(values[c.total]) || 0;
    const valorIva = c.iva !== null ? (Number(values[c.iva]) || 0) : 0;
    const valorOtrosImpuestos = c.otrosImpuestos !== null ? (Number(values[c.otrosImpuestos]) || 0) : 0;
    const signo = signoDelTipoDian(normalizar(tipoRaw));
    // Se usa el valor ABSOLUTO antes de aplicar el signo del tipo de
    // documento — así el resultado es correcto sin importar si el
    // archivo de la DIAN ya trae la nota crédito en negativo (algunos
    // formatos de exportación lo hacen) o en positivo (otros lo hacen
    // así, y hay que invertirlo). Si no se hiciera esto, un archivo que
    // ya trajera el valor en negativo terminaría con el signo invertido
    // DOS veces, devolviéndolo a positivo — el mismo síntoma reportado.
    const netoAbs = Math.abs(totalBruto) - Math.abs(valorIva) - Math.abs(valorOtrosImpuestos);
    filas.push({
      tipo: tipoRaw,
      folio: String(folioRaw).trim(),
      prefijo: c.prefijo !== null ? String(values[c.prefijo] ?? "").trim() : "",
      fecha: c.fecha !== null ? formatearFecha(values[c.fecha]) : "",
      nitEmisor: String(values[c.nitEmisor] ?? "").trim(),
      nombreEmisor: c.nombreEmisor !== null ? String(values[c.nombreEmisor] ?? "").trim() : "",
      nitReceptor: String(values[c.nitReceptor] ?? "").trim(),
      nombreReceptor: c.nombreReceptor !== null ? String(values[c.nombreReceptor] ?? "").trim() : "",
      total: netoAbs * signo,
      totalBruto: Math.abs(totalBruto) * signo,
      valorImpuestos: (Math.abs(valorIva) + Math.abs(valorOtrosImpuestos)) * signo,
      grupo,
    });
  }
  return filas;
}

// ==================== LIBRO AUXILIAR (para la comparación DIAN) ====================
// Campos distintos a los que usa el Estado de Resultados: aquí se necesita
// el número de documento y el tercero, no la cuenta contable.

export type DocumentoAuxiliar = {
  numero: string; // dígitos, sin ceros a la izquierda
  tercero: string;
  nombreTercero: string;
  tipo: string;
  fecha: string; // texto tal cual, para mostrar en el reporte (no se reinterpreta)
  /** Suma de las líneas de este documento que caen en cuenta 4 (ingreso)
   * — usado para comparar facturas y notas crédito EMITIDAS. Cualquier
   * otra cuenta del mismo documento (IVA, cuentas por cobrar, etc.) NO
   * se suma aquí. */
  valorCuenta4: number;
  /** Suma de las líneas de este documento que caen en cuenta 14, 5, o
   * 62 (inventario, gasto, o costo de venta) — usado para comparar
   * cualquier otro tipo de documento (facturas recibidas, documento
   * soporte, nómina, notas crédito/ajuste, etc.). Cualquier otra cuenta
   * del mismo documento (IVA, cuentas por pagar, retenciones, etc.) NO
   * se suma aquí. */
  valorCuentaGasto: number;
  filas: number;
  /** Familia contable de este documento, determinada por la cuenta de su
   * línea más relevante (mayor valor absoluto entre las que caen en una
   * cuenta 4/5/14/15/16/17) — se usa solo para SUGERIR la categoría de
   * un tipo de documento al configurarlo, no para el valor comparado. */
  categoria: "ingreso" | "nomina" | "honorarios_servicios" | "otro_gasto" | null;
};

export type ColsAuxiliarDian = {
  numero: number; tercero: number; nombreTercero: number | null;
  debito: number; credito: number; tipo: number | null; cuenta: number | null;
  modoFecha: "combinada" | "separada" | "ninguna";
  fecha: number | null; anioCol: number | null; mesCol: number | null;
};

/** Clasifica una cuenta contable en la familia que interesa para comparar
 * contra la DIAN — confirmado con Arlex (contador): la nómina casi
 * siempre queda en 5105/5205 (gastos de personal, administración/ventas),
 * honorarios y servicios en 5110/5115/5210/5215, y el resto de compras y
 * gastos deducibles en cualquier otra cuenta 5 o 14 (a veces 15/16/17 —
 * compra de activos que también generan documento electrónico). Los
 * ingresos son la cuenta 4. Cualquier otra cuenta (1 disponible, 2
 * pasivos, 3 patrimonio, etc.) no es ni ingreso ni gasto deducible —
 * ahí es donde caen traslados, préstamos, y otros movimientos que antes
 * se comparaban por error, generando diferencias falsas. */
function categorizarCuenta(cuentaRaw: string): DocumentoAuxiliar["categoria"] {
  const cuenta = cuentaRaw.trim();
  if (!cuenta) return null;
  if (cuenta.startsWith("4")) return "ingreso";
  if (cuenta.startsWith("5105") || cuenta.startsWith("5205")) return "nomina";
  if (cuenta.startsWith("5110") || cuenta.startsWith("5115") || cuenta.startsWith("5210") || cuenta.startsWith("5215")) return "honorarios_servicios";
  if (cuenta.startsWith("5") || cuenta.startsWith("14") || cuenta.startsWith("15") || cuenta.startsWith("16") || cuenta.startsWith("17")) return "otro_gasto";
  return null; // 1 (excepto 14-17), 2, 3, 6, 7, 8, 9 — no es ingreso ni gasto/deducción
}

export function resolverColumnasAuxiliarDian(headerRaw: any[]): ColsAuxiliarDian {
  const headers = Array.from(headerRaw, h => (h ? normalizar(String(h)) : ""));
  const numero = buscarColumna(headers, ["NUMERO", "DOCUMENTO", "CONSECUTIVO", "NRO DOCUMENTO", "NUM DOCUMENTO", "COMPROBANTE"]);
  const tercero = buscarColumna(headers, ["IDENTIFICACION", "NIT TERCERO", "NIT", "TERCERO"]);
  const nombreTercero = buscarColumna(headers, ["NOMBRE TERCERO", "RAZON SOCIAL", "NOMBRE DEL TERCERO"]);
  const debito = buscarColumna(headers, ["DEBITO", "DEBE"]);
  const credito = buscarColumna(headers, ["CREDITO", "HABER"]);
  const tipo = buscarColumna(headers, ["TIPO DE COMPROBANTE", "TIPO COMPROBANTE", "TIPO DOCUMENTO", "TIPO"]);
  const cuenta = buscarColumna(headers, ["CODIGO CONTABLE", "CODIGO CUENTA", "COD CUENTA", "CUENTA CONTABLE", "NUMERO CUENTA", "CUENTA"]);
  const fecha = buscarColumna(headers, ["FECHA"]);
  const anioCol = buscarColumna(headers, ["ANO", "AGNO", "YEAR", "VIGENCIA"]);
  const mesCol = buscarColumna(headers, ["MES", "MONTH"]);

  const faltantes: string[] = [];
  if (numero === null) faltantes.push("número de documento");
  if (tercero === null) faltantes.push("tercero/NIT");
  if (debito === null) faltantes.push("débito");
  if (credito === null) faltantes.push("crédito");
  if (faltantes.length > 0) {
    throw new Error(
      `No se pudo identificar la(s) columna(s) ${faltantes.join(", ")} en el libro auxiliar. ` +
      `Encabezados encontrados: ${headerRaw.filter(Boolean).map(String).join(", ")}`,
    );
  }
  const modoFecha = fecha !== null ? "combinada" : (anioCol !== null && mesCol !== null) ? "separada" : "ninguna";
  return { numero: numero!, tercero: tercero!, nombreTercero, debito: debito!, credito: credito!, tipo, cuenta, modoFecha, fecha, anioCol, mesCol };
}

/** Extrae {anio, mes} de una fila del auxiliar, en cualquiera de las dos
 * formas (fecha combinada o año/mes por separado) — mismo criterio que el
 * resto del módulo. Devuelve null si el archivo no trae fecha en absoluto
 * (en cuyo caso no se puede acotar por mes, se usa el archivo completo). */
function periodoDeFilaAuxiliarDian(values: any[], cols: ColsAuxiliarDian): { anio: number; mes: number } | null {
  if (cols.modoFecha === "separada") {
    const anio = Number(values[cols.anioCol!]);
    const mes = Number(values[cols.mesCol!]);
    if (!anio || !mes || mes < 1 || mes > 12) return null;
    return { anio, mes };
  }
  if (cols.modoFecha === "combinada") {
    const raw = values[cols.fecha!];
    if (raw instanceof Date) return { anio: raw.getFullYear(), mes: raw.getMonth() + 1 };
    if (typeof raw === "string") {
      const m = raw.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (m) return { anio: Number(m[3]), mes: Number(m[2]) };
      const m2 = raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (m2) return { anio: Number(m2[1]), mes: Number(m2[2]) };
    }
    return null;
  }
  return null;
}

/** Agrupa el libro auxiliar por (número de documento + valor). Se agrega el
 * valor a la clave, no solo el número, porque distintas series de
 * facturación (ej. varios puntos de venta) suelen numerar sus documentos
 * de forma INDEPENDIENTE — el mismo número puede repetirse en más de una
 * serie, y agrupar solo por número mezclaría documentos distintos. Cada
 * documento suele traer 2+ líneas (débito y crédito), así que se agrupan
 * en uno solo con su valor y su tercero, para comparar contra la DIAN a
 * nivel de documento, no de línea contable individual. */
export async function parseAuxiliarParaDian(
  filePathOrBuffer: string | Buffer, anioObjetivo: number, mesObjetivo: number,
): Promise<Map<string, DocumentoAuxiliar>> {
  // Se agrupa por (tipo de comprobante + número) — esa es la identidad real
  // de un documento. El número solo NO basta: distintas series de
  // facturación (ej. varios puntos de venta) numeran de forma
  // independiente, así que el mismo número puede repetirse en más de una
  // serie con un valor totalmente distinto (confirmado con datos reales:
  // el mismo número aparecía en 2-3 series con montos diferentes).
  const documentos = new Map<string, DocumentoAuxiliar>();
  const buffer = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : require("fs").readFileSync(filePathOrBuffer);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const todasLasFilas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null });
  if (todasLasFilas.length === 0) return documentos;

  const header = todasLasFilas[0];
  const cols = resolverColumnasAuxiliarDian(header);

  // La columna de "cuenta" se reconoce por sinónimo (incluye "CUENTA" a
  // secas, genérico) — si el archivo trae una columna de NOMBRE de cuenta
  // (texto descriptivo, ej. "Caja general") en vez del CÓDIGO, ese
  // sinónimo genérico podría coincidir con la columna equivocada. Antes
  // de confiar en ella para filtrar por cuenta 4/5/14, se valida con una
  // muestra real: si la mayoría de los valores no lucen como códigos
  // (puros dígitos), se descarta — mejor no filtrar por cuenta que
  // excluir TODOS los documentos por error (bug real: causaba "no se
  // encontró ningún documento válido" con un archivo real de un cliente).
  if (cols.cuenta !== null) {
    const muestra = todasLasFilas.slice(1, 51).map(f => f?.[cols.cuenta!]).filter(v => v !== null && v !== undefined && v !== "");
    const numericos = muestra.filter(v => /^\d+$/.test(String(v).trim())).length;
    if (muestra.length === 0 || numericos / muestra.length < 0.7) {
      cols.cuenta = null;
    }
  }

  const valorPorClaveDoc = new Map<string, number>(); // máximo entre TODAS las líneas — solo para desambiguar la clave, NO es el valor comparado
  const valorCuenta4PorClaveDoc = new Map<string, number>(); // suma de líneas en cuenta 4 — para ingresos
  const valorGastoPorClaveDoc = new Map<string, number>(); // suma de líneas en cuenta 14, 5, o 62 — para gastos
  const filasCrudas: { claveDoc: string; numero: string; tercero: string; nombreTercero: string; tipo: string; fecha: string; valorFila: number; cuenta: string }[] = [];

  for (let i = 1; i < todasLasFilas.length; i++) {
    const values = todasLasFilas[i];
    if (!values) continue;
    const c = cols;
    let periodoFila: { anio: number; mes: number } | null = null;
    if (c.modoFecha !== "ninguna") {
      periodoFila = periodoDeFilaAuxiliarDian(values, c);
      if (!periodoFila || periodoFila.anio !== anioObjetivo || periodoFila.mes !== mesObjetivo) continue;
    }
    const numeroRaw = values[c.numero];
    if (numeroRaw === null || numeroRaw === undefined || numeroRaw === "") continue;
    // El número puede venir limpio (ej. "0000006990") o combinado con el
    // tipo dentro de un solo texto (ej. "RP-999-65" en un campo
    // "Comprobante") — se extrae la corrida de dígitos más larga.
    const numeroTexto = String(numeroRaw);
    const numeroNorm = extraerNumeroDocumento(numeroTexto);
    // Si hay una columna de tipo dedicada, se usa; si no, se toma el
    // prefijo alfabético del mismo campo de número/comprobante como
    // sustituto (ej. "RP" de "RP-999-65") — así igual se puede distinguir
    // entre series distintas aunque no haya una columna de tipo aparte.
    const tipoRaw = c.tipo !== null
      ? String(values[c.tipo] ?? "").trim()
      : (numeroTexto.match(/^[A-Za-z]+/)?.[0] || "");
    const claveDoc = `${tipoRaw}|${numeroNorm}`;
    const tercero = String(values[c.tercero] ?? "").trim();
    const nombreTercero = c.nombreTercero !== null ? String(values[c.nombreTercero] ?? "").trim() : "";
    const fechaTexto = c.modoFecha === "combinada" && c.fecha !== null
      ? formatearFecha(values[c.fecha])
      : periodoFila ? `${periodoFila.mes}/${periodoFila.anio}` : "";
    const debito = Number(values[c.debito]) || 0;
    const credito = Number(values[c.credito]) || 0;
    const valorFila = Math.max(Math.abs(debito), Math.abs(credito));
    const cuentaFila = c.cuenta !== null ? String(values[c.cuenta] ?? "").trim() : "";
    filasCrudas.push({ claveDoc, numero: numeroNorm, tercero, nombreTercero, tipo: tipoRaw, fecha: fechaTexto, valorFila, cuenta: cuentaFila });
    valorPorClaveDoc.set(claveDoc, Math.max(valorPorClaveDoc.get(claveDoc) || 0, valorFila));
    // Solo se suma a uno de los dos totales — cualquier otra cuenta del
    // documento (IVA, cuentas por pagar/cobrar, retenciones, etc.) no se
    // tiene en cuenta para ninguno de los dos valores comparados.
    if (cuentaFila.startsWith("4")) {
      valorCuenta4PorClaveDoc.set(claveDoc, (valorCuenta4PorClaveDoc.get(claveDoc) || 0) + valorFila);
    } else if (cuentaFila.startsWith("14") || cuentaFila.startsWith("5") || cuentaFila.startsWith("62")) {
      valorGastoPorClaveDoc.set(claveDoc, (valorGastoPorClaveDoc.get(claveDoc) || 0) + valorFila);
    }
  }

  // Categoría del documento = la de su línea de MAYOR valor entre las que
  // caen en una cuenta relevante (4/5/14/15/16/17) — un documento suele
  // tener varias líneas (la de gasto/ingreso, más IVA, retenciones,
  // cuenta por pagar...); nos interesa la que representa el concepto
  // real, no la contrapartida. Si el archivo SÍ trae columna de cuenta
  // pero NINGUNA línea del documento cae en esas cuentas, es un traslado,
  // préstamo, u otro movimiento de balance — se excluye de la
  // comparación por completo (antes se comparaba igual, generando
  // diferencias que no eran reales).
  const hayColumnaCuenta = cols.cuenta !== null;
  const categoriaPorClaveDoc = new Map<string, { categoria: DocumentoAuxiliar["categoria"]; mejorValor: number }>();
  for (const fila of filasCrudas) {
    const categoriaFila = categorizarCuenta(fila.cuenta);
    if (categoriaFila === null) continue;
    const actual = categoriaPorClaveDoc.get(fila.claveDoc);
    if (!actual || fila.valorFila > actual.mejorValor) {
      categoriaPorClaveDoc.set(fila.claveDoc, { categoria: categoriaFila, mejorValor: fila.valorFila });
    }
  }

  for (const fila of filasCrudas) {
    const categoria = categoriaPorClaveDoc.get(fila.claveDoc)?.categoria ?? null;
    const valorParaClave = valorPorClaveDoc.get(fila.claveDoc) || fila.valorFila;
    // La clave final que se expone incluye el número real y un valor de
    // referencia (no el tipo, que es solo una ayuda interna de agrupación)
    // — solo sirve para desambiguar, no es ninguno de los valores que se
    // comparan (esos son valorCuenta4 y valorCuentaGasto, por separado).
    const claveExpuesta = `${fila.numero}|${Math.round(valorParaClave)}|${fila.claveDoc}`;
    if (!documentos.has(claveExpuesta)) {
      // Sin una columna de cuenta confiable, es imposible saber cuál línea
      // es cuenta 4 y cuál es 14/5/62 — en vez de dejar ambos valores en
      // $0 (que se vería como "no se encontró nada" sin serlo), se usa el
      // valor máximo histórico (como antes de esta mejora) para los dos
      // campos, así la comparación por tercero sigue mostrando un valor
      // real sin importar cuál de los dos use.
      documentos.set(claveExpuesta, {
        numero: fila.numero, tercero: fila.tercero, nombreTercero: fila.nombreTercero,
        tipo: fila.tipo, fecha: fila.fecha, filas: 0, categoria,
        valorCuenta4: hayColumnaCuenta ? (valorCuenta4PorClaveDoc.get(fila.claveDoc) || 0) : valorParaClave,
        valorCuentaGasto: hayColumnaCuenta ? (valorGastoPorClaveDoc.get(fila.claveDoc) || 0) : valorParaClave,
      });
    }
    documentos.get(claveExpuesta)!.filas++;
  }

  // El filtro por cuenta relevante (4/5/14/15/16/17) solo se aplica si de
  // verdad reconoció AL MENOS UN documento en alguna de esas categorías —
  // si ninguno cayó ahí a pesar de tener columna de cuenta, es más
  // probable que la columna detectada no sea confiable para este archivo
  // (aunque pasó la validación de "parecen dígitos") que que TODOS los
  // movimientos del mes sean ajenos a ingresos y gastos — en ese caso se
  // usan todos los documentos sin filtrar, para no dejar la comparación
  // vacía por error.
  const hayAlgunaCategoriaReconocida = Array.from(documentos.values()).some(d => d.categoria !== null);
  if (hayColumnaCuenta && hayAlgunaCategoriaReconocida) {
    for (const [clave, doc] of Array.from(documentos.entries())) {
      if (doc.categoria === null) documentos.delete(clave);
    }
  }
  return documentos;
}

// ==================== COMPARACIÓN ====================

export type ComparacionTercero = {
  nit: string;
  nombre: string;
  totalDian: number;
  totalContabilidad: number;
  diferencia: number;
  cantidadDocumentosDian: number;
  cantidadRegistrosContabilidad: number;
  /** "cuadra" = el total coincide; "solo_dian" = está en la DIAN pero no
   * hay ningún registro contable de este tipo para ese NIT (falta
   * digitar); "solo_contabilidad" = está en la contabilidad pero no hay
   * ningún documento de la DIAN de este tipo para ese NIT (falta el
   * documento electrónico, o no lo requiere); "diferencia" = hay de
   * ambos lados pero los totales no cuadran. */
  estado: "cuadra" | "solo_dian" | "solo_contabilidad" | "diferencia";
};

/** Clasifica una fila de la DIAN en la misma familia que `categorizarCuenta`
 * — para poder comparar nómina contra nómina, documento soporte contra
 * honorarios/servicios, y las demás facturas recibidas contra el resto de
 * cuentas 5/14 (y ocasionalmente 15/16/17), en vez de mezclarlo todo. Todo
 * lo "Emitido" es ingreso, sin importar el tipo de documento. */
export function categorizarFilaDian(fila: FilaDian): DocumentoAuxiliar["categoria"] {
  // La nómina electrónica y el documento soporte SIEMPRE los genera quien
  // PAGA (la empresa) — en el reporte de la DIAN aparecen como "Emitidos"
  // por ella (es quien los genera), pero representan un GASTO suyo, no un
  // ingreso. Por eso se revisan por tipo de documento ANTES que por el
  // grupo Emitido/Recibido — si se mirara solo el grupo, una nómina
  // quedaría mal clasificada como ingreso.
  const tipoNorm = normalizar(fila.tipo);
  if (tipoNorm.includes("NOMINA")) return "nomina";
  if (tipoNorm.includes("DOCUMENTO SOPORTE")) return "honorarios_servicios";
  if (fila.grupo === "Emitido") return "ingreso";
  return "otro_gasto"; // facturas electrónicas y demás documentos recibidos
}

export type CategoriaConfigDocumento = "ingreso" | "nomina" | "honorarios_servicios" | "otro_gasto" | "excluir";

export type TipoDocumentoDetectado = {
  tipoDocumentoDian: string;
  grupo: "Emitido" | "Recibido";
  cantidad: number;
  total: number;
  categoriaSugerida: DocumentoAuxiliar["categoria"];
};

/** Lista, sin duplicados, cada combinación (tipo de documento, grupo) que
 * aparece en un archivo de la DIAN ya parseado — con cuántos documentos y
 * cuánto suman, para que el usuario decida qué representa cada uno (es
 * ingreso, nómina, honorarios, u otro gasto) y, opcionalmente, con qué
 * tipo de comprobante contable se relaciona (ej. nómina → "CN"/"CP"). */
export function getTiposDocumentoDelArchivo(filasDian: FilaDian[]): TipoDocumentoDetectado[] {
  const porClave = new Map<string, TipoDocumentoDetectado>();
  for (const fila of filasDian) {
    const clave = `${fila.tipo}|${fila.grupo}`;
    if (!porClave.has(clave)) {
      porClave.set(clave, {
        tipoDocumentoDian: fila.tipo, grupo: fila.grupo as "Emitido" | "Recibido",
        cantidad: 0, total: 0, categoriaSugerida: categorizarFilaDian(fila),
      });
    }
    const entrada = porClave.get(clave)!;
    entrada.cantidad++;
    entrada.total += fila.total;
  }
  return Array.from(porClave.values()).sort((a, b) => b.total - a.total);
}

export type ResumenTipoDocumento = {
  tipoDocumentoDian: string;
  grupo: "Emitido" | "Recibido";
  cantidadDian: number;
  totalDian: number;
  /** Conciliación por TERCERO (agregando todo lo que le corresponde a
   * cada NIT) — si el total de un tercero cuadra, el dinero está
   * completo. Es la única métrica de conciliación que se calcula ahora
   * (se dejó de calcular el cruce documento a documento, que no se
   * mostraba en ningún lado y solo consumía recursos). */
  cantidadTercerosTotal: number;
  cantidadTercerosConciliados: number;
  valorConciliado: number;
  /** IVA y otros impuestos discriminados que trae este tipo de
   * documento — al frente de cada tipo, para ver de un vistazo cuál
   * tipo genera cuánto impuesto. */
  totalImpuestos: number;
};

/** Resume, por cada tipo de documento de la DIAN (facturas, documento
 * soporte, nómina, etc.), cuántos hay en total, cuánto IVA reportan, y
 * qué tan conciliado está cada uno por tercero. */
export function getResumenPorTipoDocumento(
  filasDian: FilaDian[],
  seccionesTerceroPorTipo: Map<string, ComparacionTercero[]>,
): ResumenTipoDocumento[] {
  const totales = getTiposDocumentoDelArchivo(filasDian);
  const impuestosPorClave = new Map<string, number>();
  for (const f of filasDian) {
    const clave = `${f.tipo}|${f.grupo}`;
    impuestosPorClave.set(clave, (impuestosPorClave.get(clave) || 0) + f.valorImpuestos);
  }
  return totales.map(t => {
    const clave = `${t.tipoDocumentoDian}|${t.grupo}`;
    const itemsTercero = seccionesTerceroPorTipo.get(clave) || [];
    const conciliados = itemsTercero.filter(it => it.estado === "cuadra");
    const valorConciliado = conciliados.reduce((a, it) => a + it.totalDian, 0);
    return {
      tipoDocumentoDian: t.tipoDocumentoDian, grupo: t.grupo,
      cantidadDian: t.cantidad, totalDian: t.total,
      cantidadTercerosTotal: itemsTercero.length, cantidadTercerosConciliados: conciliados.length,
      valorConciliado, totalImpuestos: impuestosPorClave.get(clave) || 0,
    };
  });
}

/** Tipos de comprobante ÚNICOS que aparecen en el libro auxiliar ya
 * parseado (ej. "FV", "CN", "CP", "ND") — para que, al configurar qué
 * tipo(s) de comprobante contable corresponden a un tipo de documento de
 * la DIAN, el usuario elija de los que REALMENTE existen en su
 * contabilidad en vez de escribirlos de memoria (más preciso, sin
 * errores de tipeo, y garantiza que el cruce futuro contra la
 * contabilidad encuentre algo). */
export function getTiposComprobanteDelAuxiliar(documentosAux: Map<string, DocumentoAuxiliar>): { tipo: string; cantidad: number }[] {
  const conteo = new Map<string, number>();
  for (const doc of Array.from(documentosAux.values())) {
    const tipo = doc.tipo.trim();
    if (!tipo) continue;
    conteo.set(tipo, (conteo.get(tipo) || 0) + 1);
  }
  return Array.from(conteo.entries())
    .map(([tipo, cantidad]) => ({ tipo, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

/** Tipos de comprobante del libro auxiliar que NO están asignados a
 * ningún tipo de documento de la DIAN en la configuración guardada de
 * este cliente — para que el usuario detecte de un vistazo si hay
 * comprobantes contables (ej. una nota débito "ND", o un tipo nuevo que
 * empezó a usarse) que todavía no se ha decidido cómo comparar. */
export function getTiposComprobanteNoClasificados(
  tiposComprobanteDelAuxiliar: { tipo: string; cantidad: number }[],
  configs: InformeTipoDocumentoConfig[],
  excluidos: string[] = [],
): { tipo: string; cantidad: number }[] {
  const clasificados = new Set<string>(excluidos.map(t => t.trim()));
  for (const c of configs) {
    if (!c.tiposComprobanteContable) continue;
    try {
      const lista: string[] = JSON.parse(c.tiposComprobanteContable);
      for (const t of lista) clasificados.add(t.trim());
    } catch { /* config con JSON inválido — se ignora, no debería pasar */ }
  }
  return tiposComprobanteDelAuxiliar.filter(t => !clasificados.has(t.tipo));
}

export async function getComprobantesExcluidos(clienteId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const filas = await db.select().from(informesComprobantesExcluidos).where(eq(informesComprobantesExcluidos.clienteId, clienteId));
  return filas.map(f => f.tipoComprobante);
}

/** Reemplaza la lista completa de tipos de comprobante contable (del
 * libro auxiliar) que este cliente excluye de la conciliación DIAN —
 * ajustes internos, apertura de saldos, y cualquier otro que nunca vaya
 * a tener un documento electrónico correspondiente. */
export async function guardarComprobantesExcluidos(clienteId: number, tipos: string[], userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(informesComprobantesExcluidos).where(eq(informesComprobantesExcluidos.clienteId, clienteId));
  for (const tipo of tipos) {
    if (!tipo.trim()) continue;
    await db.insert(informesComprobantesExcluidos).values({ clienteId, tipoComprobante: tipo.trim(), actualizadoPorId: userId });
  }
}

/** Quita del libro auxiliar los documentos cuyo tipo de comprobante el
 * cliente marcó como excluido — así no aparecen como "no clasificados",
 * ni como un falso faltante en ninguna comparación. */
export function filtrarDocumentosExcluidos(documentosAux: Map<string, DocumentoAuxiliar>, tiposExcluidos: string[]): Map<string, DocumentoAuxiliar> {
  if (tiposExcluidos.length === 0) return documentosAux;
  const excluidosSet = new Set(tiposExcluidos.map(t => t.trim()));
  return new Map(Array.from(documentosAux.entries()).filter(([, doc]) => !excluidosSet.has(doc.tipo)));
}

export async function getConfigTiposDocumento(clienteId: number): Promise<InformeTipoDocumentoConfig[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(informesTiposDocumentoConfig).where(eq(informesTiposDocumentoConfig.clienteId, clienteId));
}

/** Guarda (o corrige) qué representa cada tipo de documento de la DIAN
 * para este cliente — se recuerda para todas las conciliaciones futuras
 * (comparación DIAN, por tercero, conciliación de IVA), sin tener que
 * volver a configurarlo cada mes; es raro que un cliente empiece a usar
 * un tipo de documento distinto de un mes a otro. */
export async function guardarConfigTiposDocumento(
  clienteId: number,
  configs: { tipoDocumentoDian: string; grupo: "Emitido" | "Recibido"; categoria: CategoriaConfigDocumento; tiposComprobanteContable?: string[] }[],
  userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const c of configs) {
    const existente = await db.select().from(informesTiposDocumentoConfig).where(and(
      eq(informesTiposDocumentoConfig.clienteId, clienteId),
      eq(informesTiposDocumentoConfig.tipoDocumentoDian, c.tipoDocumentoDian),
      eq(informesTiposDocumentoConfig.grupo, c.grupo),
    )).limit(1);
    const tiposComprobanteContable = c.tiposComprobanteContable && c.tiposComprobanteContable.length > 0
      ? JSON.stringify(c.tiposComprobanteContable) : null;
    if (existente.length > 0) {
      await db.update(informesTiposDocumentoConfig)
        .set({ categoria: c.categoria, tiposComprobanteContable, actualizadoPorId: userId })
        .where(eq(informesTiposDocumentoConfig.id, existente[0].id));
    } else {
      await db.insert(informesTiposDocumentoConfig).values({
        clienteId, tipoDocumentoDian: c.tipoDocumentoDian, grupo: c.grupo,
        categoria: c.categoria, tiposComprobanteContable, actualizadoPorId: userId,
      });
    }
  }
}

/** Igual que `categorizarFilaDian`, pero usa primero la configuración que
 * el cliente ya haya guardado para ese tipo de documento — solo cae al
 * heurístico automático (por nombre del tipo) si todavía no se ha
 * configurado explícitamente. `mapaConfig` se arma una sola vez por
 * comparación con `mapaConfigTiposDocumento()`, para no consultar la
 * base de datos fila por fila. */
export function categorizarFilaDianConConfig(fila: FilaDian, mapaConfig: Map<string, CategoriaConfigDocumento>): DocumentoAuxiliar["categoria"] {
  const clave = `${fila.tipo}|${fila.grupo}`;
  const configurado = mapaConfig.get(clave);
  if (configurado) return configurado === "excluir" ? null : configurado;
  return categorizarFilaDian(fila);
}

export function mapaConfigTiposDocumento(configs: InformeTipoDocumentoConfig[]): Map<string, CategoriaConfigDocumento> {
  return new Map(configs.map(c => [`${c.tipoDocumentoDian}|${c.grupo}`, c.categoria]));
}

/** Compara TOTALES agregados por tercero (NIT) entre la DIAN y la
 * contabilidad, para UN tipo de documento exacto — del lado DIAN toma
 * ese tipo+grupo tal cual; del lado contable, solo los documentos cuyo
 * tipo de comprobante el usuario asoció a este tipo de documento. El
 * valor contable comparado depende de si el tipo es de INGRESO (facturas
 * y notas crédito EMITIDAS, que se comparan solo con la cuenta 4) o de
 * GASTO (todo lo demás — facturas recibidas, documento soporte, nómina,
 * notas crédito/ajuste recibidas, etc., comparadas solo con las cuentas
 * 14, 5, o 62). Cualquier otra cuenta del mismo documento (IVA, cuentas
 * por pagar/cobrar, retenciones...) no se tiene en cuenta para nada.
 * Sin comprobantes contables asociados, el lado contable queda vacío en
 * vez de adivinar. */
export function compararPorTercero(
  filasDian: FilaDian[], documentosAux: Map<string, DocumentoAuxiliar>,
  filtroTipoExacto: { tipoDocumentoDian: string; grupo: "Emitido" | "Recibido"; tiposComprobanteContable: string[] },
): ComparacionTercero[] {
  const filasFiltradas = filasDian.filter(f => f.tipo === filtroTipoExacto.tipoDocumentoDian && f.grupo === filtroTipoExacto.grupo);
  const setComprobantes = new Set(filtroTipoExacto.tiposComprobanteContable);
  const documentosFiltrados = setComprobantes.size > 0
    ? Array.from(documentosAux.values()).filter(doc => setComprobantes.has(doc.tipo))
    : [];

  const esIngreso = categorizarFilaDian({ tipo: filtroTipoExacto.tipoDocumentoDian, grupo: filtroTipoExacto.grupo } as FilaDian) === "ingreso";

  const porNit = new Map<string, { nombre: string; totalDian: number; totalContab: number; cantDian: number; cantContab: number }>();
  const asegurar = (nit: string, nombre: string) => {
    if (!porNit.has(nit)) porNit.set(nit, { nombre, totalDian: 0, totalContab: 0, cantDian: 0, cantContab: 0 });
    const entrada = porNit.get(nit)!;
    if (!entrada.nombre && nombre) entrada.nombre = nombre;
    return entrada;
  };

  for (const fila of filasFiltradas) {
    const esRecibido = fila.grupo === "Recibido";
    const nit = soloDigitos(esRecibido ? fila.nitEmisor : fila.nitReceptor);
    if (!nit) continue;
    const nombre = esRecibido ? fila.nombreEmisor : fila.nombreReceptor;
    const entrada = asegurar(nit, nombre);
    entrada.totalDian += fila.total;
    entrada.cantDian++;
  }

  for (const doc of documentosFiltrados) {
    const nit = soloDigitos(doc.tercero);
    if (!nit) continue;
    const entrada = asegurar(nit, doc.nombreTercero);
    entrada.totalContab += esIngreso ? doc.valorCuenta4 : doc.valorCuentaGasto;
    entrada.cantContab++;
  }

  const resultado: ComparacionTercero[] = [];
  for (const [nit, datos] of Array.from(porNit.entries())) {
    const diferencia = datos.totalDian - datos.totalContab;
    const cuadra = Math.abs(diferencia) <= Math.max(5, Math.abs(datos.totalDian) * 0.001);
    let estado: ComparacionTercero["estado"];
    if (cuadra) estado = "cuadra";
    else if (datos.cantContab === 0) estado = "solo_dian";
    else if (datos.cantDian === 0) estado = "solo_contabilidad";
    else estado = "diferencia";
    resultado.push({
      nit, nombre: datos.nombre || "(sin nombre)",
      totalDian: datos.totalDian, totalContabilidad: datos.totalContab, diferencia,
      cantidadDocumentosDian: datos.cantDian, cantidadRegistrosContabilidad: datos.cantContab,
      estado,
    });
  }
  resultado.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  return resultado;
}

// ==================== REPORTE EXCEL ====================

const FONT_TITLE = { name: "Arial", size: 12, bold: true };
const FONT_BOLD = { name: "Arial", size: 10, bold: true };
const MONEY = '$#,##0;($#,##0);"-"';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF42302E" } };
const HEADER_FONT = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const ALERTA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } };

function estilarEncabezado(row: ExcelJS.Row) {
  row.eachCell(c => { c.font = HEADER_FONT as any; c.fill = HEADER_FILL; });
}

const ETIQUETAS_ESTADO: Record<ComparacionTercero["estado"], string> = {
  cuadra: "Cuadra",
  solo_dian: "⚠ Solo en la DIAN — falta digitar",
  solo_contabilidad: "En contabilidad, sin documento DIAN",
  diferencia: "⚠ Diferencia parcial",
};

/** Genera el Excel de la comparación — 2 hojas solamente:
 * 1) Resumen: totales generales + tabla por tipo de documento con el IVA
 *    al frente de cada uno y el % conciliado por tercero.
 * 2) Detalle: la comparación por tercero, una sección por cada tipo de
 *    documento, con el valor DIAN y el valor de los documentos contables
 *    configurados para ese tipo, lado a lado.
 * No se calcula ni se muestra nada más (cruce documento a documento,
 * posibles coincidencias, etc.) — solo lo que efectivamente se ve aquí,
 * para no gastar recursos calculando algo que no se muestra. */
export async function generarReporteComparacionDian(
  clienteNombre: string, anio: number, mes: number,
  seccionesTerceros: { titulo: string; items: ComparacionTercero[] }[],
  tiposNoClasificados: { tipo: string; cantidad: number }[],
  resumenPorTipo: ResumenTipoDocumento[],
  filasDian: FilaDian[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";

  // ==================== HOJA 1: RESUMEN ====================
  const wsResumen = wb.addWorksheet("Resumen");
  wsResumen.addRow([`COMPARACIÓN DIAN vs CONTABILIDAD · ${clienteNombre} · ${anio}-${String(mes).padStart(2, "0")}`]).font = FONT_TITLE as any;
  wsResumen.addRow([]);
  wsResumen.addRow(["Documentos en el archivo de la DIAN", filasDian.length]);
  wsResumen.getColumn(1).width = 48;

  if (resumenPorTipo.length > 0) {
    wsResumen.addRow([]);
    wsResumen.addRow(["Resumen por tipo de documento — con el IVA/impuestos que reporta cada uno al frente"]).font = FONT_BOLD as any;
    wsResumen.addRow([
      "El valor de contabilidad de cada tipo se calcula SOLO con la cuenta 4 (ingresos, para facturas y "
      + "notas crédito emitidas) o con las cuentas 14, 5, o 62 (para todo lo demás) — cualquier otra cuenta "
      + "del mismo documento (IVA, cuentas por pagar/cobrar, retenciones) no se tiene en cuenta. "
      + "\"% conciliado por tercero\" compara el TOTAL de cada NIT, sin importar cómo se repartió entre "
      + "documentos — es la columna que de verdad indica si falta algo por digitar.",
    ]).font = { name: "Arial", size: 9, italic: true } as any;
    wsResumen.getRow(wsResumen.rowCount).alignment = { wrapText: true } as any;
    wsResumen.mergeCells(wsResumen.rowCount, 1, wsResumen.rowCount, 6);
    wsResumen.getRow(wsResumen.rowCount).height = 55;
    const hTipo = wsResumen.addRow([
      "Tipo de documento", "Grupo", "Docs. DIAN", "Total DIAN", "IVA/impuestos",
      "% conciliado (por tercero)", "Terceros sin conciliar",
    ]);
    estilarEncabezado(hTipo);
    for (const t of resumenPorTipo) {
      const pctConciliado = t.cantidadTercerosTotal > 0 ? (t.cantidadTercerosConciliados / t.cantidadTercerosTotal) : null;
      const tercerosSinConciliar = t.cantidadTercerosTotal - t.cantidadTercerosConciliados;
      const r = wsResumen.addRow([
        t.tipoDocumentoDian, t.grupo, t.cantidadDian, t.totalDian, t.totalImpuestos,
        pctConciliado, tercerosSinConciliar,
      ]);
      if (pctConciliado !== null && tercerosSinConciliar > 0) r.eachCell(c => { c.fill = ALERTA_FILL; });
    }
    wsResumen.getColumn(4).numFmt = MONEY;
    wsResumen.getColumn(5).numFmt = MONEY;
    wsResumen.getColumn(6).numFmt = "0%";
    wsResumen.getColumn(2).width = 12; wsResumen.getColumn(3).width = 12;
    wsResumen.getColumn(4).width = 16; wsResumen.getColumn(5).width = 14;
    wsResumen.getColumn(6).width = 20; wsResumen.getColumn(7).width = 18;
  }

  if (tiposNoClasificados.length > 0) {
    wsResumen.addRow([]);
    const nombres = tiposNoClasificados.map(t => t.tipo).join(", ");
    wsResumen.addRow([`⚠ Tipos de comprobante contable sin clasificar todavía (${tiposNoClasificados.length}): ${nombres}`]).font = { name: "Arial", size: 9, italic: true, color: { argb: "FFB45309" } } as any;
  }

  // ==================== HOJA 2: DETALLE (comparación por tercero) ====================
  const wsDetalle = wb.addWorksheet("Detalle");
  wsDetalle.addRow([
    "Compara, tipo de transacción por tipo de transacción, el total de cada tercero (NIT) entre la DIAN y "
    + "los documentos contables configurados para ese tipo. Si el total de un tercero cuadra, muy "
    + "probablemente todo está digitado. Si no cuadra, el estado indica de qué lado falta.",
  ]).font = { name: "Arial", size: 9, italic: true, bold: true } as any;
  wsDetalle.getRow(1).alignment = { wrapText: true } as any;
  wsDetalle.mergeCells(1, 1, 1, 8);
  wsDetalle.getRow(1).height = 45;
  wsDetalle.addRow([]);

  for (const seccion of seccionesTerceros) {
    if (seccion.items.length === 0) continue;
    const conDiferenciaReal = seccion.items.filter(t => t.estado !== "cuadra");
    const rTitulo = wsDetalle.addRow([seccion.titulo]);
    rTitulo.font = { name: "Arial", size: 11, bold: true } as any;
    wsDetalle.addRow([`Con diferencia real: ${conDiferenciaReal.length} de ${seccion.items.length}`]).font = { name: "Arial", size: 9, italic: true } as any;
    const hTercero = wsDetalle.addRow([
      "NIT", "Tercero", "Valor DIAN", "Valor Documentos Contables", "Diferencia",
      "Docs. DIAN", "Registros contabilidad", "Estado",
    ]);
    estilarEncabezado(hTercero);
    for (const t of seccion.items) {
      const r = wsDetalle.addRow([
        t.nit, t.nombre, t.totalDian, t.totalContabilidad, t.diferencia,
        t.cantidadDocumentosDian, t.cantidadRegistrosContabilidad,
        ETIQUETAS_ESTADO[t.estado],
      ]);
      if (t.estado !== "cuadra") r.eachCell(c => { c.fill = ALERTA_FILL; });
    }
    wsDetalle.addRow([]);
  }
  wsDetalle.getColumn(3).numFmt = MONEY; wsDetalle.getColumn(4).numFmt = MONEY; wsDetalle.getColumn(5).numFmt = MONEY;
  wsDetalle.getColumn(1).width = 16; wsDetalle.getColumn(2).width = 34; wsDetalle.getColumn(3).width = 16;
  wsDetalle.getColumn(4).width = 22; wsDetalle.getColumn(5).width = 14; wsDetalle.getColumn(6).width = 12;
  wsDetalle.getColumn(7).width = 20; wsDetalle.getColumn(8).width = 26;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
