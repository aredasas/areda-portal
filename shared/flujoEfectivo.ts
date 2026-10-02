/** Reglas del Flujo de Efectivo que comparten el servidor (cálculo e
 * informe) y el navegador (pantalla de configuración). */

export const SECCIONES_FLUJO = ["recaudos", "egresos_operacion", "inversion", "financiacion"] as const;
export type SeccionFlujo = typeof SECCIONES_FLUJO[number];

export const TITULO_SECCION: Record<SeccionFlujo, string> = {
  recaudos: "Recaudos",
  egresos_operacion: "Egresos de operación",
  inversion: "Inversión",
  financiacion: "Financiación",
};

/** Caja, bancos y cuentas de ahorro del PUC comercial. Un cliente con
 * otro plan de cuentas (ej. NIIF, donde suele ser la 1101) lo cambia en
 * la configuración. */
export const PREFIJOS_EFECTIVO_DEFECTO = ["1105", "1110", "1120"];

/** Cuentas que, sin ser de ingreso, entran al flujo como recaudo: lo
 * que pagan los clientes, sus anticipos, y los impuestos que se cobran o
 * se retienen dentro de la misma operación (IVA generado, retenciones
 * practicadas). */
const RECAUDOS = new Set(["1305", "2365", "2367", "2368", "2408", "2410", "2805"]);
/** Deudas con socios y dividendos: financiación aunque estén en el grupo 23. */
const FINANCIACION = new Set(["2355", "2360"]);

/** Sección en la que entra una cuenta contrapartida (a 4 dígitos)
 * mientras el contador no la cambie para ese cliente. Es la misma
 * clasificación del flujo modelo: ingresos y lo que se cobra con la
 * venta, a Recaudos; obligaciones financieras, gastos no operacionales
 * (53) y patrimonio, a Financiación; todo lo demás, a Egresos de
 * operación. "Inversión" nunca se asigna sola: la elige el contador. */
export function seccionPorDefecto(cuenta: string): SeccionFlujo {
  const c = cuenta.slice(0, 4);
  if (c.startsWith("4") || RECAUDOS.has(c)) return "recaudos";
  if (c.startsWith("21") || c.startsWith("53") || c.startsWith("3") || FINANCIACION.has(c)) return "financiacion";
  return "egresos_operacion";
}

/** Limpia la lista de cuentas de efectivo: solo dígitos, sin repetidas,
 * y sin las que ya quedan cubiertas por otra más corta ("110505" sobra
 * si ya está "1105"). */
export function normalizarPrefijos(entrada: string | string[]): string[] {
  const partes = (Array.isArray(entrada) ? entrada : entrada.split(/[\s,;]+/))
    .map(p => p.replace(/\D/g, "")).filter(p => p.length >= 2);
  const unicos = Array.from(new Set(partes)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const resultado: string[] = [];
  for (const p of unicos) if (!resultado.some(r => p.startsWith(r))) resultado.push(p);
  return resultado.sort();
}

export function esCuentaDeEfectivo(cuenta: string, prefijos: string[]): boolean {
  return prefijos.some(p => cuenta.startsWith(p));
}

/** Lee un valor en pesos como lo escribe un contador colombiano:
 * "1.303.663.052", "1.303.663.052,50", "$ 1,303,663,052.50" o
 * "-250000". Devuelve null si está vacío o no es un número. */
export function parsearPesos(texto: string): number | null {
  let s = texto.replace(/[\s$]/g, "");
  if (!s) return null;
  const negativo = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-]/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  const ultimoPunto = s.lastIndexOf(".");
  const ultimaComa = s.lastIndexOf(",");
  let decimal = "";
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    // Trae los dos: el que aparece de último es el separador decimal.
    decimal = ultimaComa > ultimoPunto ? "," : ".";
  } else {
    // Solo uno: es decimal si aparece una vez y no deja grupos de tres
    // ("1234,5" o "0.75"); si no, separa miles ("1.303.663" o "250,000").
    const signo = ultimaComa >= 0 ? "," : ultimoPunto >= 0 ? "." : "";
    if (signo) {
      const veces = s.split(signo).length - 1;
      const despues = s.length - s.lastIndexOf(signo) - 1;
      if (veces === 1 && despues !== 3) decimal = signo;
    }
  }
  const limpio = decimal === ""
    ? s.replace(/[.,]/g, "")
    : s.split(decimal === "," ? "." : ",").join("").replace(decimal, ".");
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}
