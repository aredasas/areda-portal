import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  informesFlujoConfig, informesFlujoCalculos, informesFlujoMovimientos, informesFlujoSaldos, informesFlujoSecciones,
  informesCuentasCliente,
} from "../drizzle/schema";
import { getCargaConArchivo, getCatalogoCliente, getCuentasPucConocidas, listarCargas } from "./informesDb";
import { storageGetBuffer } from "./storage";
import { leerFilasXlsxRobusto } from "./xlsxRobusto";
import { calcularFlujoMes } from "./informesFlujoCalculo";
import { NOMBRES_PUC } from "./informesFlujoPuc";
import {
  PREFIJOS_EFECTIVO_DEFECTO, SECCIONES_FLUJO, TITULO_SECCION, normalizarPrefijos, seccionPorDefecto, type SeccionFlujo,
} from "../shared/flujoEfectivo";

/** FLUJO DE EFECTIVO — persistencia y armado del informe comparativo.
 * El cálculo pesado (leer el auxiliar completo) se hace una vez por mes y
 * queda guardado por subcuenta y tipo de comprobante; el informe del año,
 * las secciones y los saldos se arman después sobre eso, sin volver a
 * leer el archivo. */

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const redondear = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------
// Configuración: cuentas de efectivo
// ---------------------------------------------------------------------

export async function getPrefijosEfectivo(clienteId: number): Promise<{ prefijos: string[]; porDefecto: boolean }> {
  const db = await getDb();
  if (!db) return { prefijos: PREFIJOS_EFECTIVO_DEFECTO, porDefecto: true };
  const [fila] = await db.select().from(informesFlujoConfig).where(eq(informesFlujoConfig.clienteId, clienteId)).limit(1);
  const prefijos = fila ? normalizarPrefijos(fila.prefijosEfectivo) : [];
  return prefijos.length > 0 ? { prefijos, porDefecto: false } : { prefijos: PREFIJOS_EFECTIVO_DEFECTO, porDefecto: true };
}

export async function guardarPrefijosEfectivo(clienteId: number, entrada: string[], userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const prefijos = normalizarPrefijos(entrada);
  if (prefijos.length === 0) throw new Error("Indica al menos una cuenta de efectivo (por ejemplo 1105, 1110, 1120).");
  const texto = prefijos.join(",");
  if (texto.length > 500) throw new Error("Son demasiadas cuentas: usa el código del grupo (ej. 1110) en vez de cada subcuenta.");
  await db.insert(informesFlujoConfig).values({ clienteId, prefijosEfectivo: texto, actualizadoPorId: userId })
    .onDuplicateKeyUpdate({ set: { prefijosEfectivo: texto, actualizadoPorId: userId } });
  return prefijos;
}

// ---------------------------------------------------------------------
// Cálculo de un mes
// ---------------------------------------------------------------------

export type ResultadoCalculoMes = {
  mes: number; documentos: number; lineas: number; descuadrados: number;
  /** Diferencia débitos − créditos del grupo de documentos (debe ser cero). */
  diferencia: number;
};

/** Lee el libro auxiliar ya cargado para ese mes y deja guardado el
 * flujo: la validación del grupo de documentos y el movimiento por
 * subcuenta. Reemplaza lo que hubiera de ese mes. */
