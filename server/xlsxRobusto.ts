import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Caché en memoria de filas ya leídas, por clave de archivo (normalmente
// el fileKey del storage) — evita releer y reprocesar el MISMO archivo
// grande varias veces en la misma ventana de tiempo. Un cuatrimestre de
// IVA dispara varias consultas independientes (IVA generado, compras,
// descontable, transitorio) que necesitan el MISMO libro auxiliar de
// cada mes — sin este caché, cada una lo volvía a leer desde cero.
// Se cachea la PROMESA (no solo el resultado ya resuelto) para que, si
// dos consultas piden el mismo archivo casi al mismo tiempo, la segunda
// espere el resultado de la primera en vez de iniciar su propia lectura
// en paralelo — evita duplicar el trabajo pesado también en ese caso.
type EntradaCache = { promesa: Promise<any[][]>; creadaEn: number };
const cacheFilas = new Map<string, EntradaCache>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos — suficiente para cubrir la carga completa de una pestaña, sin retener memoria indefinidamente
const CACHE_MAX_ENTRADAS = 12; // más que suficiente para un año completo cargado a la vez

function limpiarCacheSiHaceFalta() {
  const ahora = Date.now();
  for (const [clave, entrada] of Array.from(cacheFilas.entries())) {
    if (ahora - entrada.creadaEn > CACHE_TTL_MS) cacheFilas.delete(clave);
  }
  while (cacheFilas.size > CACHE_MAX_ENTRADAS) {
    const masVieja = Array.from(cacheFilas.entries()).sort((a, b) => a[1].creadaEn - b[1].creadaEn)[0];
    if (!masVieja) break;
    cacheFilas.delete(masVieja[0]);
  }
}

/** Lee la primera hoja de un archivo Excel y devuelve sus filas como
 * array de arrays (0-indexed) — igual formato que
 * `XLSX.utils.sheet_to_json(ws, {header:1})`, que es lo que usan todos
 * los parsers de libros auxiliares del sistema.
 *
 * Con respaldo automático para archivos MUY GRANDES (cientos de miles
 * de filas): el motor de JavaScript (V8) tiene un límite duro de
 * ~512MB para la longitud de un string, y el XML interno de una sola
 * hoja puede superarlo fácilmente aunque el .xlsx comprimido pese
 * mucho menos (confirmado con un caso real: 58MB comprimidos, 534MB de
 * XML sin comprimir, 541.897 filas). Cuando eso pasa, SheetJS atrapa
 * esa excepción INTERNAMENTE y simplemente omite la hoja del resultado
 * (`wb.Sheets[nombre]` queda `undefined`) — sin ningún error visible,
 * lo que hace parecer que el archivo no tiene ninguna columna
 * reconocible, cuando en realidad nunca se pudo leer en absoluto.
 *
 * El respaldo usa ExcelJS en modo streaming (procesa el XML por
 * eventos, sin cargar todo de una vez) — mucho más lento (segundos en
 * vez de milisegundos para archivos grandes), pero funciona sin
 * importar el tamaño.
 *
 * Si se pasa `cacheKey` (normalmente el fileKey del storage), el
 * resultado se reutiliza para llamadas posteriores con la misma clave
 * durante unos minutos — para no releer el mismo archivo grande varias
 * veces cuando distintos pasos de IVA lo necesitan casi al mismo tiempo. */
export function leerFilasXlsxRobusto(buffer: Buffer, cacheKey?: string): Promise<any[][]> {
  if (cacheKey) {
    limpiarCacheSiHaceFalta();
    const existente = cacheFilas.get(cacheKey);
    if (existente) return existente.promesa;
  }

  const promesa = leerFilasXlsxSinCache(buffer);
  if (cacheKey) {
    cacheFilas.set(cacheKey, { promesa, creadaEn: Date.now() });
    // Si la lectura falla, no queda una promesa rota cacheada para
    // siempre — se quita para que un reintento futuro lea de nuevo.
    promesa.catch(() => cacheFilas.delete(cacheKey));
  }
  return promesa;
}

async function leerFilasXlsxSinCache(buffer: Buffer): Promise<any[][]> {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (ws) {
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];
      if (filas.length > 0) return filas;
    }
  } catch {
    // Sigue al respaldo — cualquier error de SheetJS (incluido el de
    // longitud máxima de string) se trata igual que "no se pudo leer".
  }

  return leerFilasConExcelJsStreaming(buffer);
}

async function leerFilasConExcelJsStreaming(buffer: Buffer): Promise<any[][]> {
  // ExcelJS en modo streaming necesita un path en disco, no un Buffer.
  const tmpPath = path.join(os.tmpdir(), `xlsx-robusto-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  try {
    fs.writeFileSync(tmpPath, buffer);
    const filas: (any[] | null)[] = [];
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(tmpPath, {});
    for await (const worksheetReader of workbook) {
      for await (const row of worksheetReader) {
        // row.values es 1-indexed (el índice 0 siempre viene vacío) — se
        // normaliza a 0-indexed para que coincida con el formato de SheetJS.
        const valores = (row.values as any[]).slice(1);
        // row.number es la posición REAL de la fila en el archivo — se usa
        // para rellenar cualquier hueco (filas completamente vacías que
        // ExcelJS puede saltar), y así mantener el mismo índice que
        // tendría la fila si se hubiera leído con SheetJS.
        while (filas.length < row.number - 1) filas.push(null);
        filas[row.number - 1] = valores;
      }
      break; // solo la primera hoja, igual que el resto del sistema
    }
    return filas as any[][];
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort — no bloquea el resultado */ }
  }
}
