import { NOMBRES_PUC } from "./informesFlujoPuc";

/** INFORME DE GESTIÓN — todas las cifras y los textos automáticos del
 * informe, a partir del estado de resultados por mes (y por centro de
 * costo, cuando el cliente los maneja). Sin base de datos ni PDF: recibe
 * los saldos ya cargados y devuelve la estructura que después se dibuja.
 *
 * Nada aquí es opinión: cada frase sale de una regla sobre las cifras
 * (crecimientos, márgenes, meses y cuentas que se salen del patrón). Lo
 * que requiere criterio — puntos tributarios y plan de acción — lo
 * escribe el contador y llega como notas. */

export type SaldoGestion = { mes: number; centroCodigo: string; cuenta: string; tipo: "ingreso" | "costo" | "gasto" | "descuento_pp"; valor: number };
type Serie = Record<number, number>;

export const MESES_NOMBRE = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MESES_ABREV = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const CLAVES = [
  "ventasNetas", "otrosIngresos", "totalIngresos", "costoBruto", "descuentos", "costoNeto", "utilidadBruta",
  "gastosAdmin", "gastosVentas", "otrosGastos", "totalGastos", "utilidadOperativa", "impuestoRenta", "resultado",
] as const;
export type ClaveER = typeof CLAVES[number];
export type EstadoResultados = Record<ClaveER, Serie>;

const redondear = (n: number) => Math.round(n * 100) / 100;
const sumaSerie = (s: Serie, meses: number[]) => meses.reduce((t, m) => t + (s[m] || 0), 0);
const promedio = (valores: number[]) => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0);

/** Estado de resultados por mes de un conjunto de saldos. Mismas reglas
 * del Estado de Resultados Mensual: ingresos (4), costo bruto (6 y 7),
 * descuento por pronto pago aparte, gastos (5). */
export function estadoResultados(saldos: SaldoGestion[], meses: number[]): EstadoResultados {
  const er = Object.fromEntries(CLAVES.map(c => [c, Object.fromEntries(meses.map(m => [m, 0]))])) as EstadoResultados;
  for (const s of saldos) {
    if (er.ventasNetas[s.mes] === undefined) continue;
    const clave: ClaveER =
      s.tipo === "ingreso" ? (s.cuenta.startsWith("41") ? "ventasNetas" : "otrosIngresos")
      : s.tipo === "costo" ? "costoBruto"
      : s.tipo === "descuento_pp" ? "descuentos"
      : s.cuenta.startsWith("51") ? "gastosAdmin"
      : s.cuenta.startsWith("52") ? "gastosVentas"
      : s.cuenta.startsWith("54") ? "impuestoRenta" : "otrosGastos";
    er[clave][s.mes] += s.valor;
  }
  for (const m of meses) {
    er.totalIngresos[m] = er.ventasNetas[m] + er.otrosIngresos[m];
    er.costoNeto[m] = er.costoBruto[m] - er.descuentos[m];
    er.utilidadBruta[m] = er.totalIngresos[m] - er.costoNeto[m];
    er.totalGastos[m] = er.gastosAdmin[m] + er.gastosVentas[m] + er.otrosGastos[m];
    er.utilidadOperativa[m] = er.utilidadBruta[m] - er.totalGastos[m];
    er.resultado[m] = er.utilidadOperativa[m] - er.impuestoRenta[m];
  }
  return er;
}

// ---------------------------------------------------------------------
// Formato (lo usan los textos automáticos y el PDF)
// ---------------------------------------------------------------------

const miles = (entero: string) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** Millones con un decimal: 15135700000 → "15.135,7". */
export function millones(valor: number, decimales = 1): string {
  const [entero, decimal] = Math.abs(valor / 1_000_000).toFixed(decimales).split(".");
  const texto = `${miles(entero)}${decimal ? `,${decimal}` : ""}`;
  return valor < 0 && Number(texto.replace(/[.,]/g, "")) !== 0 ? `-${texto}` : texto;
}
/** "$1.034,6 M" / "-$22,8 M". */
export const pesosM = (valor: number) => { const t = millones(valor); return t.startsWith("-") ? `-$${t.slice(1)} M` : `$${t} M`; };
/** Fracción → "40,3%". */
export function porcentaje(fraccion: number, decimales = 1): string {
  if (!Number.isFinite(fraccion)) return "—";
  const t = (Math.abs(fraccion) * 100).toFixed(decimales).replace(".", ",");
  return `${fraccion < 0 && Number(t.replace(",", "")) !== 0 ? "-" : ""}${t}%`;
}
const conSigno = (texto: string) => (texto.startsWith("-") ? texto : `+${texto}`);
const division = (a: number, b: number) => (Math.abs(b) < 0.005 ? NaN : a / b);

