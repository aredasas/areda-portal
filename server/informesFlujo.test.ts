import { describe, expect, it } from "vitest";
import { calcularFlujoMes, resolverColumnasFlujo } from "./informesFlujoCalculo";
import { pesosCortos, redactarObservacion } from "./informesFlujoDb";
import { esCuentaDeEfectivo, normalizarPrefijos, parsearPesos, seccionPorDefecto } from "../shared/flujoEfectivo";

const ENCABEZADO = ["Fecha", "Tipo de comprobante", "Número", "Código contable", "Cuenta contable", "Identificación", "Nombre tercero", "Débito", "Crédito"];
const fila = (dia: string, tipo: string, numero: string, cuenta: string, debito: number, credito: number, tercero = "VARIOS") =>
  [dia, tipo, numero, cuenta, `Nombre ${cuenta}`, "900", tercero, debito, credito];

/** Un mes pequeño con todos los casos del método. */
const AUXILIAR = [
  ENCABEZADO,
  // Venta de contado: entra plata; el costo contra inventario no mueve efectivo.
  fila("05/08/2026", "FE", "1", "110505", 119000, 0),
  fila("05/08/2026", "FE", "1", "41350501", 0, 100000, "CONSUMIDOR FINAL"),
  fila("05/08/2026", "FE", "1", "24080501", 0, 19000, "CONSUMIDOR FINAL"),
  fila("05/08/2026", "FE", "1", "61350501", 60000, 0),
  fila("05/08/2026", "FE", "1", "14350101", 0, 60000),
  // Pago a proveedor por banco, con retención practicada.
  fila("10/08/2026", "CE", "1", "22050501", 500000, 0, "COOPIDROGAS"),
  fila("10/08/2026", "CE", "1", "23654001", 0, 12500, "COOPIDROGAS"),
  fila("10/08/2026", "CE", "1", "11100501", 0, 487500),
  // Compra de mercancía de contado: aquí el inventario SÍ es un egreso.
  fila("12/08/2026", "CM", "7", "14350101", 80000, 0, "DISTRIBUIDORA"),
  fila("12/08/2026", "CM", "7", "110505", 0, 80000),
  // Consignación: de caja a banco, no cambia el efectivo total.
  fila("15/08/2026", "CB", "3", "11100501", 30000, 0),
  fila("15/08/2026", "CB", "3", "110505", 0, 30000),
  // Cuota de un crédito.
  fila("20/08/2026", "CE", "2", "21050501", 200000, 0, "BANCOLOMBIA"),
  fila("20/08/2026", "CE", "2", "53052001", 15000, 0, "BANCOLOMBIA"),
  fila("20/08/2026", "CE", "2", "11100501", 0, 215000),
  // Causación de nómina: no toca efectivo, queda fuera del grupo.
  fila("30/08/2026", "NC", "9", "51050601", 900000, 0),
  fila("30/08/2026", "NC", "9", "25050501", 0, 900000),
  // Otro mes y una fila de subtotal: no entran.
  fila("31/07/2026", "RC", "50", "110505", 777, 0),
  fila("31/07/2026", "RC", "50", "41350501", 0, 777),
  [null, null, null, "Cuenta contable: 110505 Caja general", null, null, null, 999999, 0],
];

