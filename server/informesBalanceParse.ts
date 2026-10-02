import { parsearPesos } from "../shared/flujoEfectivo";

/** BALANCE DE PRUEBA — lectura del archivo que sube el contador. Sin base
 * de datos: recibe las filas crudas de la hoja y devuelve las cuentas ya
 * limpias, para poder probarla contra un balance real.
 *
 * Cada programa contable lo exporta distinto (títulos arriba, nombres de
 * columna propios, todos los niveles mezclados, a veces por tercero), así
 * que aquí se resuelve todo eso:
 *   - el encabezado se busca en las primeras filas, por sinónimos;
 *   - el mes se intenta leer de los títulos ("al: 31/10/2025");
 *   - las cuentas de detalle (último nivel) se distinguen de los grupos,
 *     para no sumar dos veces;
 *   - si viene por tercero, se suma por cuenta;
 *   - los saldos quedan con el signo natural de cada clase. */

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Mismo criterio del resto del módulo (normalizarCuentaPUC): un cero de
 * relleno en el último grupo ("111006001" → "11100601"), para que la
 * cuenta del balance sea la misma del libro auxiliar. */
function normalizarCuenta(codigo: string): string {
  if (codigo.length % 2 === 1 && codigo.length >= 3 && codigo[codigo.length - 3] === "0") return codigo.slice(0, -3) + codigo.slice(-2);
  return codigo;
}

export type ColumnasBalance = {
  filaEncabezado: number;
  cuenta: number; nombre: number | null;
  saldoAnterior: number; debito: number; credito: number; saldoFinal: number;
  tercero: number | null;
};

const SINONIMOS = {
  saldoAnterior: ["SALDO MES ANT", "SALDO MES ANTERIOR", "SALDO ANTERIOR", "SALDO INICIAL", "SALDO ANT", "SALDO INI", "ANTERIOR", "INICIAL"],
  debito: ["MOVIMIENTO DEBITO", "MOVIMIENTOS DEBITO", "MOV DEBITO", "DEBITOS", "DEBITO", "DEBE"],
  credito: ["MOVIMIENTO CREDITO", "MOVIMIENTOS CREDITO", "MOV CREDITO", "CREDITOS", "CREDITO", "HABER"],
  saldoFinal: ["SALDO FINAL", "NUEVO SALDO", "SALDO ACTUAL", "SALDO MES", "SALDO A LA FECHA", "SALDO"],
  cuenta: ["CODIGO CTA", "CODIGO CUENTA", "COD CUENTA", "CODIGO CONTABLE", "CODPUC", "CODCUENTA", "PUC", "CUENTA CONTABLE", "CUENTA", "CODIGO", "CTA"],
  nombre: ["NOMBRE CTA", "NOMBRE CUENTA", "NOMBRE DE LA CUENTA", "DESCRIPCION CUENTA", "DENOMINACION", "DESCRIPCION", "NOMBRE", "DETALLE"],
  tercero: ["IDENTIFICACION", "NIT TERCERO", "NIT", "TERCERO", "CEDULA"],
};

function resolverEnFila(fila: any[], siguientes: any[][]): Omit<ColumnasBalance, "filaEncabezado"> | null {
  const header = Array.from(fila || [], h => (h === null || h === undefined ? "" : normalizar(String(h))));
  const usadas = new Set<number>();
  const buscar = (sinonimos: string[], valida?: (col: number) => boolean): number | null => {
    for (const syn of sinonimos) {
      const i = header.findIndex((h, idx) => !usadas.has(idx) && ` ${h} `.includes(` ${syn} `) && (!valida || valida(idx)));
      if (i !== -1) { usadas.add(i); return i; }
    }
    return null;
  };
  // La columna del código se confirma con las filas de abajo: debe traer
  // códigos, no nombres ("Cuenta" a secas también calza con "Nombre cuenta").
  const traeCodigos = (col: number) => {
    const valores = siguientes.map(f => f?.[col]).filter(v => v !== null && v !== undefined && String(v).trim() !== "");
    return valores.length > 0 && valores.filter(v => /^\d+$/.test(String(v).trim())).length / valores.length >= 0.6;
  };
  // El orden importa: "Saldo Mes Ant." y "Saldo Mes" comparten palabras, así
  // que primero se aparta el saldo anterior y lo que quede es el final.
  const saldoAnterior = buscar(SINONIMOS.saldoAnterior);
  const debito = buscar(SINONIMOS.debito);
  const credito = buscar(SINONIMOS.credito);
  const saldoFinal = buscar(SINONIMOS.saldoFinal);
  const cuenta = buscar(SINONIMOS.cuenta, traeCodigos);
  if (saldoAnterior === null || debito === null || credito === null || saldoFinal === null || cuenta === null) return null;
  const nombre = buscar(SINONIMOS.nombre);
  const tercero = buscar(SINONIMOS.tercero);
  return { cuenta, nombre, saldoAnterior, debito, credito, saldoFinal, tercero };
}

/** Busca la fila del encabezado entre las primeras filas (los balances
 * traen arriba la razón social, el NIT y las fechas). */
