import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { detectarPeriodoBalance, leerBalancePrueba, resolverColumnasBalance } from "./informesBalanceParse";
import { agregarHojaESF } from "./informesReportESF";
import type { ESF } from "./informesBalanceDb";

/** Un balance pequeño con el mismo formato del archivo real: títulos
 * arriba, encabezado en la fila 6, todos los niveles y una fila de totales. */
const BALANCE = [
  ["Balance de Prueba", null, null, null, null, null],
  ["Razon Social: EMPRESA DE PRUEBA", null, null, null, null, null],
  ["Nit: 900123456-1", null, null, null, null, null],
  ["Fecha del informe: Del: 01/10/2025 al: 31/10/2025", null, null, null, null, null],
  ["Fecha de Impresion: 18 noviembre 2025", null, null, null, null, null],
  ["Codigo Cta", "Nombre Cta", "Saldo Mes Ant.", "Debito", "Credito", "Saldo Mes"],
  ["1", "ACTIVO", 1000, 500, 300, 1200],
  ["11", "DISPONIBLE", 1000, 500, 300, 1200],
  ["1105", "CAJA", 400, 100, 300, 200],
  ["110505", "Caja general", "400", "100", "300", "200"],
  ["1110", "BANCOS", 600, 400, 0, 1000],
  ["111005", "Moneda nacional", 600, 400, 0, 1000],
  ["2", "PASIVO", 300, 50, 150, 400],
  ["2205", "NACIONALES", 300, 50, 150, 400],
  ["220505", "Proveedores", 300, 50, 150, 400],
  ["3", "PATRIMONIO", 500, 0, 0, 500],
  ["3115", "APORTES SOCIALES", 500, 0, 0, 500],
  ["4", "INGRESOS", 900, 0, 400, 1300],
  ["4135", "COMERCIO", 900, 0, 400, 1300],
  ["5", "GASTOS", 300, 100, 0, 400],
  ["5105", "GASTOS DE PERSONAL", 300, 100, 0, 400],
  ["6", "COSTOS DE VENTAS", 400, 200, 0, 600],
  ["6135", "COMERCIO", 400, 200, 0, 600],
  ["", "**TOTALES", null, 850, 850, null],
];

describe("balance de prueba: lectura del archivo", () => {
  const b = leerBalancePrueba(BALANCE);

  it("encuentra el encabezado debajo de los títulos y el mes del informe", () => {
    expect(resolverColumnasBalance(BALANCE)).toMatchObject({ filaEncabezado: 5, cuenta: 0, nombre: 1, saldoAnterior: 2, debito: 3, credito: 4, saldoFinal: 5, tercero: null });
    // La fecha de impresión (noviembre) no cuenta: manda la del informe.
    expect(b.periodoDetectado).toEqual({ anio: 2025, mes: 10 });
  });

  it("distingue las cuentas de detalle de los grupos, para no sumar dos veces", () => {
    expect(b.cuentas).toHaveLength(17);
    expect(b.cuentas.filter(c => c.esDetalle).map(c => c.cuenta)).toEqual(["110505", "111005", "220505", "3115", "4135", "5105", "6135"]);
    expect(b.cuentasDetalle).toBe(7);
  });

  it("lee los valores aunque vengan como texto y comprueba la ecuación", () => {
    expect(b.cuentas.find(c => c.cuenta === "110505")).toMatchObject({ nombre: "Caja general", saldoInicial: 400, debitos: 100, creditos: 300, saldoFinal: 200 });
    expect(b.totales).toEqual({ activo: 1200, pasivo: 400, patrimonio: 500, ingresos: 1300, gastos: 400, costos: 600 });
    expect(b.resultado).toBe(300);
    expect(b.diferenciaEcuacion).toBe(0); // 1200 − 400 − 500 − 300
    expect(b.diferenciaMovimiento).toBe(0);
    expect(b.cuentasInconsistentes).toBe(0);
    expect(b.signoInvertido).toBe(false);
    expect(b.porTercero).toBe(false);
  });

  it("avisa cuánto descuadra un balance que no cuadra", () => {
    const malo = BALANCE.map(f => (f[0] === "111005" ? ["111005", "Moneda nacional", 600, 400, 0, 1040] : f));
    const r = leerBalancePrueba(malo);
    expect(r.diferenciaEcuacion).toBe(40);
    expect(r.cuentasInconsistentes).toBe(1); // 600 + 400 − 0 no da 1040
  });

  it("pasa a signo natural un balance que trae pasivo, patrimonio e ingresos en negativo", () => {
    const enDebito = BALANCE.map(f => ("234".includes(String(f[0])[0]) && /^\d+$/.test(String(f[0])) ? [f[0], f[1], -Number(f[2]), f[3], f[4], -Number(f[5])] : f));
    const r = leerBalancePrueba(enDebito);
    expect(r.signoInvertido).toBe(true);
    expect(r.cuentas.find(c => c.cuenta === "220505")).toMatchObject({ saldoInicial: 300, saldoFinal: 400 });
    expect(r.totales).toEqual(b.totales);
    expect(r.diferenciaEcuacion).toBe(0);
    expect(r.cuentasInconsistentes).toBe(0);
  });

  it("suma por cuenta un balance que viene por tercero", () => {
    const porTercero = [
      ["Balance de prueba por tercero a septiembre de 2025"],
      ["Cuenta", "Nombre cuenta", "Nit", "Nombre tercero", "Saldo anterior", "Débitos", "Créditos", "Nuevo saldo"],
      // Solo terceros: se suman.
      ["130505", "Clientes nacionales", "900111", "CLIENTE UNO", 100, 50, 20, 130],
      ["130505", "Clientes nacionales", "900222", "CLIENTE DOS", 200, 0, 50, 150],
      // Total de la cuenta y, debajo, sus terceros: vale el total.
      ["220505", "Proveedores", "", "", 500, 100, 300, 700],
      ["220505", "Proveedores", "800111", "PROVEEDOR UNO", 300, 100, 200, 400],
      ["220505", "Proveedores", "800222", "PROVEEDOR DOS", 200, 0, 100, 300],
    ];
    const r = leerBalancePrueba(porTercero);
    expect(r.porTercero).toBe(true);
    expect(r.periodoDetectado).toEqual({ anio: 2025, mes: 9 });
    expect(r.cuentas).toHaveLength(2);
    expect(r.cuentas.find(c => c.cuenta === "130505")).toMatchObject({ saldoInicial: 300, debitos: 50, creditos: 70, saldoFinal: 280, esDetalle: true });
    expect(r.cuentas.find(c => c.cuenta === "220505")).toMatchObject({ saldoInicial: 500, debitos: 100, creditos: 300, saldoFinal: 700 });
  });

  it("no confunde la columna del nombre con la del código y acepta otros encabezados", () => {
    const otro = [
      ["Nombre de la cuenta", "Cuenta", "Saldo inicial", "Movimiento débito", "Movimiento crédito", "Saldo final"],
      ["Caja general", "110505", "1.500,50", 0, 0, "1.500,50"],
    ];
    expect(resolverColumnasBalance(otro)).toMatchObject({ filaEncabezado: 0, cuenta: 1, nombre: 0, saldoAnterior: 2, debito: 3, credito: 4, saldoFinal: 5 });
    expect(leerBalancePrueba(otro).cuentas[0]).toMatchObject({ cuenta: "110505", nombre: "Caja general", saldoInicial: 1500.5, saldoFinal: 1500.5 });
    expect(detectarPeriodoBalance(otro, 0)).toBeNull(); // sin títulos: el mes lo elige el contador
  });

  it("explica qué falta cuando el archivo no es un balance de prueba", () => {
    expect(() => leerBalancePrueba([["Fecha", "Cuenta", "Débito", "Crédito"], ["01/10/2025", "110505", 10, 0]])).toThrow(/columnas del balance de prueba/);
  });
});