// ---------------------------------------------------------------------
// Estructura del informe
// ---------------------------------------------------------------------

export type NivelAlerta = "critico" | "revisar" | "vigilar";
export type Alerta = { nivel: NivelAlerta; periodo: string; partida: string; detalle: string };
export type NotaTributaria = { nivel: NivelAlerta; titulo: string; texto: string };
export type AccionPlan = { titulo: string; texto: string };

export type CentroGestion = {
  codigo: string; nombre: string;
  /** Vende: es un punto de venta. Si no, es un centro administrativo. */
  esPuntoDeVenta: boolean;
  /** Empezó a vender después del primer mes del informe. */
  esApertura: boolean;
  primerMes: number | null; mesesOperacion: number;
  ingresos: number; margenBruto: number; gastos: number;
  /** Utilidad operativa propia (antes de repartir la administración). */
  utilidadPropia: number; utilidadPorMes: Record<number, number | null>;
  /** Parte del centro administrativo que le corresponde, según sus ingresos. */
  administracion: number;
  /** Utilidad después de repartir la administración. */
  resultado: number;
  ingresosMes: number; gastosMes: number;
  equilibrioPropio: number | null; equilibrioConAdmin: number | null; margenSeguridad: number | null;
  estado: "cubre" | "ajustado" | "no_cubre" | null;
};

export type BalanceGestion = {
  etiquetaInicial: string; etiquetaFinal: string;
  filas: { titulo: string; inicial: number; final: number; total: boolean }[];
};

export type InformeGestion = {
  anio: number; meses: number[]; mesCorte: number;
  /** "enero–agosto 2026" (o "agosto 2026" si solo hay un mes). */
  periodo: string;
  er: EstadoResultados; acumulado: Record<ClaveER, number>;
  indicadores: { titulo: string; valor: string; detalle: string; tono: "bueno" | "malo" | "neutro" }[];
  resumen: { titulo: string; texto: string }[];
  titularVision: string; textoVision: string;
  margenBrutoPorMes: Serie;
  equilibrio: {
    ingresosPromedio: number; margenBruto: number; gastosPromedio: number;
    punto: number | null; margenSeguridad: number | null; porMes: Record<number, number | null>;
  };
  centros: CentroGestion[]; hayCentros: boolean;
  aperturas: {
    hay: boolean; puntosPorMes: Serie;
    ventasExistentes: Serie; ventasAperturas: Serie; gastosExistentes: Serie; gastosAperturas: Serie; gastosAdministracion: Serie;
    margenExistentes: Serie; resultadoAperturas: Serie; texto: string;
  };
  textoCentros: string;
  gastos: {
    texto: string;
    grupos: { cuenta: string; nombre: string; valor: number }[];
    crecen: { cuenta: string; nombre: string; inicial: number; final: number; cambio: number; acumulado: number }[];
  };
  alertas: Alerta[];
  balance: BalanceGestion | null;
  notas: { puntos: NotaTributaria[]; plan: AccionPlan[] };
};

export type EntradaGestion = {
  anio: number; mesCorte: number; saldos: SaldoGestion[];
  /** código de centro → nombre. */
  centros: Map<string, string>;
  /** cuenta → nombre (catálogo propio del cliente). */
  catalogo: Map<string, string>;
  balance: BalanceGestion | null;
  /** Diferencia del balance al corte (activo − pasivo − patrimonio) y
   * cuentas de efectivo con saldo negativo, para las alertas. */
  balanceDiferencia: number | null; efectivoNegativo: { cuenta: string; nombre: string; saldo: number }[];
  notas: { puntos: NotaTributaria[]; plan: AccionPlan[] };
};

const MATERIALIDAD_GASTO = 0.003; // 0,3 % de los ingresos de un mes