export function resolverColumnasBalance(filas: any[][]): ColumnasBalance {
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const cols = resolverEnFila(filas[i], filas.slice(i + 1, i + 61));
    if (cols) return { filaEncabezado: i, ...cols };
  }
  const vistos = filas.slice(0, 12).map(f => (f || []).filter((v: any) => v !== null && v !== undefined && v !== "").map(String).join(" | ")).filter(Boolean).slice(0, 8);
  throw new Error(
    "No se encontraron en el archivo las columnas del balance de prueba: código de cuenta, saldo anterior, débito, crédito y saldo final. " +
    `Primeras filas del archivo: ${vistos.join("  ·  ").slice(0, 600)}`,
  );
}

const MESES_TEXTO = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

/** Lee el mes del balance de los títulos que van antes del encabezado:
 * la última fecha de la fila que dice hasta cuándo va el informe ("Del:
 * 01/10/2025 al: 31/10/2025"). La fecha de impresión no cuenta. */
export function detectarPeriodoBalance(filas: any[][], filaEncabezado: number): { anio: number; mes: number } | null {
  const valido = (anio: number, mes: number) => anio >= 2000 && anio <= 2100 && mes >= 1 && mes <= 12;
  let respaldo: { anio: number; mes: number } | null = null;
  for (let i = 0; i < filaEncabezado; i++) {
    for (const celda of filas[i] || []) {
      if (celda instanceof Date) { respaldo = respaldo || { anio: celda.getUTCFullYear(), mes: celda.getUTCMonth() + 1 }; continue; }
      if (typeof celda !== "string") continue;
      const texto = normalizar(celda);
      if (texto.includes("IMPRESION") || texto.includes("GENERACION") || texto.includes("GENERADO")) continue;
      const fechas: { anio: number; mes: number }[] = [];
      for (const m of Array.from(celda.matchAll(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g))) if (valido(Number(m[3]), Number(m[2]))) fechas.push({ anio: Number(m[3]), mes: Number(m[2]) });
      for (const m of Array.from(celda.matchAll(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g))) if (valido(Number(m[1]), Number(m[2]))) fechas.push({ anio: Number(m[1]), mes: Number(m[2]) });
      const porNombre = texto.match(new RegExp(`\\b(${MESES_TEXTO.join("|")})\\b(?: DE| DEL)? (\\d{4})`));
      if (porNombre) fechas.push({ anio: Number(porNombre[2]), mes: MESES_TEXTO.indexOf(porNombre[1]) + 1 });
      if (fechas.length === 0) continue;
      const ultima = fechas[fechas.length - 1];
      // La fila que habla del informe o del corte manda sobre cualquier otra fecha suelta.
      if (/\b(INFORME|CORTE|PERIODO|HASTA|AL)\b/.test(texto)) return ultima;
      respaldo = respaldo || ultima;
    }
  }
  return respaldo;
}

export type CuentaBalance = {
  cuenta: string; nombre: string;
  saldoInicial: number; debitos: number; creditos: number; saldoFinal: number;
  esDetalle: boolean;
};

export type BalanceLeido = {
  cuentas: CuentaBalance[];
  periodoDetectado: { anio: number; mes: number } | null;
  porTercero: boolean;
  /** El archivo traía pasivo, patrimonio e ingresos en negativo (todo en
   * convención débito) y se pasaron a su signo natural. */
  signoInvertido: boolean;
  cuentasDetalle: number; cuentasInconsistentes: number;
  totales: { activo: number; pasivo: number; patrimonio: number; ingresos: number; gastos: number; costos: number };
  /** Ingresos − gastos − costos, acumulado al cierre del mes. */
  resultado: number;
  /** Activo − Pasivo − Patrimonio − Resultado: cero si la contabilidad cuadra. */
  diferenciaEcuacion: number;
  /** Débitos − créditos del mes. */
  diferenciaMovimiento: number;
};

const redondear = (n: number) => Math.round(n * 100) / 100;
const TOLERANCIA = 1;
const numero = (v: any): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === "") return 0;
  const directo = Number(v);
  if (Number.isFinite(directo)) return directo;
  return parsearPesos(String(v)) ?? 0;
};
/** Clases cuyo saldo natural es crédito. */
const esCredito = (cuenta: string) => "234".includes(cuenta[0]);