describe("hoja ESF del Estado de Resultados", () => {
  const serie = (inicial: number, octubre: number) => ({ inicial, valores: { 10: octubre } });
  const esf: ESF = {
    anio: 2025, meses: [10], etiquetaInicial: "Saldo anterior a octubre", cargas: [],
    activo: [
      { cuenta: "110505", nombre: "Caja general", inicial: 400, valores: { 10: 200 }, estado: "PE", observacion: "Sin conciliar" },
      { cuenta: "111005", nombre: "Moneda nacional", inicial: 600, valores: { 10: 1000 }, estado: null, observacion: null },
    ],
    pasivo: [{ cuenta: "220505", nombre: "Proveedores", inicial: 300, valores: { 10: 400 }, estado: "OK", observacion: null }],
    patrimonio: [{ cuenta: "3115", nombre: "Aportes sociales", inicial: 500, valores: { 10: 500 }, estado: null, observacion: null }],
    resultado: serie(200, 300), totalActivo: serie(1000, 1200), totalPasivo: serie(300, 400),
    totalPatrimonio: serie(700, 800), pasivoPatrimonio: serie(1000, 1200), diferencia: serie(0, 0),
  };

  it("arma la estructura del informe: cuentas, totales con fórmula, estado y observaciones", () => {
    const wb = new ExcelJS.Workbook();
    agregarHojaESF(wb, esf, { razonSocial: "EMPRESA DE PRUEBA", nit: "900123456-1" });
    const ws = wb.getWorksheet("ESF")!;
    const filas: any[][] = [];
    ws.eachRow({ includeEmpty: true }, r => { filas.push((r.values as any[]).slice(1)); });
    const fila = (texto: string) => filas.find(f => f[0] === texto || f[1] === texto)!;
    expect(fila("CUENTA")).toEqual(["CUENTA", "DETALLE", "Saldo anterior a octubre", "Octubre", "Estado", "Observaciones"]);
    expect(fila("110505")).toEqual(["110505", "Caja general", 400, 200, "PE", "Sin conciliar"]);
    const total = (titulo: string) => fila(titulo)[3] as { formula: string; result: number };
    expect(total("TOTAL ACTIVO")).toMatchObject({ formula: "SUM(D7:D8)", result: 1200 });
    expect(total("TOTAL PASIVO").result).toBe(400);
    expect(fila("Resultado del ejercicio").slice(2, 4)).toEqual([200, 300]);
    expect(total("TOTAL PATRIMONIO").result).toBe(800);
    expect(total("PASIVO + PATRIMONIO").result).toBe(1200);
    // Activo − (pasivo + patrimonio), como fórmula sobre las filas de totales.
    expect(total("DIFERENCIA").formula).toMatch(/^D\d+-D\d+$/);
    expect(total("DIFERENCIA").result ?? 0).toBe(0);
    // El orden es el del informe: activo, pasivo, patrimonio, totales al final.
    const orden = filas.map(f => f[1]).filter(t => typeof t === "string" && /^(TOTAL|PASIVO \+|DIFERENCIA|Resultado)/.test(t));
    expect(orden).toEqual(["TOTAL ACTIVO", "TOTAL PASIVO", "Resultado del ejercicio", "TOTAL PATRIMONIO", "PASIVO + PATRIMONIO", "DIFERENCIA"]);
  });
});