export function calcularInformeGestion(entrada: EntradaGestion): InformeGestion {
  const { anio, mesCorte } = entrada;
  const saldos = entrada.saldos.filter(s => s.mes <= mesCorte);
  const meses = Array.from(new Set(saldos.map(s => s.mes))).sort((a, b) => a - b);
  if (meses.length === 0) throw new Error("No hay estado de resultados cargado hasta ese mes.");
  const primero = meses[0], ultimo = meses[meses.length - 1];
  const er = estadoResultados(saldos, meses);
  const acumulado = Object.fromEntries(CLAVES.map(c => [c, redondear(sumaSerie(er[c], meses))])) as Record<ClaveER, number>;
  const periodo = meses.length === 1 ? `${MESES_NOMBRE[ultimo]} ${anio}` : `${MESES_NOMBRE[primero]}–${MESES_NOMBRE[ultimo]} ${anio}`;
  const nMes = (m: number) => MESES_NOMBRE[m];
  const varios = meses.length > 1;

  const margenBrutoPorMes: Serie = {};
  for (const m of meses) margenBrutoPorMes[m] = division(er.utilidadBruta[m], er.totalIngresos[m]);
  const margenAcum = division(acumulado.utilidadBruta, acumulado.totalIngresos);
  const anteriores = meses.slice(0, -1);
  const margenAnteriores = division(sumaSerie(er.utilidadBruta, anteriores), sumaSerie(er.totalIngresos, anteriores));

  // ---------------- Punto de equilibrio (todos los gastos como fijos) ----------------
  const ingresosPromedio = acumulado.totalIngresos / meses.length;
  const gastosPromedio = acumulado.totalGastos / meses.length;
  const punto = margenAcum > 0 ? gastosPromedio / margenAcum : null;
  const equilibrioPorMes: Record<number, number | null> = {};
  for (const m of meses) equilibrioPorMes[m] = margenBrutoPorMes[m] > 0 ? er.totalGastos[m] / margenBrutoPorMes[m] : null;
  const equilibrio = {
    ingresosPromedio, margenBruto: margenAcum, gastosPromedio, punto,
    margenSeguridad: punto === null ? null : division(ingresosPromedio - punto, ingresosPromedio), porMes: equilibrioPorMes,
  };

  // ---------------- Centros de costo ----------------
  const codigos = Array.from(new Set(saldos.map(s => s.centroCodigo))).sort();
  const hayCentros = codigos.length > 1;
  const porCentro = new Map<string, SaldoGestion[]>();
  for (const s of saldos) { if (!porCentro.has(s.centroCodigo)) porCentro.set(s.centroCodigo, []); porCentro.get(s.centroCodigo)!.push(s); }
  const erCentro = new Map(codigos.map(c => [c, estadoResultados(porCentro.get(c)!, meses)]));
  const esPunto = (c: string) => sumaSerie(erCentro.get(c)!.ventasNetas, meses) > 0;
  const puntos = codigos.filter(esPunto);
  const administrativos = codigos.filter(c => !esPunto(c));
  // Lo que cuestan los centros que no venden, para repartirlo entre los que sí.
  const administracionNeta = -administrativos.reduce((t, c) => t + sumaSerie(erCentro.get(c)!.utilidadOperativa, meses), 0);
  const ingresosPuntos = puntos.reduce((t, c) => t + sumaSerie(erCentro.get(c)!.totalIngresos, meses), 0);

  const centros: CentroGestion[] = !hayCentros ? [] : codigos.map(codigo => {
    const e = erCentro.get(codigo)!;
    const punto_ = esPunto(codigo);
    const conVentas = meses.filter(m => Math.abs(e.ventasNetas[m]) > 0.005);
    const primerMes = conVentas.length ? conVentas[0] : null;
    const enOperacion = punto_ ? meses.filter(m => m >= (primerMes as number)) : meses;
    const ingresos = sumaSerie(e.totalIngresos, meses);
    const utilidadBruta = sumaSerie(e.utilidadBruta, meses);
    const gastos = sumaSerie(e.totalGastos, meses);
    const utilidadPropia = sumaSerie(e.utilidadOperativa, meses);
    const margenBruto = division(utilidadBruta, ingresos);
    const administracion = punto_ && ingresosPuntos > 0 ? administracionNeta * (ingresos / ingresosPuntos) : 0;
    const n = Math.max(enOperacion.length, 1);
    const ingresosMes = ingresos / n, gastosMes = gastos / n;
    const equilibrioPropio = punto_ && margenBruto > 0 ? gastosMes / margenBruto : null;
    const equilibrioConAdmin = punto_ && margenBruto > 0 ? (gastosMes + administracion / n) / margenBruto : null;
    const margenSeguridad = equilibrioConAdmin === null ? null : division(ingresosMes - equilibrioConAdmin, ingresosMes);
    const utilidadPorMes: Record<number, number | null> = {};
    for (const m of meses) utilidadPorMes[m] = punto_ && primerMes !== null && m < primerMes ? null : redondear(e.utilidadOperativa[m]);
    const nombreCatalogo = entrada.centros.get(codigo);
    return {
      codigo, nombre: nombreCatalogo && nombreCatalogo !== codigo ? `${codigo} ${nombreCatalogo}` : codigo === "SC" ? "Sin centro de costo" : `Centro ${codigo}`,
      esPuntoDeVenta: punto_, esApertura: punto_ && primerMes !== null && primerMes > primero, primerMes, mesesOperacion: enOperacion.length,
      ingresos, margenBruto, gastos, utilidadPropia, utilidadPorMes, administracion, resultado: utilidadPropia - administracion,
      ingresosMes, gastosMes, equilibrioPropio, equilibrioConAdmin, margenSeguridad,
      estado: !punto_ ? null : margenSeguridad === null ? "no_cubre" : margenSeguridad >= 0.05 ? "cubre" : margenSeguridad >= 0 ? "ajustado" : "no_cubre",
    };
  });
  const puntosDeVenta = centros.filter(c => c.esPuntoDeVenta);
  const nuevos = puntosDeVenta.filter(c => c.esApertura);
  const existentes = puntosDeVenta.filter(c => !c.esApertura);

  // ---------------- Aperturas ----------------
  const serieDe = (lista: CentroGestion[], clave: ClaveER): Serie => {
    const s: Serie = {};
    for (const m of meses) s[m] = lista.reduce((t, c) => t + erCentro.get(c.codigo)![clave][m], 0);
    return s;
  };
  const adminLista = centros.filter(c => !c.esPuntoDeVenta);
  const ventasExistentes = serieDe(existentes, "ventasNetas"), ventasAperturas = serieDe(nuevos, "ventasNetas");
  const gastosExistentes = serieDe(existentes, "totalGastos"), gastosAperturas = serieDe(nuevos, "totalGastos");
  const gastosAdministracion = serieDe(adminLista, "totalGastos");
  const ubExistentes = serieDe(existentes, "utilidadBruta"), ingExistentes = serieDe(existentes, "totalIngresos");
  const margenExistentes: Serie = {}, puntosPorMes: Serie = {};
  for (const m of meses) {
    margenExistentes[m] = division(ubExistentes[m], ingExistentes[m]);
    puntosPorMes[m] = puntosDeVenta.filter(c => c.primerMes !== null && m >= c.primerMes).length;
  }
  const resultadoAperturas = serieDe(nuevos, "utilidadOperativa");
  const subeVentas = er.ventasNetas[ultimo] - er.ventasNetas[primero];
  const subeAperturas = ventasAperturas[ultimo] - ventasAperturas[primero];
  const textoAperturas = nuevos.length === 0 ? "" : [
    `Los puntos con ventas pasan de ${puntosPorMes[primero]} en ${nMes(primero)} a ${puntosPorMes[ultimo]} en ${nMes(ultimo)}: ` +
      `${nuevos.slice(0, 4).map(c => `${c.nombre} (${nMes(c.primerMes!)})`).join(", ")}${nuevos.length > 4 ? ` y ${nuevos.length - 4} más` : ""}.`,
    subeVentas > 0
      ? `De los ${pesosM(subeVentas)} que suben las ventas mensuales entre ${nMes(primero)} y ${nMes(ultimo)}, ${pesosM(subeAperturas)} (${porcentaje(division(subeAperturas, subeVentas), 0)}) vienen de las aperturas.`
      : `Las aperturas venden ${pesosM(ventasAperturas[ultimo])} en ${nMes(ultimo)}.`,
    `Las aperturas acumulan un resultado propio de ${pesosM(sumaSerie(resultadoAperturas, meses))} en el periodo.`,
  ].join(" ");

  const noCubren = puntosDeVenta.filter(c => c.estado === "no_cubre");
  const ordenados = [...puntosDeVenta].sort((a, b) => b.resultado - a.resultado);
  const positivos = ordenados.filter(c => c.resultado > 0);
  const totalPositivo = positivos.reduce((t, c) => t + c.resultado, 0);
  const textoCentros = !hayCentros || puntosDeVenta.length === 0 ? "" : [
    positivos.length >= 3
      ? `${positivos.slice(0, 3).map(c => c.nombre).join(", ")} aportan el ${porcentaje(division(positivos.slice(0, 3).reduce((t, c) => t + c.resultado, 0), totalPositivo), 0)} del resultado positivo después de repartir la administración.`
      : "",
    noCubren.length > 0
      ? `${noCubren.length} de ${puntosDeVenta.length} puntos de venta no cubren su punto de equilibrio con administración${nuevos.length ? ` (${noCubren.filter(c => c.esApertura).length} son aperturas del año)` : ""}.`
      : `Los ${puntosDeVenta.length} puntos de venta cubren su punto de equilibrio con administración.`,
  ].filter(Boolean).join(" ");

  // ---------------- Gastos ----------------
  /** Los catálogos suelen venir en mayúsculas sostenidas: se pasan a
   * mayúscula inicial, conservando las siglas. */
  const SIGLAS = new Set(["IVA", "ICA", "DIAN", "GMF", "ARL", "EPS", "AFP", "SENA", "ICBF", "NIIF", "CDT", "UVT", "SOAT", "RTE", "NIT", "POS", "PILA"]);
  const presentable = (nombre: string): string => {
    const limpio = nombre.trim().replace(/\s+/g, " ");
    if (!limpio || limpio !== limpio.toUpperCase()) return limpio;
    const minus = limpio.toLowerCase().split(" ").map(p => (SIGLAS.has(p.toUpperCase().replace(/[^A-ZÑ]/g, "")) ? p.toUpperCase() : p)).join(" ");
    return minus[0].toUpperCase() + minus.slice(1);
  };
  const nombreCuenta = (cuenta: string): string => {
    // Los grupos (4 dígitos) llevan el nombre del PUC, que distingue
    // administración de ventas: en el catálogo 5105 y 5205 se llaman igual.
    if (cuenta.length === 4 && NOMBRES_PUC[cuenta]) return NOMBRES_PUC[cuenta];
    const sufijo = cuenta.length === 4 ? (cuenta.startsWith("51") ? " (administración)" : cuenta.startsWith("52") ? " (ventas)" : "") : "";
    const exacto = entrada.catalogo.get(cuenta);
    if (exacto) return presentable(exacto) + sufijo;
    for (const [c, nombre] of Array.from(entrada.catalogo.entries())) if (c.startsWith(cuenta)) return presentable(nombre) + sufijo;
    return NOMBRES_PUC[cuenta.slice(0, 4)] || `Cuenta ${cuenta}`;
  };
  const gastoPorCuenta = new Map<string, Serie>(), gastoPorGrupo = new Map<string, Serie>();
  for (const s of saldos) {
    if (s.tipo !== "gasto" || s.cuenta.startsWith("54")) continue;
    for (const [mapa, clave] of [[gastoPorCuenta, s.cuenta], [gastoPorGrupo, s.cuenta.slice(0, 4)]] as const) {
      if (!mapa.has(clave)) mapa.set(clave, {});
      mapa.get(clave)![s.mes] = (mapa.get(clave)![s.mes] || 0) + s.valor;
    }
  }
  const gruposOrdenados = Array.from(gastoPorGrupo.entries())
    .map(([cuenta, serie]) => ({ cuenta, nombre: nombreCuenta(cuenta), valor: sumaSerie(serie, meses) }))
    .filter(g => g.valor > 0).sort((a, b) => b.valor - a.valor);
  const MAX_GRUPOS = 12;
  const grupos = gruposOrdenados.length <= MAX_GRUPOS ? gruposOrdenados : [
    ...gruposOrdenados.slice(0, MAX_GRUPOS - 1),
    { cuenta: "", nombre: `Otras ${gruposOrdenados.length - (MAX_GRUPOS - 1)} cuentas`, valor: gruposOrdenados.slice(MAX_GRUPOS - 1).reduce((t, g) => t + g.valor, 0) },
  ];
  const crecen = !varios ? [] : Array.from(gastoPorCuenta.entries())
    .map(([cuenta, serie]) => {
      const inicial = serie[primero] || 0, final = serie[ultimo] || 0;
      return { cuenta, nombre: nombreCuenta(cuenta), inicial, final, cambio: division(final - inicial, inicial), acumulado: sumaSerie(serie, meses) };
    })
    .filter(c => c.final - c.inicial > 0 && c.acumulado >= acumulado.totalGastos * 0.005)
    .sort((a, b) => (b.final - b.inicial) - (a.final - a.inicial)).slice(0, 7);
  const creceGastos = division(er.totalGastos[ultimo] - er.totalGastos[primero], er.totalGastos[primero]);
  const creceVentas = division(er.ventasNetas[ultimo] - er.ventasNetas[primero], er.ventasNetas[primero]);
  const textoGastos = [
    `Los gastos suman ${pesosM(acumulado.totalGastos)} (${porcentaje(division(acumulado.totalGastos, acumulado.totalIngresos))} de los ingresos)`,
    varios ? ` y pasan de ${pesosM(er.totalGastos[primero])} en ${nMes(primero)} a ${pesosM(er.totalGastos[ultimo])} en ${nMes(ultimo)} (${conSigno(porcentaje(creceGastos))}), frente a ventas que varían ${conSigno(porcentaje(creceVentas))}.` : ".",
    grupos.length > 0 ? ` La cuenta de mayor peso es ${grupos[0].nombre}, con ${pesosM(grupos[0].valor)} (${porcentaje(division(grupos[0].valor, acumulado.totalGastos), 0)} del gasto).` : "",
  ].join("");

  // ---------------- Variaciones atípicas ----------------
  const alertas: Alerta[] = [];
  const abrev = (m: number) => MESES_ABREV[m];
  const enLista = (partes: string[]) => (partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`);
  const perdidas = meses.filter(m => er.resultado[m] < 0);
  if (perdidas.length === 1) {
    const m = perdidas[0];
    alertas.push({
      nivel: "critico", periodo: abrev(m), partida: "Pérdida del mes",
      detalle: `Resultado de ${pesosM(er.resultado[m])} con ingresos de ${pesosM(er.totalIngresos[m])} y margen bruto de ${porcentaje(margenBrutoPorMes[m])}.`,
    });
  } else if (perdidas.length > 1) {
    // Varios meses en pérdida van en una sola fila, no una por mes.
    alertas.push({
      nivel: "critico", periodo: perdidas.length <= 3 ? perdidas.map(abrev).join(", ") : `${perdidas.length} meses`,
      partida: `Pérdida en ${perdidas.length} de ${meses.length} meses`,
      detalle: `${enLista(perdidas.map(m => `${nMes(m)} ${pesosM(er.resultado[m])}`))}. Entre todos suman ${pesosM(perdidas.reduce((t, m) => t + er.resultado[m], 0))}.`,
    });
  }
  if (meses.length >= 3) {
    for (const m of meses) {
      const otros = meses.filter(x => x !== m);
      const referencia = division(sumaSerie(er.utilidadBruta, otros), sumaSerie(er.totalIngresos, otros));
      const caida = (margenBrutoPorMes[m] - referencia) * 100;
      if (caida <= -3) alertas.push({
        nivel: caida <= -5 ? "critico" : "revisar", periodo: abrev(m), partida: "Margen bruto",
        detalle: `${porcentaje(margenBrutoPorMes[m])} frente a ${porcentaje(referencia)} en los demás meses (${caida.toFixed(1).replace(".", ",")} puntos).`,
      });
    }
    // Cuentas de gasto: un mes muy por encima de su propio promedio.
    // Cada cuenta sale una sola vez, con su mes más alto; los otros meses que
    // también se salen se nombran en la misma fila.
    const excesos: (Alerta & { exceso: number })[] = [];
    for (const [cuenta, serie] of Array.from(gastoPorGrupo.entries())) {
      const fuera: { mes: number; valor: number; base: number; exceso: number }[] = [];
      for (const m of meses) {
        const valor = serie[m] || 0;
        const base = promedio(meses.filter(x => x !== m).map(x => serie[x] || 0));
        const exceso = valor - base;
        if (exceso < ingresosPromedio * MATERIALIDAD_GASTO) continue;
        if (base <= 0 || valor >= base * 1.5) fuera.push({ mes: m, valor, base, exceso });
      }
      if (fuera.length === 0) continue;
      const peor = fuera.reduce((a, b) => (b.exceso > a.exceso ? b : a));
      const otros = fuera.filter(f => f !== peor).map(f => `${nMes(f.mes)} (${pesosM(f.valor)})`);
      const tambien = otros.length ? ` También se sale en ${enLista(otros)}.` : "";
      excesos.push(peor.base <= 0
        ? { nivel: "vigilar", periodo: abrev(peor.mes), partida: nombreCuenta(cuenta), exceso: peor.exceso, detalle: `${pesosM(peor.valor)} en el mes; la cuenta no tuvo movimiento en los demás meses.` }
        : {
            nivel: peor.valor >= peor.base * 2 ? "revisar" : "vigilar", periodo: abrev(peor.mes), partida: nombreCuenta(cuenta), exceso: peor.exceso,
            detalle: `${pesosM(peor.valor)} en el mes frente a ${pesosM(peor.base)} de promedio en los demás meses (${conSigno(porcentaje(division(peor.exceso, peor.base), 0))}).${tambien}`,
          });
    }
    excesos.sort((a, b) => b.exceso - a.exceso).slice(0, 8).forEach(({ exceso: _exceso, ...a }) => alertas.push(a));
  }
  if (varios && Number.isFinite(creceGastos) && Number.isFinite(creceVentas) && (creceGastos - creceVentas) * 100 >= 10) {
    alertas.push({
      nivel: "revisar", periodo: `${abrev(primero)}–${abrev(ultimo)}`, partida: "Gastos crecen más que las ventas",
      detalle: `Los gastos varían ${conSigno(porcentaje(creceGastos))} y las ventas ${conSigno(porcentaje(creceVentas))} entre el primer y el último mes.`,
    });
  }
  if (entrada.balanceDiferencia !== null && Math.abs(entrada.balanceDiferencia) >= 1_000_000) {
    alertas.push({
      nivel: "critico", periodo: abrev(ultimo), partida: "El balance no cuadra",
      detalle: `Activo menos pasivo y patrimonio da ${pesosM(entrada.balanceDiferencia)} en el balance de prueba cargado.`,
    });
  }
  for (const c of entrada.efectivoNegativo.slice(0, 4)) {
    alertas.push({ nivel: "revisar", periodo: abrev(ultimo), partida: "Efectivo con saldo negativo", detalle: `${c.nombre || c.cuenta} (${c.cuenta}) cierra en ${pesosM(c.saldo)}.` });
  }
  const orden: Record<NivelAlerta, number> = { critico: 0, revisar: 1, vigilar: 2 };
  alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);

  // ---------------- Indicadores y textos ----------------
  const pct = (clave: ClaveER) => porcentaje(division(acumulado[clave], acumulado.totalIngresos));
  const tono = (v: number): "bueno" | "malo" | "neutro" => (v > 0 ? "bueno" : v < 0 ? "malo" : "neutro");
  const indicadores: InformeGestion["indicadores"] = [
    { titulo: "Ventas netas", valor: pesosM(acumulado.ventasNetas), detalle: varios ? `${MESES_NOMBRE[ultimo]}: ${pesosM(er.ventasNetas[ultimo])}` : "Del mes", tono: "neutro" },
    { titulo: "Utilidad bruta", valor: pesosM(acumulado.utilidadBruta), detalle: varios ? `Margen ${porcentaje(margenAcum)} · ${MESES_NOMBRE[ultimo]} ${porcentaje(margenBrutoPorMes[ultimo])}` : `Margen ${porcentaje(margenAcum)}`, tono: varios && margenBrutoPorMes[ultimo] < margenAnteriores - 0.01 ? "malo" : "neutro" },
    { titulo: "Utilidad operativa", valor: pesosM(acumulado.utilidadOperativa), detalle: `${pct("utilidadOperativa")} de los ingresos`, tono: tono(acumulado.utilidadOperativa) },
    { titulo: "Total gastos", valor: pesosM(acumulado.totalGastos), detalle: `${pct("totalGastos")} de los ingresos · ${pesosM(gastosPromedio)} al mes`, tono: "neutro" },
    { titulo: "Resultado del periodo", valor: pesosM(acumulado.resultado), detalle: varios ? `${MESES_NOMBRE[ultimo]}: ${pesosM(er.resultado[ultimo])}` : `${pct("resultado")} de los ingresos`, tono: tono(varios ? er.resultado[ultimo] : acumulado.resultado) },
    {
      titulo: "Punto de equilibrio mensual", valor: punto === null ? "—" : pesosM(punto),
      detalle: equilibrio.margenSeguridad === null ? "El margen bruto no alcanza a cubrir gastos" : `${porcentaje(equilibrio.margenSeguridad)} de margen de seguridad`,
      tono: equilibrio.margenSeguridad === null ? "malo" : equilibrio.margenSeguridad >= 0.05 ? "bueno" : equilibrio.margenSeguridad >= 0 ? "neutro" : "malo",
    },
  ];

  const tendencia = (cambio: number, umbral: number, sube: string, baja: string, igual: string) => (cambio > umbral ? sube : cambio < -umbral ? baja : igual);
  const cambioMargen = margenBrutoPorMes[ultimo] - margenBrutoPorMes[primero];
  const titularVision = !varios ? "Resultado del mes"
    : `Ventas ${tendencia(creceVentas, 0.02, "al alza", "a la baja", "estables")}, margen ${tendencia(cambioMargen, 0.01, "al alza", "a la baja", "estable")}`;
  const textoVision = [
    `Las ventas netas ${varios ? "acumulan" : "son de"} ${pesosM(acumulado.ventasNetas)}`,
    varios ? ` y pasan de ${pesosM(er.ventasNetas[primero])} en ${nMes(primero)} a ${pesosM(er.ventasNetas[ultimo])} en ${nMes(ultimo)} (${conSigno(porcentaje(creceVentas))}). El margen bruto pasa de ${porcentaje(margenBrutoPorMes[primero])} a ${porcentaje(margenBrutoPorMes[ultimo])}.` : `, con un margen bruto de ${porcentaje(margenAcum)}.`,
    ` La utilidad operativa del periodo es ${pesosM(acumulado.utilidadOperativa)} (${pct("utilidadOperativa")} de los ingresos) y el resultado ${pesosM(acumulado.resultado)} (${pct("resultado")}).`,
  ].join("");

  const resumen: InformeGestion["resumen"] = [
    { titulo: "Resultado", texto: `ventas netas de ${pesosM(acumulado.ventasNetas)}${varios ? ` (${conSigno(porcentaje(creceVentas))} entre ${nMes(primero)} y ${nMes(ultimo)})` : ""}, utilidad operativa de ${pesosM(acumulado.utilidadOperativa)} (${pct("utilidadOperativa")}) y resultado de ${pesosM(acumulado.resultado)} (${pct("resultado")}).` },
  ];
  if (varios) resumen.push({
    titulo: MESES_NOMBRE[ultimo][0].toUpperCase() + MESES_NOMBRE[ultimo].slice(1),
    texto: `resultado de ${pesosM(er.resultado[ultimo])} con ventas de ${pesosM(er.ventasNetas[ultimo])}; margen bruto de ${porcentaje(margenBrutoPorMes[ultimo])} frente a ${porcentaje(margenAnteriores)} en los meses anteriores${perdidas.length === 1 && perdidas[0] === ultimo ? ". Es la primera pérdida del periodo" : ""}.`,
  });
  resumen.push({
    titulo: "Punto de equilibrio",
    texto: punto === null ? "el margen bruto del periodo no alcanza a cubrir los gastos."
      : `${pesosM(punto)} de ingresos al mes frente a ${pesosM(ingresosPromedio)} de promedio (${porcentaje(equilibrio.margenSeguridad!)} de margen de seguridad)${puntosDeVenta.length ? `. ${noCubren.length} de ${puntosDeVenta.length} puntos de venta no cubren su equilibrio con administración` : ""}.`,
  });
  resumen.push({ titulo: "Gastos", texto: textoGastos.replace(/^Los gastos suman/, "suman") });
  if (nuevos.length > 0) resumen.push({ titulo: "Aperturas", texto: `${nuevos.length === 1 ? "1 punto nuevo" : `${nuevos.length} puntos nuevos`} en el periodo, con ventas de ${pesosM(sumaSerie(ventasAperturas, meses))} y resultado propio de ${pesosM(sumaSerie(resultadoAperturas, meses))}.` });
  if (entrada.balance) {
    const fila = (titulo: string) => entrada.balance!.filas.find(f => f.titulo === titulo);
    const activo = fila("Total activo"), pasivo = fila("Total pasivo");
    if (activo && pasivo) resumen.push({ titulo: "Balance", texto: `activo de ${pesosM(activo.final)} (${conSigno(pesosM(activo.final - activo.inicial))}) y pasivo de ${pesosM(pasivo.final)} (${conSigno(pesosM(pasivo.final - pasivo.inicial))}) al cierre de ${entrada.balance.etiquetaFinal.toLowerCase()}; las variaciones son frente ${/^\d{4}$/.test(entrada.balance.etiquetaInicial) ? `al cierre de ${entrada.balance.etiquetaInicial}` : `al ${entrada.balance.etiquetaInicial.toLowerCase()}`}.` });
  }
  const criticas = alertas.filter(a => a.nivel === "critico").length;
  if (alertas.length > 0) resumen.push({ titulo: "Variaciones atípicas", texto: `${alertas.length} partidas se salen del patrón del periodo${criticas ? `, ${criticas} de ellas críticas` : ""}; el detalle está en la sección de variaciones.` });

  return {
    anio, meses, mesCorte: ultimo, periodo, er, acumulado, indicadores, resumen, titularVision, textoVision, margenBrutoPorMes, equilibrio,
    centros, hayCentros,
    aperturas: {
      hay: nuevos.length > 0, puntosPorMes, ventasExistentes, ventasAperturas, gastosExistentes, gastosAperturas, gastosAdministracion,
      margenExistentes, resultadoAperturas, texto: textoAperturas,
    },
    textoCentros, gastos: { texto: textoGastos, grupos, crecen }, alertas, balance: entrada.balance, notas: entrada.notas,
  };
}