export async function calcularYGuardarMes(clienteId: number, anio: number, mes: number, userId: number): Promise<ResultadoCalculoMes> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const carga = await getCargaConArchivo(clienteId, anio, mes);
  if (!carga?.fileKey) {
    throw new Error("Ese mes no tiene el libro auxiliar guardado. Súbelo de nuevo en Estado de Resultados y vuelve a calcular.");
  }
  const { prefijos } = await getPrefijosEfectivo(clienteId);
  const buffer = await storageGetBuffer(carga.fileKey);
  const filas = await leerFilasXlsxRobusto(buffer, carga.fileKey);
  const r = calcularFlujoMes(filas, anio, mes, prefijos);

  const delPeriodo = and(eq(informesFlujoMovimientos.clienteId, clienteId), eq(informesFlujoMovimientos.anio, anio), eq(informesFlujoMovimientos.mes, mes));
  await db.delete(informesFlujoMovimientos).where(delPeriodo);
  const TAMANO_LOTE = 200;
  for (let i = 0; i < r.movimientos.length; i += TAMANO_LOTE) {
    await db.insert(informesFlujoMovimientos).values(
      r.movimientos.slice(i, i + TAMANO_LOTE).map(m => ({ clienteId, anio, mes, ...m, cuenta: m.cuenta.slice(0, 20), tipoDocumento: m.tipoDocumento.slice(0, 20) })),
    );
  }

  const datos = {
    fileKey: carga.fileKey, prefijosEfectivo: prefijos.join(","),
    documentos: r.documentos, lineas: r.lineas, lineasAuxiliar: r.lineasAuxiliar,
    totalDebitos: r.totalDebitos, totalCreditos: r.totalCreditos, descuadrados: r.descuadrados,
    observacionesJson: JSON.stringify(r.observaciones),
    cuentasDisponibleJson: JSON.stringify(r.cuentasDisponibles.slice(0, 200)),
    calculadoPorId: userId, calculadoAt: new Date(),
  };
  await db.insert(informesFlujoCalculos).values({ clienteId, anio, mes, ...datos }).onDuplicateKeyUpdate({ set: datos });

  await sembrarNombres(db, clienteId, r.nombres);
  return { mes, documentos: r.documentos, lineas: r.lineas, descuadrados: r.descuadrados, diferencia: redondear(r.totalDebitos - r.totalCreditos) };
}

/** Agrega al catálogo del cliente los nombres de cuenta que trae el
 * auxiliar y que todavía no estaban (el Estado de Resultados solo
 * siembra las cuentas 4, 5 y 6). Nunca cambia un nombre existente. */
async function sembrarNombres(db: Db, clienteId: number, nombres: Map<string, string>): Promise<void> {
  if (nombres.size === 0) return;
  const existentes = new Set((await db.select({ cuenta: informesCuentasCliente.cuenta }).from(informesCuentasCliente)
    .where(eq(informesCuentasCliente.clienteId, clienteId))).map(f => f.cuenta));
  const nuevos = Array.from(nombres.entries())
    .filter(([cuenta]) => cuenta.length <= 12 && !existentes.has(cuenta))
    .map(([cuenta, nombre]) => ({ clienteId, cuenta, nombre: nombre.slice(0, 255), origen: "archivo" as const }));
  for (let i = 0; i < nuevos.length; i += 200) {
    // Si otra carga la sembró al mismo tiempo, se deja la que ya quedó.
    await db.insert(informesCuentasCliente).values(nuevos.slice(i, i + 200)).onDuplicateKeyUpdate({ set: { clienteId } });
  }
}

// ---------------------------------------------------------------------
// Saldos y secciones
// ---------------------------------------------------------------------

export async function guardarSaldos(
  clienteId: number, anio: number, mes: number,
  saldos: { cuenta: string; saldoInicial: number | null; saldoFinal: number | null }[], userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  for (const s of saldos) {
    const cuenta = s.cuenta.replace(/\D/g, "").slice(0, 20);
    if (!cuenta) continue;
    const donde = and(
      eq(informesFlujoSaldos.clienteId, clienteId), eq(informesFlujoSaldos.anio, anio),
      eq(informesFlujoSaldos.mes, mes), eq(informesFlujoSaldos.cuenta, cuenta),
    );
    // Los dos en blanco = "sin digitar": no se deja una fila vacía.
    if (s.saldoInicial === null && s.saldoFinal === null) { await db.delete(informesFlujoSaldos).where(donde); continue; }
    const datos = { saldoInicial: s.saldoInicial, saldoFinal: s.saldoFinal, actualizadoPorId: userId };
    await db.insert(informesFlujoSaldos).values({ clienteId, anio, mes, cuenta, ...datos }).onDuplicateKeyUpdate({ set: datos });
  }
}

/** Cambia la sección y/o el nombre con que una cuenta sale en el flujo de
 * este cliente. Con los dos en null, la cuenta vuelve a la regla general. */
