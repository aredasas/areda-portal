import { invokeLLM } from "./_core/llm";

// Reconocimiento de columnas del libro auxiliar/movimiento por sinónimos, en
// vez de nombres exactos — cada cliente/sistema contable exporta con
// encabezados distintos (ej. "CODPUC" vs "Código contable" vs "Cuenta
// contable"). La coincidencia es por SUBCADENA (no exacta), probando cada
// sinónimo en orden de prioridad — así "Fecha elaboración" reconoce
// "FECHA", y los sinónimos de código de cuenta van ANTES que los de
// nombre de cuenta, para no confundir la columna de código con la de
// descripción cuando un archivo trae ambas (ej. "Código contable" +
// "Cuenta contable").

function normalizar(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita tildes
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const SINONIMOS: Record<string, string[]> = {
  fecha: ["FECHA", "DATE"],
  anioCol: ["ANO", "AGNO", "YEAR", "VIGENCIA"],
  mesCol: ["MES", "MONTH"],
  // Los sinónimos de CÓDIGO van primero: si un archivo trae "Código
  // contable" (el código) Y "Cuenta contable" (el nombre) como columnas
  // separadas, esto asegura que se elija la columna de código.
  cuenta: [
    "CODPUC", "CODIGO CUENTA", "COD CUENTA", "CODCUENTA", "CODIGO CONTABLE",
    "COD CONTABLE", "PUC", "CUENTA CONTABLE", "CTA", "CUENTA", "CODIGO",
  ],
  debito: ["DEBITO", "DEBE"],
  credito: ["CREDITO", "HABER"],
  centroCosto: ["CCOSTO", "CENTRO COSTO", "CENTRO DE COSTO", "CENTROCOSTO", "CC", "CCO"],
  anulado: ["ANULADO", "ANULADA", "ANULA", "ESTADO"],
  // Columna de NOMBRE de cuenta (separada del código) — cuando el archivo
  // la trae, se usa directo como descripción, sin necesitar IA.
  nombreCuenta: ["CUENTA CONTABLE", "NOMBRE CUENTA", "NOMBRE DE LA CUENTA", "DESCRIPCION CUENTA", "DENOMINACION CUENTA"],
};

export type ColumnasResueltas = {
  modoFecha: "combinada" | "separada";
  fecha: number | null; // solo si modoFecha === "combinada"
  anioCol: number | null; mesCol: number | null; // solo si modoFecha === "separada"
  cuenta: number; debito: number; credito: number;
  centroCosto: number | null; anulado: number | null;
  /** Columna con el NOMBRE de la cuenta (separada del código), si el
   * archivo la trae — permite mostrar el nombre real sin depender de IA. */
  nombreCuenta: number | null;
  /** true si esta resolución vino del respaldo con IA (para registrar/avisar). */
  porIA?: boolean;
};

function buscarPorSinonimo(headersNormalizados: string[], campo: string): number | null {
  for (const syn of SINONIMOS[campo]) {
    // Coincidencia por PALABRA completa (con espacios de borde), no
    // subcadena cruda — así "FECHA" no confunde una columna "FECHAVEN"
    // (fecha de VENCIMIENTO, no la del movimiento) con la columna de fecha
    // real. Los espacios de borde tratan el inicio/fin de cada encabezado
    // como un límite de palabra también.
    const i = headersNormalizados.findIndex(h => ` ${h} `.includes(` ${syn} `));
    if (i !== -1) return i;
  }
  return null;
}

/** Intenta resolver las columnas por sinónimo únicamente (sin IA). Lanza un
 * error legible si falta alguna columna obligatoria (fecha o año+mes,
 * cuenta, débito, crédito). */
function resolverColumnasHeuristico(headerRaw: any[]): ColumnasResueltas {
  // ExcelJS puede devolver row.values como un array DISPERSO (con huecos
  // genuinos en celdas vacías, no null explícito). Array.from sí recorre
  // los huecos (a diferencia de .map, que los salta y los deja como huecos
  // en el resultado) — necesario porque findIndex más abajo NO salta
  // huecos y fallaría con "undefined" si quedara alguno.
  const headers = Array.from(headerRaw, h => (h ? normalizar(String(h)) : ""));

  const fecha = buscarPorSinonimo(headers, "fecha");
  const anioCol = buscarPorSinonimo(headers, "anioCol");
  const mesCol = buscarPorSinonimo(headers, "mesCol");
  const cuenta = buscarPorSinonimo(headers, "cuenta");
  const debito = buscarPorSinonimo(headers, "debito");
  const credito = buscarPorSinonimo(headers, "credito");

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

  let nombreCuenta = buscarPorSinonimo(headers, "nombreCuenta");
  if (nombreCuenta === cuenta) nombreCuenta = null; // evita usar la misma columna para código y nombre

  return {
    modoFecha: tieneFechaCombinada ? "combinada" : "separada",
    fecha, anioCol, mesCol,
    cuenta: cuenta!, debito: debito!, credito: credito!,
    centroCosto: buscarPorSinonimo(headers, "centroCosto"),
    anulado: buscarPorSinonimo(headers, "anulado"),
    nombreCuenta,
  };
}

/** Qué tan confiable se ve la columna de cuenta resuelta: si la mayoría de
 * los valores de muestra no parecen un código contable limpio (solo
 * dígitos), es señal de que se agarró la columna equivocada (ej. la de
 * descripción en vez de la de código) y conviene confirmar con IA. */
function pareceColumnaDeCodigos(muestras: any[][], colIdx: number): boolean {
  const valores = muestras.map(fila => fila[colIdx]).filter(v => v !== null && v !== undefined && v !== "");
  if (valores.length === 0) return false;
  const limpios = valores.filter(v => /^\d+$/.test(String(v).trim())).length;
  return limpios / valores.length >= 0.5;
}

/** Le pide a la IA que identifique las columnas a partir del encabezado y
 * unas filas de muestra, cuando el reconocimiento por sinónimo falla o no
 * es confiable. Devuelve null si la IA tampoco pudo identificarlas. */
async function resolverColumnasConIA(headerRaw: any[], muestras: any[][]): Promise<ColumnasResueltas | null> {
  const headers = Array.from(headerRaw, (h, i) => `${i}: ${h ?? ""}`).join(" | ");
  const filasTexto = muestras.slice(0, 8)
    .map((fila, i) => `Fila ${i}: ${Array.from(fila, v => (v === null || v === undefined ? "" : String(v))).join(" | ")}`)
    .join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Eres un experto en libros auxiliares contables colombianos. Dado el encabezado de un Excel (con el índice de cada columna) y unas filas de muestra, identifica el ÍNDICE de columna (número) para cada campo. Responde ÚNICAMENTE un JSON con esta forma exacta, sin texto adicional ni markdown:
{"fecha": <indice o null>, "anioCol": <indice o null>, "mesCol": <indice o null>, "cuenta": <indice>, "debito": <indice>, "credito": <indice>, "centroCosto": <indice o null>, "anulado": <indice o null>, "nombreCuenta": <indice o null>}
"cuenta" es la columna con el CÓDIGO contable/PUC (numérico, ej. "11050501"). "nombreCuenta" es una columna SEPARADA con el nombre/descripción de esa cuenta (ej. "Caja general"), si el archivo la trae — si no existe, déjala en null; NUNCA la confundas con "cuenta". "fecha" es una columna de fecha combinada (día+mes+año en una celda); si en cambio el año y el mes vienen en columnas separadas, deja "fecha" en null y usa "anioCol"/"mesCol". "cuenta", "debito" y "credito" son obligatorios; si no logras identificar alguno de esos tres, responde {"error": "razón breve"}.`,
        },
        { role: "user", content: `Encabezados (índice: nombre):\n${headers}\n\nMuestra de filas:\n${filasTexto}` },
      ],
    });

    const raw = response.choices?.[0]?.message?.content || "{}";
    const jsonStr = raw.includes("```") ? (raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw) : raw;
    const parsed = JSON.parse(jsonStr);
    if (parsed.error || parsed.cuenta === undefined || parsed.debito === undefined || parsed.credito === undefined) {
      return null;
    }

    const tieneFechaCombinada = parsed.fecha !== null && parsed.fecha !== undefined;
    return {
      modoFecha: tieneFechaCombinada ? "combinada" : "separada",
      fecha: tieneFechaCombinada ? parsed.fecha : null,
      anioCol: parsed.anioCol ?? null,
      mesCol: parsed.mesCol ?? null,
      cuenta: parsed.cuenta, debito: parsed.debito, credito: parsed.credito,
      centroCosto: parsed.centroCosto ?? null, anulado: parsed.anulado ?? null,
      nombreCuenta: parsed.nombreCuenta ?? null,
      porIA: true,
    };
  } catch (error) {
    console.error("[Informes] Resolución de columnas por IA falló:", error);
    return null;
  }
}