export function leerBalancePrueba(filas: any[][]): BalanceLeido {
  const cols = resolverColumnasBalance(filas);
  const periodoDetectado = detectarPeriodoBalance(filas, cols.filaEncabezado);

  // ---- 1. Filas con un código de cuenta limpio ----
  type Fila = { cuenta: string; nombre: string; ini: number; deb: number; cre: number; fin: number; conTercero: boolean };
  const crudas: Fila[] = [];
  for (let i = cols.filaEncabezado + 1; i < filas.length; i++) {
    const v = filas[i];
    if (!v) continue;
    const codigo = String(v[cols.cuenta] ?? "").trim();
    if (!/^\d+$/.test(codigo)) continue; // totales, subtítulos, líneas en blanco
    crudas.push({
      cuenta: normalizarCuenta(codigo),
      nombre: cols.nombre !== null ? String(v[cols.nombre] ?? "").trim() : "",
      ini: numero(v[cols.saldoAnterior]), deb: numero(v[cols.debito]), cre: numero(v[cols.credito]), fin: numero(v[cols.saldoFinal]),
      conTercero: cols.tercero !== null && String(v[cols.tercero] ?? "").trim() !== "",
    });
  }
  if (crudas.length === 0) throw new Error("El archivo tiene las columnas del balance, pero ninguna fila con un código de cuenta.");

  // ---- 2. Una fila por cuenta (si viene por tercero, se suma) ----
  // Cuando una cuenta trae su propia fila de total Y las de sus terceros,
  // se usa el total; si solo trae terceros, se suman.
  const porCuenta = new Map<string, { total: Fila | null; terceros: Fila[] }>();
  for (const f of crudas) {
    const g = porCuenta.get(f.cuenta) || { total: null, terceros: [] };
    if (f.conTercero) g.terceros.push(f);
    else if (!g.total) g.total = f;
    else g.terceros.push(f); // misma cuenta repetida sin columna de tercero: también se suma
    porCuenta.set(f.cuenta, g);
  }
  let porTercero = false;
  const unicas: Fila[] = [];
  for (const [cuenta, g] of Array.from(porCuenta.entries())) {
    if (g.total && g.terceros.every(t => t.conTercero)) { unicas.push(g.total); if (g.terceros.length > 0) porTercero = true; continue; }
    const todas = g.total ? [g.total, ...g.terceros] : g.terceros;
    if (todas.length > 1 || todas[0].conTercero) porTercero = true;
    unicas.push({
      cuenta, nombre: (g.total || todas[0]).nombre, conTercero: false,
      ini: todas.reduce((s, t) => s + t.ini, 0), deb: todas.reduce((s, t) => s + t.deb, 0),
      cre: todas.reduce((s, t) => s + t.cre, 0), fin: todas.reduce((s, t) => s + t.fin, 0),
    });
  }
  unicas.sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  // ---- 3. Cuentas de detalle: las que no tienen ninguna otra por debajo ----
  // Ordenadas, la siguiente cuenta es la única que puede empezar por esta.
  const esDetalle = unicas.map((f, i) => !(i + 1 < unicas.length && unicas[i + 1].cuenta.startsWith(f.cuenta)));

  // ---- 4. Signo: ¿pasivo, patrimonio e ingresos vienen en negativo? ----
  // Se mira en las cuentas con movimiento cuál fórmula cumple el archivo:
  // natural (final = anterior − débito + crédito) o todo en débito.
  let natural = 0, debito = 0;
  unicas.forEach((f, i) => {
    if (!esDetalle[i] || !esCredito(f.cuenta) || Math.abs(f.deb - f.cre) <= TOLERANCIA) return;
    if (Math.abs(f.ini - f.deb + f.cre - f.fin) <= TOLERANCIA) natural++;
    else if (Math.abs(f.ini + f.deb - f.cre - f.fin) <= TOLERANCIA) debito++;
  });
  const signoInvertido = debito > natural;

  let cuentasInconsistentes = 0;
  const cuentas: CuentaBalance[] = unicas.map((f, i) => {
    const signo = signoInvertido && esCredito(f.cuenta) ? -1 : 1;
    const saldoInicial = redondear(signo * f.ini);
    const saldoFinal = redondear(signo * f.fin);
    const esperado = esCredito(f.cuenta) ? saldoInicial - f.deb + f.cre : saldoInicial + f.deb - f.cre;
    if (esDetalle[i] && Math.abs(esperado - saldoFinal) > TOLERANCIA) cuentasInconsistentes++;
    return { cuenta: f.cuenta.slice(0, 20), nombre: f.nombre.slice(0, 255), saldoInicial, debitos: redondear(f.deb), creditos: redondear(f.cre), saldoFinal, esDetalle: esDetalle[i] };
  });

  // ---- 5. Comprobaciones ----
  const detalle = cuentas.filter(c => c.esDetalle);
  const suma = (clases: string) => redondear(detalle.filter(c => clases.includes(c.cuenta[0])).reduce((s, c) => s + c.saldoFinal, 0));
  const totales = { activo: suma("1"), pasivo: suma("2"), patrimonio: suma("3"), ingresos: suma("4"), gastos: suma("5"), costos: suma("67") };
  const resultado = redondear(totales.ingresos - totales.gastos - totales.costos);
  // Las cuentas de orden (8 y 9) no entran ni a la ecuación ni al movimiento.
  const contables = detalle.filter(c => "1234567".includes(c.cuenta[0]));
  return {
    cuentas, periodoDetectado, porTercero, signoInvertido,
    cuentasDetalle: detalle.length, cuentasInconsistentes, totales, resultado,
    diferenciaEcuacion: redondear(totales.activo - totales.pasivo - totales.patrimonio - resultado),
    diferenciaMovimiento: redondear(contables.reduce((s, c) => s + c.debitos - c.creditos, 0)),
  };
}
