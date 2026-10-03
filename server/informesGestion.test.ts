import { describe, expect, it } from "vitest";
import { calcularInformeGestion, estadoResultados, millones, pesosM, porcentaje, type EntradaGestion, type SaldoGestion } from "./informesGestionCalculo";
import { escala, generarPdfGestion } from "./informesReportGestion";

const M = 1_000_000;

/** Tres meses, dos puntos de venta que existen desde enero, uno que abre en
 * marzo y un centro administrativo que no vende. */
function saldosDePrueba(): SaldoGestion[] {
  const s: SaldoGestion[] = [];
  const punto = (centro: string, mes: number, ventas: number, gastos: number) => {
    s.push({ mes, centroCodigo: centro, cuenta: "413536", tipo: "ingreso", valor: ventas });
    s.push({ mes, centroCodigo: centro, cuenta: "613536", tipo: "costo", valor: ventas * 0.8 });
    s.push({ mes, centroCodigo: centro, cuenta: "421040", tipo: "descuento_pp", valor: ventas * 0.05 });
    s.push({ mes, centroCodigo: centro, cuenta: "520506", tipo: "gasto", valor: gastos });
  };
  for (const mes of [1, 2, 3]) {
    punto("02", mes, 400 * M, 40 * M);
    punto("03", mes, 100 * M, 30 * M);
    s.push({ mes, centroCodigo: "01", cuenta: "510506", tipo: "gasto", valor: mes === 3 ? 60 * M : 20 * M });
    s.push({ mes, centroCodigo: "01", cuenta: "421005", tipo: "ingreso", valor: 2 * M });
  }
  punto("04", 3, 50 * M, 35 * M);
  s.push({ mes: 3, centroCodigo: "01", cuenta: "540505", tipo: "gasto", valor: 10 * M });
  return s;
}

function entrada(cambios: Partial<EntradaGestion> = {}): EntradaGestion {
  return {
    anio: 2026, mesCorte: 3, saldos: saldosDePrueba(),
    centros: new Map([["01", "ADMINISTRACION"], ["02", "PRINCIPAL"], ["03", "NORTE"], ["04", "SUR"]]),
    catalogo: new Map([["520506", "Sueldos ventas"], ["510506", "Sueldos"]]),
    balance: null, balanceDiferencia: null, efectivoNegativo: [], notas: { puntos: [], plan: [] },
    ...cambios,
  };
}

describe("informe de gestión: formato de cifras", () => {
  it("escribe millones con un decimal, separador de miles y signo", () => {
    expect(millones(15_135_700_000)).toBe("15.135,7");
    expect(millones(-22_840_000)).toBe("-22,8");
    expect(millones(-20_000)).toBe("0,0"); // no hay "menos cero"
    expect(pesosM(1_034_600_000)).toBe("$1.034,6 M");
    expect(pesosM(-22_840_000)).toBe("-$22,8 M");
    expect(porcentaje(0.4031)).toBe("40,3%");
    expect(porcentaje(-0.05, 0)).toBe("-5%");
    expect(porcentaje(NaN)).toBe("—");
  });
});

describe("informe de gestión: estado de resultados", () => {
  const er = estadoResultados(saldosDePrueba(), [1, 2, 3]);

  it("separa ventas (41) de otros ingresos y la renta (54) de los gastos", () => {
    expect(er.ventasNetas[1]).toBe(500 * M);
    expect(er.otrosIngresos[1]).toBe(2 * M);
    expect(er.impuestoRenta[3]).toBe(10 * M);
    expect(er.gastosAdmin[3]).toBe(60 * M);
    expect(er.gastosVentas[3]).toBe(105 * M);
  });

  it("cuadra de arriba abajo en cada mes", () => {
    for (const m of [1, 2, 3]) {
      expect(er.costoNeto[m]).toBeCloseTo(er.costoBruto[m] - er.descuentos[m], 2);
      expect(er.utilidadBruta[m]).toBeCloseTo(er.totalIngresos[m] - er.costoNeto[m], 2);
      expect(er.utilidadOperativa[m]).toBeCloseTo(er.utilidadBruta[m] - er.totalGastos[m], 2);
      expect(er.resultado[m]).toBeCloseTo(er.utilidadOperativa[m] - er.impuestoRenta[m], 2);
    }
    // Enero: ingresos 502, costo neto 500 × 0,75 = 375, gastos 90.
    expect(er.utilidadBruta[1]).toBeCloseTo(127 * M, 2);
    expect(er.utilidadOperativa[1]).toBeCloseTo(37 * M, 2);
  });
});