/** Resuelve las columnas del archivo: primero por sinónimo (rápido, sin
 * costo); si falla o la columna de cuenta resuelta no parece confiable
 * (valores de muestra no lucen como códigos), confirma con IA. Lanza un
 * error legible si ninguna de las dos formas lo logra. */
export async function resolverColumnasRobusto(headerRaw: any[], muestras: any[][]): Promise<ColumnasResueltas> {
  let heuristico: ColumnasResueltas | null = null;
  let errorHeuristico: Error | null = null;
  try {
    heuristico = resolverColumnasHeuristico(headerRaw);
  } catch (e: any) {
    errorHeuristico = e;
  }

  const confiable = heuristico && pareceColumnaDeCodigos(muestras, heuristico.cuenta);
  if (heuristico && confiable) return heuristico;

  const porIA = await resolverColumnasConIA(headerRaw, muestras);
  if (porIA) return porIA;

  if (heuristico) return heuristico; // sin confirmación de IA, pero es lo mejor que hay
  throw errorHeuristico || new Error("No se pudieron identificar las columnas del archivo.");
}

/** true si el valor de la columna "anulado" representa un registro anulado,
 * cubriendo las variantes más comunes de export contable colombiano. */
export function esAnulado(valor: any): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "boolean") return valor;
  const s = String(valor).trim().toUpperCase();
  return s === ".T." || s === "T" || s === "SI" || s === "S" || s === "TRUE" || s === "1" || s === "ANULADO";
}

/** true si el valor de la celda de cuenta parece un código contable limpio
 * (solo dígitos) — filtra filas de resumen/subtotal que algunos exports
 * intercalan (ej. "Cuenta contable: 11050501 Caja general...") y que de
 * otro modo duplicarían los valores ya sumados en las filas de detalle. */
export function pareceCodigoDeCuenta(valor: any): boolean {
  if (valor === null || valor === undefined) return false;
  return /^\d+$/.test(String(valor).trim());
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
