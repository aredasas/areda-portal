import ExcelJS from "exceljs";
import { Readable } from "stream";

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

// ==================== ARCHIVO DE LA DIAN (reporte de documentos electrónicos) ====================

export type FilaDian = {
  tipo: string;
  folio: string; // sin normalizar, tal cual viene
  prefijo: string;
  nitEmisor: string; nombreEmisor: string;
  nitReceptor: string; nombreReceptor: string;
  total: number;
  grupo: "Emitido" | "Recibido" | "Desconocido";
};

type ColsDian = {
  tipo: number | null; folio: number; prefijo: number | null;
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
  return { tipo, folio: folio!, prefijo, nitEmisor: nitEmisor!, nombreEmisor, nitReceptor: nitReceptor!, nombreReceptor, total: total!, grupo };
}

export async function parseArchivoDian(filePathOrBuffer: string | Buffer): Promise<FilaDian[]> {
  const filas: FilaDian[] = [];
  const entrada = Buffer.isBuffer(filePathOrBuffer) ? Readable.from(filePathOrBuffer) : filePathOrBuffer;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(entrada as any, {});
  let header: any[] | null = null;
  let cols: ColsDian | null = null;

  for await (const worksheetReader of reader) {
    for await (const row of worksheetReader) {
      const values = row.values as any[];
      if (!header) {
        header = values;
        cols = resolverColumnasDian(header);
        continue;
      }
      const c = cols!;
      const folioRaw = values[c.folio];
      if (folioRaw === null || folioRaw === undefined || folioRaw === "") continue;
      const grupoTexto = c.grupo !== null ? String(values[c.grupo] ?? "").toLowerCase() : "";
      const grupo: FilaDian["grupo"] = grupoTexto.includes("emit") ? "Emitido" : grupoTexto.includes("recib") ? "Recibido" : "Desconocido";
      filas.push({
        tipo: c.tipo !== null ? String(values[c.tipo] ?? "").trim() : "",
        folio: String(folioRaw).trim(),
        prefijo: c.prefijo !== null ? String(values[c.prefijo] ?? "").trim() : "",
        nitEmisor: String(values[c.nitEmisor] ?? "").trim(),
        nombreEmisor: c.nombreEmisor !== null ? String(values[c.nombreEmisor] ?? "").trim() : "",
        nitReceptor: String(values[c.nitReceptor] ?? "").trim(),
        nombreReceptor: c.nombreReceptor !== null ? String(values[c.nombreReceptor] ?? "").trim() : "",
        total: Number(values[c.total]) || 0,
        grupo,
      });
    }
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
  valor: number;
  filas: number;
};

type ColsAuxiliarDian = {
  numero: number; tercero: number; nombreTercero: number | null;
  debito: number; credito: number; tipo: number | null;
  modoFecha: "combinada" | "separada" | "ninguna";
  fecha: number | null; anioCol: number | null; mesCol: number | null;
};

function resolverColumnasAuxiliarDian(headerRaw: any[]): ColsAuxiliarDian {
  const headers = Array.from(headerRaw, h => (h ? normalizar(String(h)) : ""));
  const numero = buscarColumna(headers, ["NUMERO", "DOCUMENTO", "CONSECUTIVO", "NRO DOCUMENTO", "NUM DOCUMENTO"]);
  const tercero = buscarColumna(headers, ["TERCERO", "NIT TERCERO", "IDENTIFICACION", "NIT"]);
  const nombreTercero = buscarColumna(headers, ["NOMBRE TERCERO", "RAZON SOCIAL", "NOMBRE DEL TERCERO"]);
  const debito = buscarColumna(headers, ["DEBITO", "DEBE"]);
  const credito = buscarColumna(headers, ["CREDITO", "HABER"]);
  const tipo = buscarColumna(headers, ["TIPO DE COMPROBANTE", "TIPO COMPROBANTE", "TIPO DOCUMENTO", "TIPO"]);
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
  return { numero: numero!, tercero: tercero!, nombreTercero, debito: debito!, credito: credito!, tipo, modoFecha, fecha, anioCol, mesCol };
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
  const entrada = Buffer.isBuffer(filePathOrBuffer) ? Readable.from(filePathOrBuffer) : filePathOrBuffer;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(entrada as any, {});
  let header: any[] | null = null;
  let cols: ColsAuxiliarDian | null = null;
  const valorPorClaveDoc = new Map<string, number>();
  const filasCrudas: { claveDoc: string; numero: string; tercero: string; nombreTercero: string; valorFila: number }[] = [];

  for await (const worksheetReader of reader) {
    for await (const row of worksheetReader) {
      const values = row.values as any[];
      if (!header) {
        header = values;
        cols = resolverColumnasAuxiliarDian(header);
        continue;
      }
      const c = cols!;
      if (c.modoFecha !== "ninguna") {
        const periodo = periodoDeFilaAuxiliarDian(values, c);
        if (!periodo || periodo.anio !== anioObjetivo || periodo.mes !== mesObjetivo) continue;
      }
      const numeroRaw = values[c.numero];
      if (numeroRaw === null || numeroRaw === undefined || numeroRaw === "") continue;
      const numeroNorm = soloDigitos(String(numeroRaw)).replace(/^0+/, "") || "0";
      const tipoRaw = c.tipo !== null ? String(values[c.tipo] ?? "").trim() : "";
      const claveDoc = `${tipoRaw}|${numeroNorm}`;
      const tercero = String(values[c.tercero] ?? "").trim();
      const nombreTercero = c.nombreTercero !== null ? String(values[c.nombreTercero] ?? "").trim() : "";
      const debito = Number(values[c.debito]) || 0;
      const credito = Number(values[c.credito]) || 0;
      const valorFila = Math.max(Math.abs(debito), Math.abs(credito));
      filasCrudas.push({ claveDoc, numero: numeroNorm, tercero, nombreTercero, valorFila });
      valorPorClaveDoc.set(claveDoc, Math.max(valorPorClaveDoc.get(claveDoc) || 0, valorFila));
    }
  }

  for (const fila of filasCrudas) {
    const valorDoc = valorPorClaveDoc.get(fila.claveDoc) || fila.valorFila;
    // La clave final que se expone incluye el número real y el valor del
    // documento (no el tipo, que es solo una ayuda interna de agrupación) —
    // así la búsqueda desde el lado DIAN sigue siendo por número+valor.
    const claveExpuesta = `${fila.numero}|${Math.round(valorDoc)}|${fila.claveDoc}`;
    if (!documentos.has(claveExpuesta)) {
      documentos.set(claveExpuesta, { numero: fila.numero, tercero: fila.tercero, nombreTercero: fila.nombreTercero, valor: valorDoc, filas: 0 });
    }
    documentos.get(claveExpuesta)!.filas++;
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

/** Compara documentos de la DIAN contra el libro auxiliar en dos pasadas:
 * 1) por número de documento (cuando quien genera el número es el mismo
 *    cliente — sus propias facturas de venta o documentos soporte, donde
 *    el número de la contabilidad y el folio de la DIAN coinciden).
 * 2) por NIT del tercero + valor (cuando el número lo genera el tercero —
 *    facturas de compra recibidas de proveedores, donde el número interno
 *    de la contabilidad no tiene relación con el folio del proveedor).
 * Lo que no cruza por ninguna de las dos formas queda para revisión
 * manual en el reporte final. */
export function compararDianVsAuxiliar(
  filasDian: FilaDian[], documentosAux: Map<string, DocumentoAuxiliar>,
): ResultadoComparacionDian {
  const auxDisponibles = new Set(documentosAux.keys());
  const soloEnDian: FilaDian[] = [];
  let emparejadosPorNumero = 0;
  let emparejadosPorNitValor = 0;

  // Índice por número solo (puede haber varios documentos —de distintas
  // series— compartiendo el mismo número; se desambiguan por valor al
  // momento de buscar, no aquí).
  const indicePorNumero = new Map<string, string[]>();
  const indiceNitValor = new Map<string, string[]>();
  for (const [clave, doc] of Array.from(documentosAux.entries())) {
    if (!indicePorNumero.has(doc.numero)) indicePorNumero.set(doc.numero, []);
    indicePorNumero.get(doc.numero)!.push(clave);

    const claveNitValor = `${soloDigitos(doc.tercero)}|${Math.round(doc.valor)}`;
    if (!indiceNitValor.has(claveNitValor)) indiceNitValor.set(claveNitValor, []);
    indiceNitValor.get(claveNitValor)!.push(clave);
  }

  for (const fila of filasDian) {
    const folioNorm = soloDigitos(fila.folio).replace(/^0+/, "") || "0";
    const nitTercero = fila.grupo === "Recibido" ? fila.nitEmisor : fila.nitReceptor;

    // 1) por número de documento — puede haber varios candidatos (de
    // distintas series numeradas de forma independiente); se elige el que
    // tenga el valor más parecido al total de la DIAN.
    const candidatosNumero = (indicePorNumero.get(folioNorm) || []).filter(k => auxDisponibles.has(k));
    if (candidatosNumero.length > 0) {
      let mejor: string | null = null;
      let mejorDif = Infinity;
      for (const clave of candidatosNumero) {
        const dif = Math.abs(documentosAux.get(clave)!.valor - fila.total);
        if (dif < mejorDif) { mejorDif = dif; mejor = clave; }
      }
      // Solo se acepta si el valor coincide razonablemente (tolerancia de
      // $1 por redondeos) — si el número existe pero ningún candidato se
      // acerca en valor, no es el mismo documento, se sigue al paso 2.
      if (mejor !== null && mejorDif <= 1) {
        auxDisponibles.delete(mejor);
        emparejadosPorNumero++;
        continue;
      }
    }

    // 2) por NIT del tercero + valor (facturas de compra donde el número
    // lo genera el proveedor, no el cliente).
    const claveNitValor = `${soloDigitos(nitTercero)}|${Math.round(fila.total)}`;
    const candidatosNitValor = (indiceNitValor.get(claveNitValor) || []).filter(k => auxDisponibles.has(k));
    if (candidatosNitValor.length > 0) {
      auxDisponibles.delete(candidatosNitValor[0]);
      emparejadosPorNitValor++;
      continue;
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
  const hContab = wsContab.addRow(["Número documento", "Tercero (NIT)", "Nombre tercero", "Valor", "Filas contables"]);
  estilarEncabezado(hContab);
  for (const doc of resultado.soloEnContabilidad.sort((a, b) => b.valor - a.valor)) {
    wsContab.addRow([doc.numero, doc.tercero, doc.nombreTercero, doc.valor, doc.filas]);
  }
  wsContab.getColumn(4).numFmt = MONEY;
  wsContab.getColumn(1).width = 18; wsContab.getColumn(2).width = 16;
  wsContab.getColumn(3).width = 34; wsContab.getColumn(4).width = 16; wsContab.getColumn(5).width = 14;

  const wsDian = wb.addWorksheet("En DIAN, no en contabilidad");
  wsDian.addRow([
    "ATENCIÓN: estos documentos electrónicos no se encontraron en la contabilidad — posible ingreso o gasto sin registrar.",
  ]).font = { name: "Arial", size: 9, italic: true, bold: true } as any;
  const hDian = wsDian.addRow(["Grupo", "Tipo de documento", "Prefijo", "Folio", "NIT Emisor", "Nombre Emisor", "NIT Receptor", "Nombre Receptor", "Total"]);
  estilarEncabezado(hDian);
  for (const f of resultado.soloEnDian.sort((a, b) => b.total - a.total)) {
    const r = wsDian.addRow([f.grupo, f.tipo, f.prefijo, f.folio, f.nitEmisor, f.nombreEmisor, f.nitReceptor, f.nombreReceptor, f.total]);
    r.eachCell(c => { c.fill = ALERTA_FILL; });
  }
  wsDian.getColumn(9).numFmt = MONEY;
  wsDian.getColumn(1).width = 12; wsDian.getColumn(2).width = 24; wsDian.getColumn(3).width = 10;
  wsDian.getColumn(4).width = 12; wsDian.getColumn(5).width = 16; wsDian.getColumn(6).width = 30;
  wsDian.getColumn(7).width = 16; wsDian.getColumn(8).width = 30; wsDian.getColumn(9).width = 16;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
