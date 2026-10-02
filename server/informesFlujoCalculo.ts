import { esCuentaDeEfectivo } from "../shared/flujoEfectivo";
import { esAnulado, parseFecha } from "./informesParseUtils";

/** FLUJO DE EFECTIVO — cálculo de un mes a partir de las filas crudas del
 * libro auxiliar. Sin base de datos ni almacenamiento: recibe filas y
 * devuelve números, para poder probarlo contra totales conocidos.
 *
 * Método (el mismo del libro modelo):
 *   1. La llave es el DOCUMENTO: tipo + número de comprobante.
 *   2. Se toman todos los documentos que tengan al menos una línea en una
 *      cuenta de efectivo (caja, bancos, ahorros).
 *   3. Se valida que ese grupo tenga sumas iguales y cuántos documentos
 *      están descuadrados.
 *   4. Las demás líneas de esos documentos (las contrapartidas) se
 *      agrupan por cuenta: eso es lo que explica el movimiento del
 *      efectivo. Como cada documento cuadra, la suma de contrapartidas
 *      (créditos − débitos) es igual a la variación del efectivo. */

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Mismo criterio del resto del módulo (ver normalizarCuentaPUC en
 * informesDb): algunos programas rellenan el último grupo con un cero de
 * más ("111006001" queda igual, "613505001" → "61350501"). Se repite
 * aquí para que este archivo no dependa de la base de datos. */
function normalizarCuenta(codigo: string): string {
  if (codigo.length % 2 === 1 && codigo.length >= 3 && codigo[codigo.length - 3] === "0") {
    return codigo.slice(0, -3) + codigo.slice(-2);
  }
  return codigo;
}

export type ColumnasFlujo = {
  cuenta: number; debito: number; credito: number; numero: number;
  tipo: number | null; nombreCuenta: number | null;
  tercero: number | null; nombreTercero: number | null; anulado: number | null;
  modoFecha: "combinada" | "separada" | "ninguna";
  fecha: number | null; anioCol: number | null; mesCol: number | null;
};

const esCodigo = (v: any) => v !== null && v !== undefined && /^\d+$/.test(String(v).trim());

/** Reconoce las columnas del auxiliar por sinónimos, igual que los demás
 * informes. La de cuenta se confirma con una muestra (debe traer códigos,
 * no nombres): varios programas exportan "Código contable" y "Cuenta
 * contable" juntas y un sinónimo genérico puede caer en la del nombre. */