describe("informe de gestión: cálculo", () => {
  const informe = calcularInformeGestion(entrada());

  it("toma los meses hasta el corte y nombra el periodo", () => {
    expect(informe.meses).toEqual([1, 2, 3]);
    expect(informe.periodo).toBe("enero–marzo 2026");
    expect(calcularInformeGestion(entrada({ mesCorte: 2 })).meses).toEqual([1, 2]);
    expect(calcularInformeGestion(entrada({ mesCorte: 1 })).periodo).toBe("enero 2026");
    expect(() => calcularInformeGestion(entrada({ saldos: [] }))).toThrow(/No hay estado de resultados/);
  });

  it("el acumulado es la suma de los meses y el punto de equilibrio sale de gastos y margen", () => {
    const { acumulado, equilibrio } = informe;
    expect(acumulado.ventasNetas).toBe(1550 * M);
    expect(acumulado.totalIngresos).toBe(1556 * M);
    expect(acumulado.utilidadBruta).toBeCloseTo(1556 * M - 1550 * M * 0.75, 2);
    expect(acumulado.totalGastos).toBe(345 * M);
    expect(acumulado.resultado).toBeCloseTo(acumulado.utilidadOperativa - 10 * M, 2);
    const margen = acumulado.utilidadBruta / acumulado.totalIngresos;
    expect(equilibrio.punto).toBeCloseTo(345 * M / 3 / margen, 0);
    expect(equilibrio.margenSeguridad).toBeCloseTo(1 - equilibrio.punto! / (1556 * M / 3), 6);
  });

  it("distingue puntos de venta, aperturas y centros administrativos", () => {
    const porCodigo = Object.fromEntries(informe.centros.map(c => [c.codigo, c]));
    expect(informe.hayCentros).toBe(true);
    expect(porCodigo["01"].esPuntoDeVenta).toBe(false);
    expect(porCodigo["02"]).toMatchObject({ nombre: "02 PRINCIPAL", esPuntoDeVenta: true, esApertura: false, mesesOperacion: 3 });
    expect(porCodigo["04"]).toMatchObject({ esPuntoDeVenta: true, esApertura: true, primerMes: 3, mesesOperacion: 1 });
    expect(porCodigo["04"].utilidadPorMes[1]).toBeNull(); // todavía no vendía
    expect(informe.aperturas.hay).toBe(true);
    expect(informe.aperturas.puntosPorMes).toEqual({ 1: 2, 2: 2, 3: 3 });
    expect(informe.aperturas.ventasAperturas[3]).toBe(50 * M);
  });

  it("reparte la administración entre los puntos según sus ingresos, sin perder ni un peso", () => {
    const puntos = informe.centros.filter(c => c.esPuntoDeVenta);
    const repartido = puntos.reduce((t, c) => t + c.administracion, 0);
    expect(repartido).toBeCloseTo(100 * M - 6 * M, 2); // gastos de administración menos sus otros ingresos
    // Lo que queda en los puntos después del reparto es la utilidad operativa
    // de la empresa (el impuesto de renta no se reparte).
    expect(puntos.reduce((t, c) => t + c.resultado, 0)).toBeCloseTo(informe.acumulado.utilidadOperativa, 2);
    const principal = puntos.find(c => c.codigo === "02")!, norte = puntos.find(c => c.codigo === "03")!;
    expect(principal.administracion / norte.administracion).toBeCloseTo(4, 6);
    expect(principal.estado).toBe("cubre");
    expect(puntos.find(c => c.codigo === "04")!.estado).toBe("no_cubre");
  });

  it("marca la cuenta que se sale de su promedio, una sola vez", () => {
    const sueldos = informe.alertas.filter(a => a.partida === "Sueldos" || /personal \(administraci/i.test(a.partida));
    expect(sueldos).toHaveLength(1);
    expect(sueldos[0]).toMatchObject({ nivel: "revisar", periodo: "Mar" });
    expect(sueldos[0].detalle).toContain("$60,0 M");
  });

  it("junta los meses en pérdida en una sola alerta", () => {
    // Marzo ya pierde (administración de 60 y la apertura); con un gasto más, enero también.
    expect(informe.alertas.filter(a => /p[eé]rdida/i.test(a.partida))).toMatchObject([{ nivel: "critico", periodo: "Mar", partida: "Pérdida del mes" }]);
    const conPerdidas = calcularInformeGestion(entrada({
      saldos: [...saldosDePrueba(), { mes: 1, centroCodigo: "01", cuenta: "530505", tipo: "gasto", valor: 60 * M }],
    }));
    const perdidas = conPerdidas.alertas.filter(a => /p[eé]rdida/i.test(a.partida));
    expect(perdidas).toHaveLength(1);
    expect(perdidas[0]).toMatchObject({ nivel: "critico", periodo: "Ene, Mar", partida: "Pérdida en 2 de 3 meses" });
    expect(perdidas[0].detalle).toContain("Entre todos suman");
    expect(conPerdidas.alertas[0].nivel).toBe("critico"); // las críticas van primero
  });

  it("avisa si el balance no cuadra o si una cuenta de efectivo cierra en rojo", () => {
    const conBalance = calcularInformeGestion(entrada({
      balanceDiferencia: 4_150_000, efectivoNegativo: [{ cuenta: "11100501", nombre: "Banco", saldo: -48 * M }],
    }));
    expect(conBalance.alertas.some(a => a.partida === "El balance no cuadra")).toBe(true);
    expect(conBalance.alertas.some(a => a.partida === "Efectivo con saldo negativo" && a.detalle.includes("-$48,0 M"))).toBe(true);
    expect(calcularInformeGestion(entrada({ balanceDiferencia: 0.4 })).alertas.some(a => a.partida === "El balance no cuadra")).toBe(false);
  });

  it("sin centros de costo no arma secciones de puntos de venta", () => {
    const simple = calcularInformeGestion(entrada({ saldos: saldosDePrueba().map(s => ({ ...s, centroCodigo: "" })), centros: new Map() }));
    expect(simple.hayCentros).toBe(false);
    expect(simple.centros).toEqual([]);
    expect(simple.aperturas.hay).toBe(false);
    expect(simple.acumulado.resultado).toBeCloseTo(informe.acumulado.resultado, 2);
  });
});

describe("informe de gestión: PDF", () => {
  const cliente = { razonSocial: "EMPRESA DE PRUEBA S.A.S.", nit: "900123456-1", ciudad: "Ibagué", departamento: "Tolima", actividadEconomica: "Comercio al por menor", codigoCIIU: "4773", representanteLegal: "Ana Pérez" };
  const paginas = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;

  it("elige marcas redondas para los ejes", () => {
    expect(escala(0, 3124).marcas).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(escala(-230, 190).marcas).toEqual([-400, -200, 0, 200]);
    expect(escala(0, 0).marcas[0]).toBe(0);
  });

  it("genera un PDF con centros, balance y notas", async () => {
    const informe = calcularInformeGestion(entrada({
      balance: { etiquetaInicial: "2025", etiquetaFinal: "Marzo 2026", filas: [{ titulo: "Disponible", inicial: 10 * M, final: 12 * M, total: false }, { titulo: "Total activo", inicial: 10 * M, final: 12 * M, total: true }] },
      notas: { puntos: [{ nivel: "critico", titulo: "IVA", texto: "Revisar el descontable." }], plan: [{ titulo: "Conciliar inventarios", texto: "Antes del 15." }] },
    }));
    const pdf = await generarPdfGestion(informe, cliente, new Date("2026-04-10T12:00:00Z"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(paginas(pdf)).toBeGreaterThanOrEqual(4);
  });

  it("genera el informe de un solo mes sin centros de costo ni datos del cliente", async () => {
    const informe = calcularInformeGestion(entrada({ mesCorte: 1, saldos: saldosDePrueba().map(s => ({ ...s, centroCodigo: "" })), centros: new Map() }));
    const pdf = await generarPdfGestion(informe, { razonSocial: "PERSONA NATURAL", nit: null, ciudad: null, departamento: null, actividadEconomica: null, codigoCIIU: null, representanteLegal: null });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(paginas(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("aguanta doce meses y decenas de puntos de venta (tablas partidas en páginas)", async () => {
    const saldos: SaldoGestion[] = [];
    const centros = new Map<string, string>();
    for (let c = 1; c <= 45; c++) {
      const codigo = String(c).padStart(2, "0");
      centros.set(codigo, `PUNTO DE VENTA CON NOMBRE LARGO NUMERO ${c}`);
      for (let mes = c % 7 === 0 ? 5 : 1; mes <= 12; mes++) {
        saldos.push({ mes, centroCodigo: codigo, cuenta: "413536", tipo: "ingreso", valor: (9000 + c * 31 + mes * 17) * M });
        saldos.push({ mes, centroCodigo: codigo, cuenta: "613536", tipo: "costo", valor: (7000 + c * 20) * M });
        saldos.push({ mes, centroCodigo: codigo, cuenta: "520506", tipo: "gasto", valor: (1500 + (c % 5) * 400) * M });
      }
    }
    const informe = calcularInformeGestion(entrada({ mesCorte: 12, saldos, centros }));
    expect(informe.centros).toHaveLength(45);
    const pdf = await generarPdfGestion(informe, cliente);
    expect(paginas(pdf)).toBeGreaterThan(8);
  });
});
