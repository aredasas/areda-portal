import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { informesTiposDocumentoConfig, type InformeTipoDocumentoConfig } from "../drizzle/schema";

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
  total: number;
  grupo: "Emitido" | "Recibido" | "Desconocido";
};

type ColsDian = {
  tipo: number | null; folio: number; prefijo: number | null; fecha: number | null;
  nitEmisor: number; nombreEmisor: number | null;
  nitReceptor: number; nombreReceptor: number | null;
  total: number; grupo: number | null;
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
  return { tipo, folio: folio!, prefijo, fecha, nitEmisor: nitEmisor!, nombreEmisor, nitReceptor: nitReceptor!, nombreReceptor, total: total!, grupo };
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
    filas.push({
      tipo: c.tipo !== null ? String(values[c.tipo] ?? "").trim() : "",
      folio: String(folioRaw).trim(),
      prefijo: c.prefijo !== null ? String(values[c.prefijo] ?? "").trim() : "",
      fecha: c.fecha !== null ? formatearFecha(values[c.fecha]) : "",
      nitEmisor: String(values[c.nitEmisor] ?? "").trim(),
      nombreEmisor: c.nombreEmisor !== null ? String(values[c.nombreEmisor] ?? "").trim() : "",
      nitReceptor: String(values[c.nitReceptor] ?? "").trim(),
      nombreReceptor: c.nombreReceptor !== null ? String(values[c.nombreReceptor] ?? "").trim() : "",
      total: Number(values[c.total]) || 0,
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
  valor: number;
  filas: number;
  /** Familia contable de este documento, determinada por la cuenta de su
   * línea más relevante (mayor valor absoluto entre las que caen en una
   * cuenta 4/5/14/15/16/17) — null si el archivo no trae columna de
   * cuenta, o si ninguna de sus líneas cae en esas cuentas (en cuyo caso
   * el documento no se compara: es un traslado, préstamo, u otro
   * movimiento de balance que no es ingreso ni gasto/deducción). */
  categoria: "ingreso" | "nomina" | "honorarios_servicios" | "otro_gasto" | null;
};

type ColsAuxiliarDian = {
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

function resolverColumnasAuxiliarDian(headerRaw: any[]): ColsAuxiliarDian {
  const headers = Array.from(headerRaw, h => (h ? normalizar(String(h)) : ""));
  const numero = buscarColumna(headers, ["NUMERO", "DOCUMENTO", "CONSECUTIVO", "NRO DOCUMENTO", "NUM DOCUMENTO", "COMPROBANTE"]);
  const tercero = buscarColumna(headers, ["IDENTIFICACION", "NIT TERCERO", "NIT", "TERCERO"]);
  const nombreTercero = buscarColumna(headers, ["NOMBRE TERCERO", "RAZON SOCIAL", "NOMBRE DEL TERCERO"]);
  const debito = buscarColumna(headers, ["DEBITO", "DEBE"]);
  const credito = buscarColumna(headers, ["CREDITO", "HABER"]);
  const tipo = buscarColumna(headers, ["TIPO DE COMPROBANTE", "TIPO COMPROBANTE", "TIPO DOCUMENTO", "TIPO"]);
  const cuenta = buscarColumna(headers, ["CODIGO CUENTA", "COD CUENTA", "CUENTA CONTABLE", "NUMERO CUENTA", "CUENTA"]);
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

  const valorPorClaveDoc = new Map<string, number>();
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
    const valorDoc = valorPorClaveDoc.get(fila.claveDoc) || fila.valorFila;
    // La clave final que se expone incluye el número real y el valor del
    // documento (no el tipo, que es solo una ayuda interna de agrupación) —
    // así la búsqueda desde el lado DIAN sigue siendo por número+valor.
    const claveExpuesta = `${fila.numero}|${Math.round(valorDoc)}|${fila.claveDoc}`;
    if (!documentos.has(claveExpuesta)) {
      documentos.set(claveExpuesta, {
        numero: fila.numero, tercero: fila.tercero, nombreTercero: fila.nombreTercero,
        tipo: fila.tipo, fecha: fila.fecha, valor: valorDoc, filas: 0, categoria,
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

export type ResultadoComparacionDian = {
  soloEnDian: FilaDian[];
  soloEnContabilidad: DocumentoAuxiliar[];
  totalDian: number;
  totalContabilidad: number;
  emparejadosPorNumero: number;
  emparejadosPorNitValor: number;
};

export type ComparacionTercero = {
  nit: string;
  nombre: string;
  totalDian: number;
  totalContabilidad: number;
  diferencia: number;
  cantidadDocumentosDian: number;
  cantidadRegistrosContabilidad: number;
};

/** Compara documentos de la DIAN contra el libro auxiliar en dos pasadas:
 * 1) por número de documento (cuando quien genera el número es el mismo
 *    cliente — sus propias facturas de venta o documentos soporte, donde
 *    el número de la contabilidad y el folio de la DIAN coinciden).
 * 2) por NIT del tercero + valor (cuando el número lo genera el tercero —
 *    facturas de compra recibidas de proveedores, donde el número interno
 *    de la contabilidad no tiene relación con el folio del proveedor).
 * Lo que no cruza por ninguna de las dos formas queda para revisión
 * manual en el reporte final. */
/** Dos valores se consideran "el mismo" si difieren en $5 o menos, o en
 * 0.1% del valor (lo que sea mayor) — para no marcar como diferencia una
 * discrepancia mínima de redondeo entre la DIAN y la contabilidad (ej. por
 * cómo cada sistema redondea el IVA), que antes hacía que documentos
 * idénticos quedaran como "sin encontrar" solo por unos pocos pesos. */
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

function valoresCoinciden(a: number, b: number): boolean {
  const tolerancia = Math.max(5, Math.abs(a) * 0.001);
  return Math.abs(a - b) <= tolerancia;
}

/** Compara TOTALES agregados por tercero (NIT) entre la DIAN y la
 * contabilidad — a diferencia del cruce documento a documento, que puede
 * marcar como "diferencia" cosas que en realidad SÍ están digitadas pero
 * consolidadas distinto (una sola factura contable por varios documentos
 * de la DIAN, fechas de registro diferentes, numeración interna que no
 * coincide, etc.). Si el TOTAL de un tercero cuadra en ambos lados,
 * prácticamente seguro que todo se digitó aunque el cruce por documento
 * no lo haya detectado — si el total NO cuadra, ahí sí hay indicio real
 * de un faltante de digitación, y por cuánto. Usa TODAS las filas/
 * documentos, no solo los que quedaron sin cruzar. */
export function compararPorTercero(
  filasDian: FilaDian[], documentosAux: Map<string, DocumentoAuxiliar>,
  filtroCategoria?: DocumentoAuxiliar["categoria"],
  mapaConfig?: Map<string, CategoriaConfigDocumento>,
): ComparacionTercero[] {
  const filasFiltradas = filtroCategoria
    ? filasDian.filter(f => (mapaConfig ? categorizarFilaDianConConfig(f, mapaConfig) : categorizarFilaDian(f)) === filtroCategoria)
    : filasDian;
  const documentosFiltrados = filtroCategoria
    ? new Map(Array.from(documentosAux.entries()).filter(([, doc]) => doc.categoria === filtroCategoria))
    : documentosAux;
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

  for (const doc of Array.from(documentosFiltrados.values())) {
    const nit = soloDigitos(doc.tercero);
    if (!nit) continue;
    const entrada = asegurar(nit, doc.nombreTercero);
    entrada.totalContab += doc.valor;
    entrada.cantContab++;
  }

  const resultado: ComparacionTercero[] = [];
  for (const [nit, datos] of Array.from(porNit.entries())) {
    resultado.push({
      nit, nombre: datos.nombre || "(sin nombre)",
      totalDian: datos.totalDian, totalContabilidad: datos.totalContab,
      diferencia: datos.totalDian - datos.totalContab,
      cantidadDocumentosDian: datos.cantDian, cantidadRegistrosContabilidad: datos.cantContab,
    });
  }
  resultado.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  return resultado;
}

export function compararDianVsAuxiliar(
  filasDian: FilaDian[], documentosAux: Map<string, DocumentoAuxiliar>,
): ResultadoComparacionDian {
  const auxDisponibles = new Set(documentosAux.keys());
  const soloEnDian: FilaDian[] = [];
  let emparejadosPorNumero = 0;
  let emparejadosPorNitValor = 0;

  // Índices por número solo y por NIT solo — la coincidencia de valor se
  // evalúa con tolerancia al momento de buscar, no como parte de la clave
  // (para no perder coincidencias válidas por unos pocos pesos de
  // diferencia).
  const indicePorNumero = new Map<string, string[]>();
  const indicePorNit = new Map<string, string[]>();
  for (const [clave, doc] of Array.from(documentosAux.entries())) {
    if (!indicePorNumero.has(doc.numero)) indicePorNumero.set(doc.numero, []);
    indicePorNumero.get(doc.numero)!.push(clave);

    const nitDigitos = soloDigitos(doc.tercero);
    if (!indicePorNit.has(nitDigitos)) indicePorNit.set(nitDigitos, []);
    indicePorNit.get(nitDigitos)!.push(clave);
  }

  for (const fila of filasDian) {
    const folioNorm = extraerNumeroDocumento(fila.folio);
    const nitTercero = fila.grupo === "Recibido" ? fila.nitEmisor : fila.nitReceptor;

    // 1) por número de documento — puede haber varios candidatos (de
    // distintas series numeradas de forma independiente); se elige el que
    // tenga el valor más parecido al total de la DIAN, con tolerancia.
    const candidatosNumero = (indicePorNumero.get(folioNorm) || []).filter(k => auxDisponibles.has(k));
    if (candidatosNumero.length > 0) {
      let mejor: string | null = null;
      let mejorDif = Infinity;
      for (const clave of candidatosNumero) {
        const dif = Math.abs(documentosAux.get(clave)!.valor - fila.total);
        if (dif < mejorDif) { mejorDif = dif; mejor = clave; }
      }
      if (mejor !== null && valoresCoinciden(documentosAux.get(mejor)!.valor, fila.total)) {
        auxDisponibles.delete(mejor);
        emparejadosPorNumero++;
        continue;
      }
    }

    // 2) por NIT del tercero + valor con tolerancia (facturas de compra
    // donde el número lo genera el proveedor, no el cliente).
    const candidatosNit = (indicePorNit.get(soloDigitos(nitTercero)) || []).filter(k => auxDisponibles.has(k));
    if (candidatosNit.length > 0) {
      let mejor: string | null = null;
      let mejorDif = Infinity;
      for (const clave of candidatosNit) {
        const dif = Math.abs(documentosAux.get(clave)!.valor - fila.total);
        if (dif < mejorDif) { mejorDif = dif; mejor = clave; }
      }
      if (mejor !== null && valoresCoinciden(documentosAux.get(mejor)!.valor, fila.total)) {
        auxDisponibles.delete(mejor);
        emparejadosPorNitValor++;
        continue;
      }
    }

    soloEnDian.push(fila);
  }

  const soloEnContabilidad = Array.from(auxDisponibles).map(clave => documentosAux.get(clave)!);

  return {
    soloEnDian, soloEnContabilidad,
    totalDian: filasDian.length, totalContabilidad: documentosAux.size,
    emparejadosPorNumero, emparejadosPorNitValor,
  };
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

export async function generarReporteComparacionDian(
  resultado: ResultadoComparacionDian, clienteNombre: string, anio: number, mes: number,
  seccionesTerceros: { titulo: string; items: ComparacionTercero[] }[] = [],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";

  const wsResumen = wb.addWorksheet("Resumen");
  wsResumen.addRow([`COMPARACIÓN DIAN vs CONTABILIDAD · ${clienteNombre} · ${anio}-${String(mes).padStart(2, "0")}`]).font = FONT_TITLE as any;
  wsResumen.addRow([]);
  wsResumen.addRow(["Documentos en el archivo de la DIAN", resultado.totalDian]);
  wsResumen.addRow(["Documentos en la contabilidad", resultado.totalContabilidad]);
  wsResumen.addRow(["Cruzados por número de documento", resultado.emparejadosPorNumero]);
  wsResumen.addRow(["Cruzados por NIT + valor", resultado.emparejadosPorNitValor]);
  const rSoloContab = wsResumen.addRow(["En contabilidad, sin encontrar en la DIAN", resultado.soloEnContabilidad.length]);
  const rSoloDian = wsResumen.addRow(["⚠ En la DIAN, sin encontrar en contabilidad (revisar)", resultado.soloEnDian.length]);
  rSoloDian.font = FONT_BOLD as any;
  rSoloContab.font = FONT_BOLD as any;
  wsResumen.getColumn(1).width = 48;

  const wsContab = wb.addWorksheet("En contabilidad, no en DIAN");
  wsContab.addRow([
    "Verificar si corresponden a servicios públicos, nómina, u otros pagos que no requieren documento electrónico.",
  ]).font = { name: "Arial", size: 9, italic: true } as any;
  const hContab = wsContab.addRow(["Tipo", "Número documento", "Fecha", "Tercero (NIT)", "Nombre tercero", "Valor", "Filas contables"]);
  estilarEncabezado(hContab);
  for (const doc of resultado.soloEnContabilidad.sort((a, b) => b.valor - a.valor)) {
    wsContab.addRow([doc.tipo, doc.numero, doc.fecha, doc.tercero, doc.nombreTercero, doc.valor, doc.filas]);
  }
  wsContab.getColumn(6).numFmt = MONEY;
  wsContab.getColumn(1).width = 10; wsContab.getColumn(2).width = 16; wsContab.getColumn(3).width = 12;
  wsContab.getColumn(4).width = 16; wsContab.getColumn(5).width = 34; wsContab.getColumn(6).width = 16; wsContab.getColumn(7).width = 14;

  const wsDian = wb.addWorksheet("En DIAN, no en contabilidad");
  wsDian.addRow([
    "ATENCIÓN: estos documentos electrónicos no se encontraron en la contabilidad — posible ingreso o gasto sin registrar.",
  ]).font = { name: "Arial", size: 9, italic: true, bold: true } as any;
  const hDian = wsDian.addRow(["Grupo", "Tipo de documento", "Prefijo", "Folio", "Fecha", "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor", "Total"]);
  estilarEncabezado(hDian);
  for (const f of resultado.soloEnDian.sort((a, b) => b.total - a.total)) {
    const r = wsDian.addRow([f.grupo, f.tipo, f.prefijo, f.folio, f.fecha, f.nitEmisor, f.nombreEmisor, f.nitReceptor, f.nombreReceptor, f.total]);
    r.eachCell(c => { c.fill = ALERTA_FILL; });
  }
  wsDian.getColumn(10).numFmt = MONEY;
  wsDian.getColumn(1).width = 12; wsDian.getColumn(2).width = 24; wsDian.getColumn(3).width = 10;
  wsDian.getColumn(4).width = 12; wsDian.getColumn(5).width = 12; wsDian.getColumn(6).width = 16;
  wsDian.getColumn(7).width = 30; wsDian.getColumn(8).width = 16; wsDian.getColumn(9).width = 30; wsDian.getColumn(10).width = 16;

  // Cruce por tercero entre los dos "sobrantes" — cuando el mismo tercero
  // aparece en ambas listas de pendientes, es muy probable que sea la
  // MISMA transacción que no logró cruzar automáticamente (por número o
  // formato de fecha distintos) — revisando esto primero se detecta más
  // rápido qué es un faltante real y qué es solo un desfase de cruce.
  const porNitContab = new Map<string, DocumentoAuxiliar[]>();
  for (const doc of resultado.soloEnContabilidad) {
    const nit = soloDigitos(doc.tercero);
    if (!nit) continue;
    if (!porNitContab.has(nit)) porNitContab.set(nit, []);
    porNitContab.get(nit)!.push(doc);
  }
  const porNitDian = new Map<string, FilaDian[]>();
  for (const f of resultado.soloEnDian) {
    const nit = soloDigitos(f.grupo === "Recibido" ? f.nitEmisor : f.nitReceptor);
    if (!nit) continue;
    if (!porNitDian.has(nit)) porNitDian.set(nit, []);
    porNitDian.get(nit)!.push(f);
  }
  const nitsEnAmbos = Array.from(porNitContab.keys()).filter(nit => porNitDian.has(nit));

  if (nitsEnAmbos.length > 0) {
    const wsCruce = wb.addWorksheet("Posibles coincidencias (mismo tercero)");
    wsCruce.addRow([
      "Mismo tercero aparece en las dos listas de pendientes — revisar primero, probablemente sea la misma transacción sin cruzar por número/fecha distintos.",
    ]).font = { name: "Arial", size: 9, italic: true, bold: true } as any;
    const hCruce = wsCruce.addRow([
      "Tercero (NIT)", "— Contabilidad: Tipo", "Número", "Fecha", "Valor",
      "— DIAN: Tipo", "Folio", "Fecha", "Total", "Diferencia",
    ]);
    estilarEncabezado(hCruce);
    for (const nit of nitsEnAmbos) {
      const contabs = porNitContab.get(nit)!;
      const dians = porNitDian.get(nit)!;
      const maxFilas = Math.max(contabs.length, dians.length);
      for (let i = 0; i < maxFilas; i++) {
        const c = contabs[i];
        const d = dians[i];
        const r = wsCruce.addRow([
          i === 0 ? nit : "",
          c?.tipo || "", c?.numero || "", c?.fecha || "", c?.valor ?? "",
          d?.tipo || "", d?.folio || "", d?.fecha || "", d?.total ?? "",
          c && d ? Math.abs(c.valor - d.total) : "",
        ]);
        if (i === 0) r.font = FONT_BOLD as any;
      }
    }
    wsCruce.getColumn(5).numFmt = MONEY;
    wsCruce.getColumn(9).numFmt = MONEY;
    wsCruce.getColumn(10).numFmt = MONEY;
    wsCruce.getColumn(1).width = 16; wsCruce.getColumn(2).width = 12; wsCruce.getColumn(3).width = 12;
    wsCruce.getColumn(4).width = 12; wsCruce.getColumn(5).width = 16; wsCruce.getColumn(6).width = 12;
    wsCruce.getColumn(7).width = 12; wsCruce.getColumn(8).width = 12; wsCruce.getColumn(9).width = 16;
    wsCruce.getColumn(10).width = 14;
  }

  const totalItemsTerceros = seccionesTerceros.reduce((a, s) => a + s.items.length, 0);
  if (totalItemsTerceros > 0) {
    const wsTercero = wb.addWorksheet("Comparación por Tercero");
    wsTercero.addRow([
      "Compara el TOTAL de cada tercero (NIT) entre la DIAN y la contabilidad, separado por tipo de "
      + "documento — nómina contra las cuentas de nómina (5105/5205), documento soporte contra "
      + "honorarios y servicios, y las demás facturas recibidas contra el resto de cuentas 5 y 14 "
      + "(a veces 15/16/17). Los movimientos que no son ingreso ni gasto/deducción (traslados, "
      + "préstamos, y otros de cuentas de balance) ya se excluyeron de esta comparación. Si el total "
      + "de un tercero cuadra, muy probablemente todo está digitado aunque el cruce por documento no lo "
      + "haya detectado (facturas consolidadas, fechas distintas, etc.). Si el total NO cuadra, ahí sí "
      + "hay indicio real de un faltante de digitación, y por cuánto.",
    ]).font = { name: "Arial", size: 9, italic: true, bold: true } as any;
    wsTercero.getRow(1).alignment = { wrapText: true } as any;
    wsTercero.mergeCells(1, 1, 1, 8);
    wsTercero.getRow(1).height = 60;
    wsTercero.addRow([]);

    for (const seccion of seccionesTerceros) {
      if (seccion.items.length === 0) continue;
      const conDiferenciaReal = seccion.items.filter(t => !valoresCoinciden(t.totalDian, t.totalContabilidad));
      const rTitulo = wsTercero.addRow([seccion.titulo]);
      rTitulo.font = { name: "Arial", size: 11, bold: true } as any;
      wsTercero.addRow([`Con diferencia real: ${conDiferenciaReal.length} de ${seccion.items.length}`]).font = { name: "Arial", size: 9, italic: true } as any;
      const hTercero = wsTercero.addRow([
        "NIT", "Tercero", "Total DIAN", "Total Contabilidad", "Diferencia",
        "Docs. DIAN", "Registros contabilidad", "Estado",
      ]);
      estilarEncabezado(hTercero);
      for (const t of seccion.items) {
        const cuadra = valoresCoinciden(t.totalDian, t.totalContabilidad);
        const r = wsTercero.addRow([
          t.nit, t.nombre, t.totalDian, t.totalContabilidad, t.diferencia,
          t.cantidadDocumentosDian, t.cantidadRegistrosContabilidad,
          cuadra ? "Cuadra" : "⚠ Revisar",
        ]);
        if (!cuadra) r.eachCell(c => { c.fill = ALERTA_FILL; });
      }
      wsTercero.addRow([]);
    }
    wsTercero.getColumn(3).numFmt = MONEY; wsTercero.getColumn(4).numFmt = MONEY; wsTercero.getColumn(5).numFmt = MONEY;
    wsTercero.getColumn(1).width = 16; wsTercero.getColumn(2).width = 34; wsTercero.getColumn(3).width = 16;
    wsTercero.getColumn(4).width = 18; wsTercero.getColumn(5).width = 14; wsTercero.getColumn(6).width = 12;
    wsTercero.getColumn(7).width = 20; wsTercero.getColumn(8).width = 12;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