describe("flujo de efectivo: cálculo de un mes", () => {
  const r = calcularFlujoMes(AUXILIAR, 2026, 8, ["1105", "1110", "1120"]);
  const neto = (clase: string, prefijo: string) => r.movimientos
    .filter(m => m.clase === clase && m.cuenta.startsWith(prefijo)).reduce((s, m) => s + m.creditos - m.debitos, 0);

  it("toma solo los documentos que mueven efectivo y valida sumas iguales", () => {
    expect(r.documentos).toBe(5); // FE-1, CE-1, CM-7, CB-3, CE-2 (la nómina causada queda fuera)
    expect(r.lineas).toBe(15);
    expect(r.lineasAuxiliar).toBe(17); // sin julio ni la fila de subtotal
    expect(r.totalDebitos).toBe(r.totalCreditos);
    expect(r.descuadrados).toBe(0);
  });

  it("la suma de contrapartidas es igual a la variación del efectivo", () => {
    const variacion = r.movimientos.filter(m => m.clase === "efectivo").reduce((s, m) => s + m.debitos - m.creditos, 0);
    const contrapartidas = r.movimientos.filter(m => m.clase !== "efectivo").reduce((s, m) => s + m.creditos - m.debitos, 0);
    expect(variacion).toBe(119000 - 487500 - 80000 - 215000);
    expect(contrapartidas).toBe(variacion);
  });

  it("separa el costo de venta contra inventario de la misma factura (sin efecto en caja)", () => {
    expect(neto("sin_efecto", "1435")).toBe(60000);
    expect(neto("sin_efecto", "6135")).toBe(-60000);
    // La compra de contado sí es una salida de efectivo.
    expect(neto("contrapartida", "1435")).toBe(-80000);
  });

  it("agrupa por subcuenta y tipo de comprobante", () => {
    expect(r.movimientos.find(m => m.cuenta === "22050501")).toMatchObject({ clase: "contrapartida", tipoDocumento: "CE", debitos: 500000, creditos: 0, documentos: 1, lineas: 1 });
    expect(r.movimientos.find(m => m.cuenta === "11100501")).toMatchObject({ clase: "efectivo", debitos: 30000, creditos: 702500, documentos: 3 });
  });

  it("guarda los terceros de mayor valor y las cuentas del grupo 11", () => {
    expect(r.observaciones["2205"]).toEqual([{ nombre: "COOPIDROGAS", neto: -500000 }]);
    expect(r.cuentasDisponibles.map(c => c.cuenta)).toEqual(["110505", "11100501"]);
    expect(r.nombres.get("22050501")).toBe("Nombre 22050501");
  });

  it("marca como descuadrado un documento que no tiene sumas iguales", () => {
    const malo = calcularFlujoMes([ENCABEZADO, fila("01/08/2026", "RC", "1", "110505", 1000, 0), fila("01/08/2026", "RC", "1", "41350501", 0, 900)], 2026, 8, ["1105"]);
    expect(malo.descuadrados).toBe(1);
    expect(malo.totalDebitos - malo.totalCreditos).toBe(100);
  });

  it("con otras cuentas de efectivo (plan NIIF) el grupo cambia", () => {
    expect(calcularFlujoMes(AUXILIAR, 2026, 8, ["1101"]).documentos).toBe(0);
    expect(calcularFlujoMes(AUXILIAR, 2026, 8, ["1105"]).documentos).toBe(3);
  });

  it("usa el comprobante como llave aunque haya una columna de documento de referencia", () => {
    const cols = resolverColumnasFlujo([
      ["Fecha", "Documento", "Tipo comprobante", "Comprobante", "Cuenta", "Nombre cuenta", "Nit", "Debe", "Haber"],
      ["01/08/2026", "FV-88", "CE", "15", "110505", "Caja", "900", 0, 100],
    ]);
    expect(cols).toMatchObject({ numero: 3, tipo: 2, cuenta: 4, nombreCuenta: 5, debito: 7, credito: 8, tercero: 6 });
  });

  it("no confunde la columna del nombre de la cuenta con la del código", () => {
    const cols = resolverColumnasFlujo([
      ["Fecha", "Cuenta contable", "Código contable", "Comprobante", "Débito", "Crédito"],
      ["01/08/2026", "Caja general", "110505", "CE-1", 0, 100],
    ]);
    expect(cols).toMatchObject({ cuenta: 2, nombreCuenta: 1, numero: 3, tipo: null });
  });
});

describe("flujo de efectivo: reglas compartidas", () => {
  it("clasifica cada cuenta en su sección como el flujo modelo", () => {
    for (const c of ["4135", "4175", "4210", "2365", "2368", "2408", "1305"]) expect(seccionPorDefecto(c)).toBe("recaudos");
    for (const c of ["1330", "1435", "1520", "2205", "2335", "2405", "2505", "5105", "5235"]) expect(seccionPorDefecto(c)).toBe("egresos_operacion");
    for (const c of ["2101", "2105", "2125", "5305", "5390", "3130"]) expect(seccionPorDefecto(c)).toBe("financiacion");
  });

  it("limpia la lista de cuentas de efectivo", () => {
    expect(normalizarPrefijos("1120, 1105; 1110 110505")).toEqual(["1105", "1110", "1120"]);
    expect(normalizarPrefijos(["11.01", "x"])).toEqual(["1101"]);
    expect(esCuentaDeEfectivo("11100601", ["1105", "1110"])).toBe(true);
    expect(esCuentaDeEfectivo("11201505", ["1105", "1110"])).toBe(false);
  });

  it("lee los saldos como los escribe un contador", () => {
    expect(parsearPesos("1.303.663.052")).toBe(1303663052);
    expect(parsearPesos("1.045.150.469,50")).toBe(1045150469.5);
    expect(parsearPesos("$ 1,303,663,052.25")).toBe(1303663052.25);
    expect(parsearPesos("-250000")).toBe(-250000);
    expect(parsearPesos("(1.500)")).toBe(-1500);
    expect(parsearPesos("1234,5")).toBe(1234.5);
    expect(parsearPesos("250.000")).toBe(250000);
    expect(parsearPesos("0")).toBe(0);
    expect(parsearPesos("")).toBeNull();
    expect(parsearPesos("abc")).toBeNull();
  });

  it("redacta la observación con los terceros que más pesan", () => {
    expect(pesosCortos(12_040_000)).toBe("$12,0 M");
    expect(pesosCortos(-630)).toBe("$630");
    expect(pesosCortos(1_562_349_023)).toBe("$1.562,3 M");
    expect(redactarObservacion([], 100)).toBe("");
    expect(redactarObservacion([{ nombre: "COOPIDROGAS", neto: -1_400_000_000 }, { nombre: "TECNOQUIMICAS", neto: -112_000_000 }], -1_557_000_000))
      .toBe("Principalmente COOPIDROGAS ($1.400,0 M)");
    expect(redactarObservacion([{ nombre: "A", neto: 40_000_000 }, { nombre: "B", neto: 35_000_000 }, { nombre: "C", neto: 30_000_000 }, { nombre: "D", neto: 5 }], 110_000_005))
      .toBe("A ($40,0 M), B ($35,0 M) y C ($30,0 M)");
    expect(redactarObservacion([{ nombre: "830011670", neto: 5_000_000 }], 5_000_000)).toBe("NIT 830011670 ($5,0 M)");
  });
});