export async function guardarAjusteCuenta(
  clienteId: number, cuenta: string, ajuste: { seccion: SeccionFlujo | null; nombre: string | null }, userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const codigo = cuenta.replace(/\D/g, "").slice(0, 4);
  if (codigo.length < 4) throw new Error("La cuenta debe tener 4 dígitos.");
  const nombre = ajuste.nombre?.trim() ? ajuste.nombre.trim().slice(0, 255) : null;
  // Guardar la misma sección de la regla general es lo mismo que no ajustar.
  const seccion = ajuste.seccion && ajuste.seccion !== seccionPorDefecto(codigo) ? ajuste.seccion : null;
  const donde = and(eq(informesFlujoSecciones.clienteId, clienteId), eq(informesFlujoSecciones.cuenta, codigo));
  if (!seccion && !nombre) { await db.delete(informesFlujoSecciones).where(donde); return; }
  const datos = { seccion, nombre, actualizadoPorId: userId };
  await db.insert(informesFlujoSecciones).values({ clienteId, cuenta: codigo, ...datos }).onDuplicateKeyUpdate({ set: datos });
}

// ---------------------------------------------------------------------
// Informe comparativo del año
// ---------------------------------------------------------------------

export type EstadoMesFlujo = {
  mes: number;
  /** Hay libro auxiliar cargado para el mes, y con el archivo guardado. */
  cargado: boolean; conArchivo: boolean;
  calculado: boolean;
  /** El cálculo se hizo con otro archivo o con otras cuentas de efectivo. */
  desactualizado: boolean; motivo: string | null;
  documentos: number; lineas: number; lineasAuxiliar: number;
  totalDebitos: number; totalCreditos: number; descuadrados: number;
  /** Variación de las cuentas de efectivo (débitos − créditos) y suma de
   * las contrapartidas (créditos − débitos): deben ser iguales. */
  variacionEfectivo: number; sumaContrapartidas: number;
};

export type FilaFlujo = {
  cuenta: string; nombre: string; seccion: SeccionFlujo;
  /** true si la sección o el nombre los ajustó el contador para este cliente. */
  ajustada: boolean; nombreAjustado: boolean;
  /** Valor por mes, ya con el signo con que se lee en el flujo (recaudos
   * positivos si entra plata; egresos positivos si sale). */
  valores: Record<number, number>;
  /** Neto contable (créditos − débitos) por mes, sin cambio de signo. */
  netos: Record<number, number>;
  debitos: number; creditos: number;
  total: number; observacion: string;
};

export type CuentaEfectivoMes = {
  debitos: number; creditos: number; variacion: number; lineas: number;
  saldoInicial: number | null; saldoFinal: number | null;
  /** El saldo final del mes anterior, para proponerlo como inicial. */
  sugeridoInicial: number | null;
  finalCalculado: number | null; diferencia: number | null;
  /** Entra en la conciliación del mes: tuvo movimiento o tiene saldo digitado. */
  requerida: boolean;
};

export type ResumenMesFlujo = {
  recaudos: number; egresos: number; operativo: number; inversion: number; financiacion: number; aumentoNeto: number;
  /** null mientras falte digitar algún saldo de las cuentas del mes. */
  saldoInicial: number | null; finalCalculado: number | null; saldoFinal: number | null; variacion: number | null;
  saldosCompletos: boolean; cuentasSinSaldo: number;
};

export type InformeFlujo = {
  anio: number;
  prefijos: string[]; prefijosPorDefecto: boolean;
  /** Meses con auxiliar cargado o con flujo calculado. */
  estados: EstadoMesFlujo[];
  /** Meses que entran al informe (los ya calculados). */
  meses: number[];
  secciones: { seccion: SeccionFlujo; titulo: string; filas: FilaFlujo[]; totales: Record<number, number>; total: number }[];
  sinEfecto: { codigo: string; cuenta: string; nombre: string; valores: Record<number, number>; total: number }[];
  efectivo: { cuenta: string; nombre: string; grupo: string; porMes: Record<number, CuentaEfectivoMes> }[];
  resumen: Record<number, ResumenMesFlujo>;
  acumulado: ResumenMesFlujo;
  /** Cuentas del grupo 11 vistas en los auxiliares, para configurar el efectivo. */
  cuentasDisponibles: { cuenta: string; nombre: string | null; esEfectivo: boolean }[];
};

/** "$12,0 M" para millones, "$630" para valores pequeños — el mismo
 * estilo de las observaciones del libro modelo. */
