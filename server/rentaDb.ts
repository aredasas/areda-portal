import * as XLSX from "xlsx";

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
