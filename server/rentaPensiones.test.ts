import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  armarLiquidacion, calcularValorLimitado, generarAnexosRenta, generarBorrador210, tipoPermitidoEnCedula, validarRenta, validarTopeDeduccion,
  TIPOS_DEDUCCION_RENTA_EXENTA, TIPOS_RENTA_EXENTA_PENSIONES, UVT_2025,
  type DatosCedula, type DatosLiquidacion, type ItemValor,
} from "./rentaDb";

/** Renta exenta de pensiones (Art. 206 núm. 5 E.T.): 1.000 UVT por pago
 * mensual → 12.000 UVT al año = $597.588.000 con la UVT 2025 de $49.799. */
const TOPE_ANUAL = 597_588_000;

const cedula = (c: Partial<DatosCedula> = {}): DatosCedula => ({ ingresoBruto: [], ingresoNoConstitutivo: [], costoDeduccionProcedente: [], rentaExenta: [], deduccion: [], retencion: [], ...c });
const item = (concepto: string, valor: number, tipoDeduccion?: string): ItemValor => ({ concepto, valor, tipoDeduccion });
const datos = (pensiones: Partial<DatosCedula>, otras: Record<string, DatosCedula> = {}): DatosLiquidacion => ({
  activos: [], pasivos: [], descuentosTributarios: [], primeraDeclaracion: true,
  patrimonioLiquidoAnioAnterior: null, impuestoNetoAnioAnterior: null, saldoAFavorAnterior: null, anticipoAnioActual: null,
  cedulas: { pensiones: cedula(pensiones), ...otras },
});
const pensionado = (exentas: ItemValor[]) => datos({
  ingresoBruto: [item("Mesadas Colpensiones", 60_000_000)],
  ingresoNoConstitutivo: [item("Aportes obligatorios a salud", 7_200_000)],
  rentaExenta: exentas,
});