export function pesosCortos(valor: number): string {
  const v = Math.abs(valor);
  const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (v >= 1_000_000) {
    const [entero, decimal] = (v / 1_000_000).toFixed(1).split(".");
    return `$${miles(Number(entero))},${decimal} M`;
  }
  return `$${miles(Math.round(v))}`;
}

/** Observación automática de un renglón, sin IA: los terceros que más
 * pesan en la cuenta. Si uno solo explica la mayor parte, se dice
 * "Principalmente…"; si no, se listan hasta tres. */
export function redactarObservacion(terceros: { nombre: string; neto: number }[], netoCuenta: number): string {
  const lista = terceros.filter(t => t.nombre.trim() && Math.abs(t.neto) >= 1).sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));
  if (lista.length === 0) return "";
  const etiqueta = (t: { nombre: string; neto: number }) => {
    const limpio = t.nombre.replace(/\s+/g, " ").trim();
    const nombre = /^\d[\d.\-]*$/.test(limpio) ? `NIT ${limpio}` : limpio.length > 45 ? `${limpio.slice(0, 44).trimEnd()}…` : limpio;
    return `${nombre} (${pesosCortos(t.neto)})`;
  };
  const base = Math.abs(netoCuenta);
  if (lista.length === 1) return etiqueta(lista[0]);
  if (base > 0 && Math.abs(lista[0].neto) >= base * 0.6) return `Principalmente ${etiqueta(lista[0])}`;
  const primeros = lista.slice(0, 3).map(etiqueta);
  return primeros.length === 2 ? primeros.join(" y ") : `${primeros.slice(0, -1).join(", ")} y ${primeros[primeros.length - 1]}`;
}