export function resolverColumnasFlujo(filas: any[][]): ColumnasFlujo {
  const header = Array.from(filas[0] || [], h => (h ? normalizar(String(h)) : ""));
  const muestra = filas.slice(1, 201).filter(Boolean);
  const usadas = new Set<number>();
  const buscar = (sinonimos: string[], valida?: (col: number) => boolean): number | null => {
    for (const syn of sinonimos) {
      for (let i = 0; i < header.length; i++) {
        if (usadas.has(i) || !` ${header[i]} `.includes(` ${syn} `)) continue;
        if (valida && !valida(i)) continue;
        return i;
      }
    }
    return null;
  };
  const tomar = (col: number | null) => { if (col !== null) usadas.add(col); return col; };

  const traeCodigos = (col: number) => {
    const valores = muestra.map(f => f[col]).filter(v => v !== null && v !== undefined && v !== "");
    return valores.length > 0 && valores.filter(esCodigo).length / valores.length >= 0.7;
  };
  const cuenta = tomar(buscar(
    ["CODPUC", "CODIGO CONTABLE", "CODIGO CUENTA", "COD CUENTA", "CODCUENTA", "COD CONTABLE", "PUC", "CUENTA CONTABLE", "NUMERO CUENTA", "CTA", "CUENTA", "CODIGO"],
    traeCodigos,
  ));
  const debito = tomar(buscar(["DEBITO", "DEBE"]));
  const credito = tomar(buscar(["CREDITO", "HABER"]));
  const nombreCuenta = tomar(buscar(["NOMBRE CUENTA", "NOMBRE DE LA CUENTA", "DESCRIPCION CUENTA", "DENOMINACION CUENTA", "CUENTA CONTABLE"]));
  const tipo = tomar(buscar(["TIPO DE COMPROBANTE", "TIPO COMPROBANTE", "TIPO DOCUMENTO", "TIPO DE DOCUMENTO", "TIPO"]));
  const nombreTercero = tomar(buscar(["NOMBRE TERCERO", "NOMBRE DEL TERCERO", "RAZON SOCIAL"]));
  const tercero = tomar(buscar(["IDENTIFICACION", "NIT TERCERO", "NIT", "TERCERO"]));
  // La llave es el COMPROBANTE contable, no el documento de referencia
  // (factura del proveedor, cheque…) que algunos programas traen en otra
  // columna: por eso "comprobante" y "consecutivo" van antes que
  // "documento". Si aun así se eligiera mal, se nota enseguida: los
  // documentos salen descuadrados en la validación.
  const numero = tomar(buscar([
    "NUMERO COMPROBANTE", "NUMERO DE COMPROBANTE", "NRO COMPROBANTE", "NUM COMPROBANTE", "CONSECUTIVO", "COMPROBANTE",
    "NUMERO", "NRO DOCUMENTO", "NUM DOCUMENTO", "DOCUMENTO",
  ]));
  const fecha = buscar(["FECHA"]);
  const anioCol = buscar(["ANO", "AGNO", "YEAR", "VIGENCIA"]);
  const mesCol = buscar(["MES", "MONTH"]);
  const anulado = buscar(["ANULADO", "ANULADA", "ANULA"]);

  const faltantes: string[] = [];
  if (cuenta === null) faltantes.push("código de cuenta");
  if (debito === null) faltantes.push("débito");
  if (credito === null) faltantes.push("crédito");
  if (numero === null) faltantes.push("número de comprobante");
  if (faltantes.length > 0) {
    throw new Error(
      `No se pudo identificar la(s) columna(s) de ${faltantes.join(", ")} en el libro auxiliar. ` +
      `Encabezados encontrados: ${(filas[0] || []).filter(Boolean).map(String).join(", ")}`,
    );
  }
  return {
    cuenta: cuenta!, debito: debito!, credito: credito!, numero: numero!, tipo, nombreCuenta, tercero, nombreTercero, anulado,
    modoFecha: fecha !== null ? "combinada" : anioCol !== null && mesCol !== null ? "separada" : "ninguna",
    fecha, anioCol, mesCol,
  };
}

export type ClaseMovimiento = "efectivo" | "contrapartida" | "sin_efecto";

export type FilaMovimientoFlujo = {
  clase: ClaseMovimiento; cuenta: string; tipoDocumento: string;
  debitos: number; creditos: number; documentos: number; lineas: number;
};

export type ResultadoFlujoMes = {
  /** Documentos con movimiento en efectivo y sus líneas. */
  documentos: number; lineas: number;
  /** Líneas del auxiliar de ese mes (estén o no en el grupo). */
  lineasAuxiliar: number;
  totalDebitos: number; totalCreditos: number; descuadrados: number;
  movimientos: FilaMovimientoFlujo[];
  /** cuenta a 4 dígitos → terceros de mayor valor (neto = créditos − débitos). */
  observaciones: Record<string, { nombre: string; neto: number }[]>;
  /** Cuentas del grupo 11 presentes en el mes, para sugerir cuáles son efectivo. */
  cuentasDisponibles: { cuenta: string; nombre: string | null }[];
  /** Nombres de cuenta que trae el archivo, de las cuentas del grupo de documentos. */
  nombres: Map<string, string>;
};

const TOLERANCIA = 0.5;
const redondear = (n: number) => Math.round(n * 100) / 100;
const numero = (v: any) => (typeof v === "number" ? v : Number(v) || 0);

