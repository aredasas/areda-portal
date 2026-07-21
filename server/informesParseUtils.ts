// Reconocimiento de columnas del libro auxiliar/movimiento por sinónimos, en
// vez de nombres exactos — cada cliente/sistema contable exporta con
// encabezados distintos (ej. "CODPUC" vs "CUENTA" vs "Codigo Cuenta").

function normalizar(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita tildes
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const SINONIMOS: Record<string, string[]> = {
  fecha: ["FECHA", "FECHA COMPROBANTE", "FECHA MOVIMIENTO", "FECHA CONTABLE", "DATE"],
  anioCol: ["ANO", "AGNO", "YEAR", "VIGENCIA"],
  mesCol: ["MES", "MONTH"],
  diaCol: ["DIA", "DAY"],
  cuenta: ["CODPUC", "CUENTA", "CODIGO CUENTA", "COD CUENTA", "CODCUENTA", "CTA", "CUENTA CONTABLE", "CODIGO", "PUC"],
  debito: ["DEBITO", "VALOR DEBITO", "DB", "DEBE", "VALOR DEBE"],
  credito: ["CREDITO", "VALOR CREDITO", "CR", "HABER", "VALOR HABER"],
  centroCosto: ["CCOSTO", "CENTRO COSTO", "CENTRO DE COSTO", "CC", "CCO", "CENTROCOSTO"],
  anulado: ["ANULADO", "ANULADA", "ESTADO", "ANULA"],
};

export type ColumnasResueltas = {
  modoFecha: "combinada" | "separada";
  fecha: number | null; // solo si modoFecha === "combinada"
  anioCol: number | null; mesCol: number | null; // solo si modoFecha === "separada"
  cuenta: number; debito: number; credito: number;
  centroCosto: number | null; anulado: number | null;
};

/** Recibe la fila de encabezados cruda del Excel y ubica cada columna
 * necesaria por sinónimo (sin importar tildes, mayúsculas o espacios).
 * Acepta dos formas de indicar el periodo: una columna de fecha combinada
 * (ej. "FECHA"), o columnas separadas de año y mes (ej. "AÑO"/"MES", como
 * trae el export real de Colfamil). Lanza un error legible si no encuentra
 * ninguna de las dos formas, o si falta cuenta/débito/crédito — mejor fallar
 * temprano con un mensaje claro que producir un reporte silenciosamente
 * vacío o mal armado. */
export function resolverColumnas(headerRaw: any[]): ColumnasResueltas {
  const idx: Record<string, number> = {};
  headerRaw.forEach((h, i) => { if (h) idx[normalizar(String(h))] = i; });

  const buscar = (campo: string): number | null => {
    for (const s of SINONIMOS[campo]) {
      if (idx[s] !== undefined) return idx[s];
    }
    return null;
  };

  const fecha = buscar("fecha");
  const anioCol = buscar("anioCol");
  const mesCol = buscar("mesCol");
  const cuenta = buscar("cuenta");
  const debito = buscar("debito");
  const credito = buscar("credito");

  const faltantes: string[] = [];
  const tieneFechaCombinada = fecha !== null;
  const tieneFechaSeparada = anioCol !== null && mesCol !== null;
  if (!tieneFechaCombinada && !tieneFechaSeparada) faltantes.push("fecha (o año + mes por separado)");
  if (cuenta === null) faltantes.push("cuenta");
  if (debito === null) faltantes.push("débito");
  if (credito === null) faltantes.push("crédito");
  if (faltantes.length > 0) {
    throw new Error(
      `No se pudo identificar la(s) columna(s) ${faltantes.join(", ")} en el archivo. ` +
      `Encabezados encontrados: ${headerRaw.filter(Boolean).map(String).join(", ")}`,
    );
  }

  return {
    modoFecha: tieneFechaCombinada ? "combinada" : "separada",
    fecha, anioCol, mesCol,
    cuenta: cuenta!, debito: debito!, credito: credito!,
    centroCosto: buscar("centroCosto"), anulado: buscar("anulado"),
  };
}

/** true si el valor de la columna "anulado" representa un registro anulado,
 * cubriendo las variantes más comunes de export contable colombiano. */
export function esAnulado(valor: any): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "boolean") return valor;
  const s = String(valor).trim().toUpperCase();
  return s === ".T." || s === "T" || s === "SI" || s === "S" || s === "TRUE" || s === "1" || s === "ANULADO";
}

/** Extrae {anio, mes} de una fila ya con las columnas resueltas, sin
 * importar si el archivo trae fecha combinada o año/mes por separado. */
export function periodoDeFila(values: any[], cols: ColumnasResueltas): { anio: number; mes: number } | null {
  if (cols.modoFecha === "separada") {
    const anio = Number(values[cols.anioCol!]);
    const mes = Number(values[cols.mesCol!]);
    if (!anio || !mes || mes < 1 || mes > 12) return null;
    return { anio, mes };
  }
  return parseFecha(values[cols.fecha!]);
}

/** Convierte un serial de fecha de Excel (días desde 1899-12-30) a Date. */
function serialADate(serial: number): Date {
  const utcDias = Math.floor(serial - 25569);
  return new Date(utcDias * 86400 * 1000);
}

/** Extrae {anio, mes} de una celda de fecha, sin importar si ExcelJS la
 * entrega como Date, número serial, o texto en formato DD/MM/YYYY o
 * YYYY-MM-DD (se asume convención colombiana día/mes cuando es ambiguo).
 * Devuelve null si no se pudo interpretar. */
export function parseFecha(raw: any): { anio: number; mes: number } | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date) return { anio: raw.getFullYear(), mes: raw.getMonth() + 1 };
  if (typeof raw === "number") {
    const d = serialADate(raw);
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  }
  if (typeof raw === "object") {
    if ("result" in raw) return parseFecha((raw as any).result);
    if ("text" in raw) return parseFecha((raw as any).text);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); // YYYY-MM-DD
    if (m) return { anio: Number(m[1]), mes: Number(m[2]) };
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD/MM/YYYY (convención colombiana)
    if (m) return { anio: Number(m[3]), mes: Number(m[2]) };
  }
  return null;
}