export async function armarInformeFlujo(clienteId: number, anio: number): Promise<InformeFlujo> {
  const db = await getDb();
  const { prefijos, porDefecto } = await getPrefijosEfectivo(clienteId);
  const vacio: ResumenMesFlujo = {
    recaudos: 0, egresos: 0, operativo: 0, inversion: 0, financiacion: 0, aumentoNeto: 0,
    saldoInicial: null, finalCalculado: null, saldoFinal: null, variacion: null, saldosCompletos: false, cuentasSinSaldo: 0,
  };
  const informe: InformeFlujo = {
    anio, prefijos, prefijosPorDefecto: porDefecto, estados: [], meses: [], secciones: [], sinEfecto: [], efectivo: [],
    resumen: {}, acumulado: { ...vacio }, cuentasDisponibles: [],
  };
  if (!db) return informe;

  const [cargas, calculos, movimientos, saldos, ajustes, catalogo, puc] = await Promise.all([
    listarCargas(clienteId, anio),
    db.select().from(informesFlujoCalculos).where(and(eq(informesFlujoCalculos.clienteId, clienteId), eq(informesFlujoCalculos.anio, anio))),
    db.select().from(informesFlujoMovimientos).where(and(eq(informesFlujoMovimientos.clienteId, clienteId), eq(informesFlujoMovimientos.anio, anio))),
    // Los saldos del año y los de diciembre del anterior (para proponer el inicial de enero).
    db.select().from(informesFlujoSaldos).where(and(
      eq(informesFlujoSaldos.clienteId, clienteId),
      or(eq(informesFlujoSaldos.anio, anio), and(eq(informesFlujoSaldos.anio, anio - 1), eq(informesFlujoSaldos.mes, 12))),
    )),
    db.select().from(informesFlujoSecciones).where(eq(informesFlujoSecciones.clienteId, clienteId)),
    getCatalogoCliente(clienteId),
    getCuentasPucConocidas(),
  ]);

  const prefijosTexto = prefijos.join(",");
  const calculoDeMes = new Map(calculos.map(c => [c.mes, c]));
  const cargaDeMes = new Map<number, (typeof cargas)[number]>();
  for (const c of cargas) {
    if (c.estado !== "completado") continue;
    const actual = cargaDeMes.get(c.mes);
    // Si hay varias, manda la que tiene archivo (y entre esas, la más reciente).
    if (!actual || (!actual.fileKey && c.fileKey) || (!!c.fileKey === !!actual.fileKey && c.createdAt > actual.createdAt)) cargaDeMes.set(c.mes, c);
  }

  const mesesVistos = Array.from(new Set([...Array.from(cargaDeMes.keys()), ...Array.from(calculoDeMes.keys())])).sort((a, b) => a - b);
  informe.meses = Array.from(calculoDeMes.keys()).sort((a, b) => a - b);
  const meses = informe.meses;

  // ---- Movimiento por clase ----
  const neto = (m: { debitos: number; creditos: number }) => m.creditos - m.debitos;
  const variacionEfectivo: Record<number, number> = {};
  const sumaContrapartidas: Record<number, number> = {};
  type Acum = { netos: Record<number, number>; debitos: number; creditos: number };
  const contrapartidas = new Map<string, Acum>();
  const sinEfecto = new Map<string, Acum>();
  const efectivo = new Map<string, Record<number, { debitos: number; creditos: number; lineas: number }>>();
  for (const m of movimientos) {
    if (m.clase === "efectivo") {
      variacionEfectivo[m.mes] = (variacionEfectivo[m.mes] || 0) + m.debitos - m.creditos;
      const porMes = efectivo.get(m.cuenta) || {};
      const previo = porMes[m.mes] || { debitos: 0, creditos: 0, lineas: 0 };
      porMes[m.mes] = { debitos: previo.debitos + m.debitos, creditos: previo.creditos + m.creditos, lineas: previo.lineas + m.lineas };
      efectivo.set(m.cuenta, porMes);
      continue;
    }
    sumaContrapartidas[m.mes] = (sumaContrapartidas[m.mes] || 0) + neto(m);
    const mapa = m.clase === "sin_efecto" ? sinEfecto : contrapartidas;
    const cuenta4 = m.cuenta.slice(0, 4);
    const acum = mapa.get(cuenta4) || { netos: {}, debitos: 0, creditos: 0 };
    acum.netos[m.mes] = (acum.netos[m.mes] || 0) + neto(m);
    acum.debitos += m.debitos; acum.creditos += m.creditos;
    mapa.set(cuenta4, acum);
  }

  // ---- Estado de cada mes ----
  informe.estados = mesesVistos.map(mes => {
    const carga = cargaDeMes.get(mes);
    const calc = calculoDeMes.get(mes);
    const motivo = !calc ? null
      : carga?.fileKey && carga.fileKey !== calc.fileKey ? "Se volvió a subir el libro auxiliar de este mes."
      : calc.prefijosEfectivo !== prefijosTexto ? "Cambiaron las cuentas de efectivo."
      : null;
    return {
      mes, cargado: !!carga, conArchivo: !!carga?.fileKey, calculado: !!calc, desactualizado: !!motivo, motivo,
      documentos: calc?.documentos || 0, lineas: calc?.lineas || 0, lineasAuxiliar: calc?.lineasAuxiliar || 0,
      totalDebitos: calc?.totalDebitos || 0, totalCreditos: calc?.totalCreditos || 0, descuadrados: calc?.descuadrados || 0,
      variacionEfectivo: redondear(variacionEfectivo[mes] || 0), sumaContrapartidas: redondear(sumaContrapartidas[mes] || 0),
    };
  });

  // ---- Nombres ----
  const ajusteDe = new Map(ajustes.map(a => [a.cuenta, a]));
  const primerSubcuenta = (codigo: string) => {
    for (const [cuenta, nombre] of Array.from(catalogo.entries())) if (cuenta.startsWith(codigo)) return nombre;
    return "";
  };
  const nombreCuenta4 = (codigo: string): string =>
    ajusteDe.get(codigo)?.nombre || catalogo.get(codigo) || NOMBRES_PUC[codigo] || primerSubcuenta(codigo) || puc.get(codigo)?.descripcion || "";

  // ---- Observaciones: terceros de mayor valor, sumando los meses ----
  const terceros = new Map<string, Map<string, number>>();
  for (const c of calculos) {
    let porCuenta: Record<string, { nombre: string; neto: number }[]> = {};
    try { porCuenta = JSON.parse(c.observacionesJson || "{}"); } catch { /* sin observaciones */ }
    for (const [cuenta4, lista] of Object.entries(porCuenta)) {
      const mapa = terceros.get(cuenta4) || new Map<string, number>();
      for (const t of lista) mapa.set(t.nombre, (mapa.get(t.nombre) || 0) + t.neto);
      terceros.set(cuenta4, mapa);
    }
  }

  // ---- Secciones ----
  const totalDe = (valores: Record<number, number>) => redondear(meses.reduce((s, m) => s + (valores[m] || 0), 0));
  const filas: FilaFlujo[] = Array.from(contrapartidas.entries()).map(([cuenta, acum]) => {
    const ajuste = ajusteDe.get(cuenta);
    const seccion = (ajuste?.seccion as SeccionFlujo | null) || seccionPorDefecto(cuenta);
    const signo = seccion === "recaudos" ? 1 : -1;
    const netos: Record<number, number> = {};
    const valores: Record<number, number> = {};
    for (const m of meses) { netos[m] = redondear(acum.netos[m] || 0); valores[m] = redondear(signo * (acum.netos[m] || 0)); }
    const netoTotal = totalDe(netos);
    return {
      cuenta, nombre: nombreCuenta4(cuenta), seccion, ajustada: !!ajuste?.seccion, nombreAjustado: !!ajuste?.nombre,
      valores, netos, debitos: redondear(acum.debitos), creditos: redondear(acum.creditos), total: totalDe(valores),
      observacion: redactarObservacion(Array.from(terceros.get(cuenta)?.entries() || []).map(([nombre, n]) => ({ nombre, neto: n })), netoTotal),
    };
  }).sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  informe.secciones = SECCIONES_FLUJO.map(seccion => {
    const delaSeccion = filas.filter(f => f.seccion === seccion);
    const totales: Record<number, number> = {};
    for (const m of meses) totales[m] = redondear(delaSeccion.reduce((s, f) => s + f.valores[m], 0));
    return { seccion, titulo: TITULO_SECCION[seccion], filas: delaSeccion, totales, total: totalDe(totales) };
  });

  informe.sinEfecto = Array.from(sinEfecto.entries()).map(([cuenta, acum]) => {
    const valores: Record<number, number> = {};
    for (const m of meses) valores[m] = redondear(acum.netos[m] || 0);
    const base = nombreCuenta4(cuenta);
    return {
      codigo: `${cuenta}-NM`, cuenta,
      nombre: cuenta.startsWith("14") ? `Inventario: salida por costo de venta${base ? ` (${base})` : ""}` : `Costo de ventas registrado en la factura${base ? ` (${base})` : ""}`,
      valores, total: totalDe(valores),
    };
  }).sort((a, b) => a.codigo.localeCompare(b.codigo));

  // ---- Cuentas de efectivo y saldos ----
  const saldoDe = new Map<string, (typeof saldos)[number]>();
  for (const s of saldos) saldoDe.set(`${s.anio}|${s.mes}|${s.cuenta}`, s);
  const cuentasEfectivo = Array.from(new Set([...Array.from(efectivo.keys()), ...saldos.filter(s => s.anio === anio).map(s => s.cuenta)])).sort();
  informe.efectivo = cuentasEfectivo.map(cuenta => {
    const porMes: Record<number, CuentaEfectivoMes> = {};
    for (const m of meses) {
      const mov = efectivo.get(cuenta)?.[m];
      const saldo = saldoDe.get(`${anio}|${m}|${cuenta}`);
      const anterior = m === 1 ? saldoDe.get(`${anio - 1}|12|${cuenta}`) : saldoDe.get(`${anio}|${m - 1}|${cuenta}`);
      const variacion = redondear((mov?.debitos || 0) - (mov?.creditos || 0));
      const saldoInicial = saldo?.saldoInicial ?? null;
      const saldoFinal = saldo?.saldoFinal ?? null;
      const finalCalculado = saldoInicial === null ? null : redondear(saldoInicial + variacion);
      porMes[m] = {
        debitos: redondear(mov?.debitos || 0), creditos: redondear(mov?.creditos || 0), variacion, lineas: mov?.lineas || 0,
        saldoInicial, saldoFinal, sugeridoInicial: anterior?.saldoFinal ?? null,
        finalCalculado, diferencia: finalCalculado === null || saldoFinal === null ? null : redondear(finalCalculado - saldoFinal),
        requerida: !!mov || !!saldo,
      };
    }
    return { cuenta, nombre: catalogo.get(cuenta) || NOMBRES_PUC[cuenta.slice(0, 4)] || "", grupo: cuenta.slice(0, 4), porMes };
  });

  // ---- Resumen por mes y acumulado ----
  const seccionTotal = (s: SeccionFlujo, m: number) => informe.secciones.find(x => x.seccion === s)!.totales[m] || 0;
  for (const m of meses) {
    const recaudos = seccionTotal("recaudos", m);
    const egresos = seccionTotal("egresos_operacion", m);
    const inversion = seccionTotal("inversion", m);
    const financiacion = seccionTotal("financiacion", m);
    const operativo = redondear(recaudos - egresos);
    const aumentoNeto = redondear(operativo - inversion - financiacion);
    const requeridas = informe.efectivo.map(e => e.porMes[m]).filter(c => c.requerida);
    const cuentasSinSaldo = requeridas.filter(c => c.saldoInicial === null || c.saldoFinal === null).length;
    const saldosCompletos = requeridas.length > 0 && cuentasSinSaldo === 0;
    const saldoInicial = saldosCompletos ? redondear(requeridas.reduce((s, c) => s + c.saldoInicial!, 0)) : null;
    const saldoFinal = saldosCompletos ? redondear(requeridas.reduce((s, c) => s + c.saldoFinal!, 0)) : null;
    const finalCalculado = saldoInicial === null ? null : redondear(saldoInicial + aumentoNeto);
    informe.resumen[m] = {
      recaudos, egresos, operativo, inversion, financiacion, aumentoNeto, saldoInicial, finalCalculado, saldoFinal,
      variacion: finalCalculado === null || saldoFinal === null ? null : redondear(finalCalculado - saldoFinal),
      saldosCompletos, cuentasSinSaldo,
    };
  }
  if (meses.length > 0) {
    const suma = (campo: "recaudos" | "egresos" | "operativo" | "inversion" | "financiacion" | "aumentoNeto") =>
      redondear(meses.reduce((s, m) => s + informe.resumen[m][campo], 0));
    const todosCompletos = meses.every(m => informe.resumen[m].saldosCompletos);
    // El acumulado solo se concilia si los meses van seguidos: inicial del
    // primero, final del último.
    const seguidos = meses.every((m, i) => i === 0 || m === meses[i - 1] + 1);
    const saldoInicial = todosCompletos && seguidos ? informe.resumen[meses[0]].saldoInicial : null;
    const saldoFinal = todosCompletos && seguidos ? informe.resumen[meses[meses.length - 1]].saldoFinal : null;
    const aumentoNeto = suma("aumentoNeto");
    const finalCalculado = saldoInicial === null ? null : redondear(saldoInicial + aumentoNeto);
    informe.acumulado = {
      recaudos: suma("recaudos"), egresos: suma("egresos"), operativo: suma("operativo"), inversion: suma("inversion"),
      financiacion: suma("financiacion"), aumentoNeto, saldoInicial, finalCalculado, saldoFinal,
      variacion: finalCalculado === null || saldoFinal === null ? null : redondear(finalCalculado - saldoFinal),
      saldosCompletos: todosCompletos && seguidos, cuentasSinSaldo: meses.reduce((s, m) => s + informe.resumen[m].cuentasSinSaldo, 0),
    };
  }

  // ---- Cuentas del grupo 11 vistas en los auxiliares ----
  const disponibles = new Map<string, string | null>();
  for (const c of calculos) {
    try {
      for (const d of JSON.parse(c.cuentasDisponibleJson || "[]") as { cuenta: string; nombre: string | null }[]) {
        if (!disponibles.get(d.cuenta)) disponibles.set(d.cuenta, d.nombre || catalogo.get(d.cuenta) || null);
      }
    } catch { /* sin lista */ }
  }
  informe.cuentasDisponibles = Array.from(disponibles.entries())
    .map(([cuenta, nombre]) => ({ cuenta, nombre, esEfectivo: prefijos.some(p => cuenta.startsWith(p)) }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  return informe;
}

/** Detalle por subcuenta y tipo de comprobante de los meses calculados
 * (para la hoja de detalle del Excel). */
export async function listarDetalleFlujo(clienteId: number, anio: number, meses: number[]) {
  const db = await getDb();
  if (!db || meses.length === 0) return [];
  return db.select().from(informesFlujoMovimientos).where(and(
    eq(informesFlujoMovimientos.clienteId, clienteId), eq(informesFlujoMovimientos.anio, anio),
    inArray(informesFlujoMovimientos.mes, meses),
  ));
}