export function calcularFlujoMes(filas: any[][], anio: number, mes: number, prefijosEfectivo: string[]): ResultadoFlujoMes {
  const vacio: ResultadoFlujoMes = {
    documentos: 0, lineas: 0, lineasAuxiliar: 0, totalDebitos: 0, totalCreditos: 0, descuadrados: 0,
    movimientos: [], observaciones: {}, cuentasDisponibles: [], nombres: new Map(),
  };
  if (filas.length < 2) return vacio;
  const cols = resolverColumnasFlujo(filas);

  // ---- 1. Líneas del mes y a qué documento pertenece cada una ----
  type Linea = { doc: string; tipo: string; cuenta: string; debito: number; credito: number; tercero: string };
  const lineas: Linea[] = [];
  const nombresArchivo = new Map<string, string>();
  for (let i = 1; i < filas.length; i++) {
    const v = filas[i];
    if (!v) continue;
    if (cols.anulado !== null && esAnulado(v[cols.anulado])) continue;
    // Filas de subtotal o de encabezado intercaladas: no traen un código limpio.
    if (!esCodigo(v[cols.cuenta])) continue;
    if (cols.modoFecha !== "ninguna") {
      const periodo = cols.modoFecha === "separada"
        ? { anio: Number(v[cols.anioCol!]), mes: Number(v[cols.mesCol!]) }
        : parseFecha(v[cols.fecha!]);
      if (!periodo || periodo.anio !== anio || periodo.mes !== mes) continue;
    }
    const cuenta = normalizarCuenta(String(v[cols.cuenta]).trim());
    const numeroTexto = String(v[cols.numero] ?? "").trim();
    // Sin columna de tipo, el tipo suele venir pegado al número ("CE-00526").
    const tipo = (cols.tipo !== null ? String(v[cols.tipo] ?? "").trim() : (numeroTexto.match(/^[A-Za-z]+/)?.[0] || "")).toUpperCase();
    // Una línea sin número de comprobante no se puede asociar a nada: queda
    // como un documento propio (y saldrá descuadrada, que es lo correcto).
    const doc = numeroTexto ? (cols.tipo !== null ? `${tipo}-${numeroTexto}` : numeroTexto) : `?${i}`;
    const tercero = cols.nombreTercero !== null && String(v[cols.nombreTercero] ?? "").trim()
      ? String(v[cols.nombreTercero]).trim()
      : cols.tercero !== null ? String(v[cols.tercero] ?? "").trim() : "";
    lineas.push({ doc, tipo, cuenta, debito: numero(v[cols.debito]), credito: numero(v[cols.credito]), tercero });
    if (cols.nombreCuenta !== null && !nombresArchivo.has(cuenta)) {
      const nombre = String(v[cols.nombreCuenta] ?? "").trim();
      if (nombre && !esCodigo(nombre)) nombresArchivo.set(cuenta, nombre);
    }
  }

  // ---- 2. Documentos que tocan efectivo ----
  type Doc = { debitos: number; creditos: number; lineas: number; inventario: number; costo: number };
  const docs = new Map<string, Doc>();
  const esEfectivo = (cuenta: string) => esCuentaDeEfectivo(cuenta, prefijosEfectivo);
  for (const l of lineas) if (esEfectivo(l.cuenta) && !docs.has(l.doc)) docs.set(l.doc, { debitos: 0, creditos: 0, lineas: 0, inventario: 0, costo: 0 });
  for (const l of lineas) {
    const d = docs.get(l.doc);
    if (!d) continue;
    d.debitos += l.debito; d.creditos += l.credito; d.lineas++;
    if (l.cuenta.startsWith("14")) d.inventario += l.credito - l.debito;
    else if (l.cuenta.startsWith("6")) d.costo += l.credito - l.debito;
  }
  // "Sin efecto en caja": en el mismo documento el costo de venta y el
  // inventario se cancelan exactamente (cada factura de venta registra su
  // costo contra el inventario). No es plata que entre ni salga.
  const sinEfecto = (d: Doc) => Math.abs(d.inventario) > TOLERANCIA && Math.abs(d.inventario + d.costo) <= TOLERANCIA;

  // ---- 3. Agrupación ----
  const grupos = new Map<string, FilaMovimientoFlujo & { docs: Set<string> }>();
  const terceros = new Map<string, Map<string, number>>();
  const nombres = new Map<string, string>();
  for (const l of lineas) {
    const d = docs.get(l.doc);
    if (!d) continue;
    const clase: ClaseMovimiento = esEfectivo(l.cuenta) ? "efectivo"
      : (l.cuenta.startsWith("14") || l.cuenta.startsWith("6")) && sinEfecto(d) ? "sin_efecto" : "contrapartida";
    // El efectivo se resume por cuenta; lo demás, por cuenta y tipo de comprobante.
    const tipoDocumento = clase === "efectivo" ? "" : l.tipo;
    const clave = `${clase}|${l.cuenta}|${tipoDocumento}`;
    let g = grupos.get(clave);
    if (!g) { g = { clase, cuenta: l.cuenta, tipoDocumento, debitos: 0, creditos: 0, documentos: 0, lineas: 0, docs: new Set() }; grupos.set(clave, g); }
    g.debitos += l.debito; g.creditos += l.credito; g.lineas++; g.docs.add(l.doc);
    const nombre = nombresArchivo.get(l.cuenta);
    if (nombre) nombres.set(l.cuenta, nombre);
    if (clase === "contrapartida" && l.tercero) {
      const cuenta4 = l.cuenta.slice(0, 4);
      let porTercero = terceros.get(cuenta4);
      if (!porTercero) { porTercero = new Map(); terceros.set(cuenta4, porTercero); }
      porTercero.set(l.tercero, (porTercero.get(l.tercero) || 0) + l.credito - l.debito);
    }
  }

  let totalDebitos = 0, totalCreditos = 0, descuadrados = 0, lineasGrupo = 0;
  for (const d of Array.from(docs.values())) {
    totalDebitos += d.debitos; totalCreditos += d.creditos; lineasGrupo += d.lineas;
    if (Math.abs(d.debitos - d.creditos) > TOLERANCIA) descuadrados++;
  }

  const observaciones: ResultadoFlujoMes["observaciones"] = {};
  for (const [cuenta4, porTercero] of Array.from(terceros.entries())) {
    observaciones[cuenta4] = Array.from(porTercero.entries())
      .map(([nombre, neto]) => ({ nombre, neto: redondear(neto) }))
      .filter(t => Math.abs(t.neto) >= 1)
      .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto))
      .slice(0, 5);
  }

  const disponibles = new Map<string, string | null>();
  for (const l of lineas) if (l.cuenta.startsWith("11") && !disponibles.has(l.cuenta)) disponibles.set(l.cuenta, nombresArchivo.get(l.cuenta) || null);

  return {
    documentos: docs.size, lineas: lineasGrupo, lineasAuxiliar: lineas.length,
    totalDebitos: redondear(totalDebitos), totalCreditos: redondear(totalCreditos), descuadrados,
    movimientos: Array.from(grupos.values())
      .map(({ docs: delGrupo, ...g }) => ({ ...g, debitos: redondear(g.debitos), creditos: redondear(g.creditos), documentos: delGrupo.size }))
      .sort((a, b) => a.clase.localeCompare(b.clase) || a.cuenta.localeCompare(b.cuenta) || a.tipoDocumento.localeCompare(b.tipoDocumento)),
    observaciones,
    cuentasDisponibles: Array.from(disponibles.entries()).map(([cuenta, nombre]) => ({ cuenta, nombre })).sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    nombres,
  };
}