describe("renta PN: renta exenta de pensiones (Art. 206 núm. 5)", () => {
  it("está en el catálogo, solo para la Cédula de Pensiones y con el tope oficial", () => {
    const tipo = TIPOS_DEDUCCION_RENTA_EXENTA.find(t => t.tipo === "pensiones_exentas")!;
    expect(tipo).toMatchObject({ tipoValor: "renta_exenta", topeUVT: 12000, cedulas: ["pensiones"] });
    expect(12000 * UVT_2025).toBe(TOPE_ANUAL);
    expect(validarTopeDeduccion("pensiones_exentas", 1)).toMatchObject({ tope: TOPE_ANUAL, topeUVT: 12000, excedeTope: false });
    expect(TIPOS_RENTA_EXENTA_PENSIONES.has("pensiones_exentas")).toBe(true);
    expect(TIPOS_RENTA_EXENTA_PENSIONES.has("pension_indemnizacion_sustitutiva")).toBe(true);
    expect(tipoPermitidoEnCedula("pensiones_exentas", "pensiones")).toBe(true);
    expect(tipoPermitidoEnCedula("pensiones_exentas", "trabajo")).toBe(false);
    expect(tipoPermitidoEnCedula("pensiones_exentas", undefined)).toBe(false);
    // Los conceptos de siempre siguen sin restricción de cédula.
    expect(tipoPermitidoEnCedula("renta_exenta_25_laboral", "trabajo")).toBe(true);
    expect(tipoPermitidoEnCedula("aportes_voluntarios_pension_afc", "capital")).toBe(true);
  });

  it("pensión normal: toda la renta líquida queda exenta y la cédula no genera impuesto", () => {
    const d = pensionado([item("Pensión exenta", 52_800_000, "pensiones_exentas")]);
    const r = armarLiquidacion(d);
    expect(r.ingresoBrutoPensiones).toBe(60_000_000);
    expect(r.rentaLiquidaPensiones).toBe(52_800_000);        // casilla 101
    expect(r.rentaExentaPensiones).toBe(52_800_000);          // casilla 102
    expect(r.rentaLiquidaGravablePensiones).toBe(0);          // casilla 103
    expect(r.rentaLiquidaGravableTotal).toBe(0);
    expect(validarRenta(d, r).filter(h => h.categoria === "Pensiones")).toEqual([]);
  });

  it("sin registrar la exenta, toda la pensión queda gravada y la validación lo advierte", () => {
    const d = pensionado([]);
    const r = armarLiquidacion(d);
    expect(r.rentaExentaPensiones).toBe(0);
    expect(r.rentaLiquidaGravablePensiones).toBe(52_800_000);
    const avisos = validarRenta(d, r).filter(h => h.categoria === "Pensiones");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].severidad).toBe("advertencia");
    expect(avisos[0].mensaje).toContain("no se ha registrado su renta exenta");
  });

  it("pensión alta: la exenta se limita a 12.000 UVT y el resto queda gravado", () => {
    const d = datos({ ingresoBruto: [item("Mesadas", 700_000_000)], rentaExenta: [item("Pensión exenta", 700_000_000, "pensiones_exentas")] });
    const r = armarLiquidacion(d);
    expect(calcularValorLimitado(700_000_000, "pensiones_exentas", 700_000_000)).toBe(TOPE_ANUAL);
    expect(r.rentaExentaPensiones).toBe(TOPE_ANUAL);
    expect(r.rentaLiquidaGravablePensiones).toBe(700_000_000 - TOPE_ANUAL);
    const avisos = validarRenta(d, r);
    expect(avisos.some(h => h.categoria === "Tope individual" && h.mensaje.includes("12000 UVT"))).toBe(true);
  });

  it("la exenta nunca supera la renta líquida de la cédula (casilla 102 ≤ casilla 101)", () => {
    const d = pensionado([item("Pensión exenta", 60_000_000, "pensiones_exentas")]); // digitaron el bruto, sin restar salud
    const r = armarLiquidacion(d);
    expect(r.rentaExentaPensiones).toBe(52_800_000);
    expect(r.rentaLiquidaGravablePensiones).toBe(0);
    expect(validarRenta(d, r).some(h => h.categoria === "Pensiones" && h.mensaje.includes("es mayor que la renta líquida"))).toBe(true);
  });

  it("si la exenta no cubre toda la renta líquida y no llega al tope, lo informa", () => {
    const d = pensionado([item("Pensión exenta", 40_000_000, "pensiones_exentas")]);
    const r = armarLiquidacion(d);
    expect(r.rentaLiquidaGravablePensiones).toBe(12_800_000);
    const aviso = validarRenta(d, r).find(h => h.categoria === "Pensiones" && h.severidad === "info");
    expect(aviso?.mensaje).toContain("$12.800.000");
  });

  it("no compite por el tope del 40 % de la Cédula General ni cambia esa cédula", () => {
    const trabajo = cedula({ ingresoBruto: [item("Salarios", 100_000_000)], rentaExenta: [item("25%", 20_000_000, "renta_exenta_25_laboral")] });
    const soloTrabajo = armarLiquidacion(datos({}, { trabajo }));
    const conPension = armarLiquidacion(datos({ ingresoBruto: [item("Mesadas", 30_000_000)], rentaExenta: [item("Pensión exenta", 30_000_000, "pensiones_exentas")] }, { trabajo }));
    expect(conPension.subRentas.trabajo).toEqual(soloTrabajo.subRentas.trabajo);
    expect(conPension.totalDisponibleGeneral).toBe(soloTrabajo.totalDisponibleGeneral);
    expect(conPension.rentaLiquidaGravableTotal).toBe(soloTrabajo.rentaLiquidaGravableTotal);
    expect(conPension.rentaExentaPensiones).toBe(30_000_000);
  });

  it("registrada en otra cédula, la validación lo marca como error", () => {
    const d = datos({}, { trabajo: cedula({ ingresoBruto: [item("Salarios", 50_000_000)], rentaExenta: [item("Pensión exenta", 10_000_000, "pensiones_exentas")] }) });
    const errores = validarRenta(d, armarLiquidacion(d)).filter(h => h.severidad === "error" && h.categoria === "Pensiones");
    expect(errores).toHaveLength(1);
    expect(errores[0].mensaje).toContain("debe ir en la Cédula de Pensiones");
  });

  it("sale en el borrador 210 (casilla 102) y el anexo se genera", async () => {
    const d = pensionado([item("Pensión exenta", 52_800_000, "pensiones_exentas")]);
    const r = armarLiquidacion(d);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generarBorrador210(r, "PENSIONADO DE PRUEBA", "123", 2025) as any);
    const filas: any[][] = [];
    wb.worksheets[0].eachRow(row => filas.push((row.values as any[]).slice(1)));
    const casilla = (n: number) => filas.find(f => f[0] === n);
    expect(casilla(99)?.slice(-1)[0]).toBe(60_000_000);
    expect(casilla(100)?.slice(-1)[0]).toBe(7_200_000);
    expect(casilla(101)?.slice(-1)[0]).toBe(52_800_000);
    expect(casilla(102)?.slice(-1)[0]).toBe(52_800_000);
    expect(casilla(103)?.slice(-1)[0]).toBe(0);
    const pdf = await generarAnexosRenta(d, r, "PENSIONADO DE PRUEBA", "123", 2025);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
