import ExcelJS from "exceljs";
import { getCentrosCosto, getSaldosDelAnio, getCuentasPucConocidas } from "./informesDb";
import { invokeLLM } from "./_core/llm";
import { MESES, FONT, FONT_BOLD, FONT_TITLE, MONEY, PCT, styleHeaderRow, a4Digitos, finalizarLibro } from "./informesReportUtils";

async function generarObservaciones(resumenTexto: string): Promise<string> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "Eres un analista financiero. A partir de una tabla de resultados por centro de costo (texto plano), escribe un análisis breve (máximo 6 líneas, en español, sin markdown) destacando: los centros con mejor y peor desempeño, cualquier centro con resultado negativo, y una conclusión general del mes. Sé concreto y usa las cifras dadas.",
        },
        { role: "user", content: resumenTexto },
      ],
    });
    return response.choices?.[0]?.message?.content?.toString().trim() || "";
  } catch (error) {
    console.error("[Informes] Generación de observaciones IA falló:", error);
    return "";
  }
}

type TotalesMes = { ingreso: number; costoBruto: number; descuentoPP: number; gasto: number };

/** Estado de Resultados por Centro de Costo (ERI), derivado de los mismos
 * saldos mensuales del ERM. Agrupa las cuentas a nivel de 4 dígitos (ej.
 * 5105) — el nivel de detalle de subcuenta (6+ dígitos) no aplica aquí, es
 * exclusivo del ERM cuando se pide a detalle. Solo tiene sentido para
 * clientes que manejan centro de costo. */
export async function generarReporteERI(clienteId: number, anio: number, mes: number): Promise<Buffer> {
  const centrosCatalogo = await getCentrosCosto(clienteId);
  const centros = centrosCatalogo.filter(c => c.activo).map(c => c.codigo).sort();
  const nombres: Record<string, string> = {};
  for (const c of centrosCatalogo) nombres[c.codigo] = c.nombre;

  const cuentasConocidas = await getCuentasPucConocidas();
  const saldosAnio = await getSaldosDelAnio(clienteId, anio);

  const serie: Record<string, { ingreso: number[]; costoBruto: number[]; descuentoPP: number[]; gasto: number[] }> = {};
  const totalesMesActual: Record<string, TotalesMes> = {};
  const detalleMesActual: Record<string, Record<string, { tipo: string; valor: number }>> = {};

  for (const c of centros) {
    serie[c] = {
      ingreso: new Array(mes).fill(0), costoBruto: new Array(mes).fill(0),
      descuentoPP: new Array(mes).fill(0), gasto: new Array(mes).fill(0),
    };
    totalesMesActual[c] = { ingreso: 0, costoBruto: 0, descuentoPP: 0, gasto: 0 };
    detalleMesActual[c] = {};
  }

  for (const fila of saldosAnio) {
    const c = fila.centroCodigo;
    if (!serie[c] || fila.mes > mes) continue;
    const m = fila.mes - 1;
    if (fila.tipo === "ingreso") serie[c].ingreso[m] += fila.valor;
    else if (fila.tipo === "costo") serie[c].costoBruto[m] += fila.valor;
    else if (fila.tipo === "descuento_pp") serie[c].descuentoPP[m] += fila.valor;
    else if (fila.tipo === "gasto") serie[c].gasto[m] += fila.valor;

    if (fila.mes === mes) {
      const t = totalesMesActual[c];
      if (fila.tipo === "ingreso") t.ingreso += fila.valor;
      else if (fila.tipo === "costo") t.costoBruto += fila.valor;
      else if (fila.tipo === "descuento_pp") t.descuentoPP += fila.valor;
      else if (fila.tipo === "gasto") t.gasto += fila.valor;
      // Se agrupa a nivel de 4 dígitos para este reporte (el detalle de
      // subcuenta es exclusivo del ERM en modo "detalle").
      const cuenta4 = fila.tipo === "descuento_pp" ? fila.cuenta : a4Digitos(fila.cuenta);
      if (!detalleMesActual[c][cuenta4]) detalleMesActual[c][cuenta4] = { tipo: fila.tipo, valor: 0 };
      detalleMesActual[c][cuenta4].valor += fila.valor;
    }
  }
  const costoNeto = (t: TotalesMes) => t.costoBruto - t.descuentoPP;
  const utilidad = (t: TotalesMes) => t.ingreso - costoNeto(t) - t.gasto;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";
  const mesNombre = MESES[mes];

  const wsHist = wb.addWorksheet("Histórico Mensual");
  wsHist.addRow(["Centro", "Nombre", "Mes", "Ingreso", "Costo neto", "Gasto", "Utilidad", "Costo bruto", "Descuento PP"]).font = FONT_BOLD as any;
  for (const c of centros) {
    for (let m = 0; m < mes; m++) {
      const ing = serie[c].ingreso[m], bruto = serie[c].costoBruto[m], desc = serie[c].descuentoPP[m], gas = serie[c].gasto[m];
      const neto = bruto - desc;
      wsHist.addRow([c, nombres[c], MESES[m + 1], ing, neto, gas, ing - neto - gas, bruto, desc]);
    }
  }
  [4, 5, 6, 7, 8, 9].forEach(i => wsHist.getColumn(i).numFmt = MONEY);
  wsHist.columns.forEach(col => col.width = 14);
  wsHist.state = "hidden";
  const histLastRow = wsHist.rowCount;

  const wsResumen = wb.addWorksheet(`Resumen ${mesNombre} ${anio}`);
  wsResumen.addRow([`ESTADO DE RESULTADOS POR CENTRO DE COSTO · ${mesNombre} ${anio}`]).font = FONT_TITLE as any;
  wsResumen.addRow(["Ingresos cuenta 4 · Costo cuenta 6 (bruto y neto de pronto pago, por separado) · Gastos cuenta 5"]).font = { name: "Arial", size: 9, italic: true } as any;
  wsResumen.addRow([]);
  const head = wsResumen.addRow(["Centro", "Ingresos", "Costo bruto", "Desc. pronto pago", "Costo neto", "Utilidad bruta", "% bruto", "Gastos", "Resultado", "% resultado"]);
  styleHeaderRow(head);
  const firstDataRow = wsResumen.rowCount + 1;
  let resumenTextoIA = "";
  centros.forEach((c, i) => {
    const r = firstDataRow + i;
    const t = totalesMesActual[c];
    wsResumen.addRow([
      `${c} · ${nombres[c]}`, t.ingreso, t.costoBruto, t.descuentoPP,
      { formula: `C${r}-D${r}` },
      { formula: `B${r}-E${r}` }, { formula: `F${r}/B${r}` },
      t.gasto, { formula: `F${r}-H${r}` }, { formula: `I${r}/B${r}` },
    ]);
    resumenTextoIA += `${nombres[c]}: ingresos ${t.ingreso.toFixed(0)}, resultado ${utilidad(t).toFixed(0)}\n`;
  });
  const lastDataRow = firstDataRow + centros.length - 1;
  const totalRow = wsResumen.addRow(["TOTAL COMPAÑÍA",
    { formula: `SUM(B${firstDataRow}:B${lastDataRow})` },
    { formula: `SUM(C${firstDataRow}:C${lastDataRow})` },
    { formula: `SUM(D${firstDataRow}:D${lastDataRow})` },
    null, null, null,
    { formula: `SUM(H${firstDataRow}:H${lastDataRow})` }, null, null]);
  const tr = totalRow.number;
  totalRow.getCell(5).value = { formula: `C${tr}-D${tr}` } as any;
  totalRow.getCell(6).value = { formula: `B${tr}-E${tr}` } as any;
  totalRow.getCell(7).value = { formula: `F${tr}/B${tr}` } as any;
  totalRow.getCell(9).value = { formula: `F${tr}-H${tr}` } as any;
  totalRow.getCell(10).value = { formula: `I${tr}/B${tr}` } as any;
  totalRow.font = FONT_BOLD as any;
  [2, 3, 4, 5, 6, 8, 9].forEach(ci => wsResumen.getColumn(ci).numFmt = MONEY);
  [7, 10].forEach(ci => wsResumen.getColumn(ci).numFmt = PCT);
  wsResumen.getColumn(1).width = 28;
  for (let i = 2; i <= 10; i++) wsResumen.getColumn(i).width = 15;

  const obs = await generarObservaciones(resumenTextoIA);
  if (obs) {
    wsResumen.addRow([]);
    const rObsTitulo = wsResumen.addRow(["OBSERVACIONES (generadas por IA)"]);
    rObsTitulo.font = FONT_BOLD as any;
    const rObs = wsResumen.addRow([obs]);
    wsResumen.mergeCells(rObs.number, 1, rObs.number, 10);
    rObs.getCell(1).alignment = { wrapText: true, vertical: "top" };
    wsResumen.getRow(rObs.number).height = 90;
  }

  for (const c of centros) {
    const sheetName = `${c} ${nombres[c]}`.slice(0, 31);
    const ws = wb.addWorksheet(sheetName);
    ws.addRow([`CENTRO ${c} · ${nombres[c]} · Estado de Resultados · ${mesNombre} ${anio}`]).font = FONT_TITLE as any;
    ws.addRow([]);
    const h = ws.addRow(["Cuenta", "Descripción", "Tipo", `Valor ${mesNombre}`]);
    styleHeaderRow(h);

    const cuentas = detalleMesActual[c] || {};
    const grupos: Record<string, [string, number][]> = { ingreso: [], costo: [], descuento_pp: [], gasto: [] };
    for (const [cuenta, obj] of Object.entries(cuentas)) grupos[obj.tipo].push([cuenta, obj.valor]);
    for (const tipo of Object.keys(grupos)) grupos[tipo].sort((a, b) => a[0].localeCompare(b[0]));

    const addGrupo = (titulo: string, tipo: string): number => {
      const rTitulo = ws.addRow([titulo]); rTitulo.font = FONT_BOLD as any;
      const startRow = ws.rowCount + 1;
      for (const [cuenta, valor] of grupos[tipo]) {
        ws.addRow([cuenta, cuentasConocidas.get(cuenta)?.descripcion || "", tipo, valor]);
      }
      const endRow = ws.rowCount;
      const rTot = ws.addRow([null, null, `Total ${titulo.toLowerCase()}`,
        endRow >= startRow ? { formula: `SUM(D${startRow}:D${endRow})` } : 0]);
      rTot.font = FONT_BOLD as any;
      return rTot.number;
    };
    const rowIng = addGrupo("INGRESOS", "ingreso");
    const rowCosBruto = addGrupo("COSTO DE VENTA (BRUTO)", "costo");
    const rowDescPP = addGrupo("(-) DESCUENTO PRONTO PAGO", "descuento_pp");
    const rCostoNeto = ws.addRow([null, null, "Costo neto de venta", { formula: `D${rowCosBruto}-D${rowDescPP}` }]);
    rCostoNeto.font = FONT_BOLD as any;
    const rowGas = addGrupo("GASTOS", "gasto");
    ws.addRow([]);
    const rUtil = ws.addRow([null, null, "UTILIDAD", { formula: `D${rowIng}-D${rCostoNeto.number}-D${rowGas}` }]);
    rUtil.font = FONT_BOLD as any;
    const rMargen = ws.addRow([null, null, "% Margen sobre ventas", { formula: `D${rUtil.number}/D${rowIng}` }]);
    const rTasaPP = ws.addRow([null, null, "% Descuento pronto pago s/costo bruto",
      { formula: `IF(D${rowCosBruto}=0,0,D${rowDescPP}/D${rowCosBruto})` }]);

    ws.addRow([]);
    ws.addRow(["PUNTO DE EQUILIBRIO (promedio del año a la fecha, sobre costo neto)"]).font = FONT_BOLD as any;
    const rVentasProm = ws.addRow(["Ventas promedio año", null, null,
      { formula: `AVERAGEIF('Histórico Mensual'!A2:A${histLastRow},"${c}",'Histórico Mensual'!D2:D${histLastRow})` }]);
    const rMargenProm = ws.addRow(["% Margen bruto promedio año", null, null,
      { formula: `(D${rVentasProm.number}-AVERAGEIF('Histórico Mensual'!A2:A${histLastRow},"${c}",'Histórico Mensual'!E2:E${histLastRow}))/D${rVentasProm.number}` }]);
    const rGastosProm = ws.addRow(["Gastos promedio año", null, null,
      { formula: `AVERAGEIF('Histórico Mensual'!A2:A${histLastRow},"${c}",'Histórico Mensual'!F2:F${histLastRow})` }]);
    const rPE = ws.addRow(["Punto de equilibrio (ventas/mes)", null, null,
      { formula: `D${rGastosProm.number}/D${rMargenProm.number}` }]);
    ws.addRow(["Estado del mes actual", null, null,
      { formula: `IF(D${rowIng}>=D${rPE.number},"OK","NO ALCANZA")` }]);

    ws.getColumn(1).width = 12; ws.getColumn(2).width = 34; ws.getColumn(3).width = 26; ws.getColumn(4).width = 18;
    ws.getColumn(4).numFmt = MONEY;
    ws.getCell(`D${rMargenProm.number}`).numFmt = PCT;
    ws.getCell(`D${rMargen.number}`).numFmt = PCT;
    ws.getCell(`D${rTasaPP.number}`).numFmt = PCT;
  }

  const wsPE = wb.addWorksheet("Punto de Equilibrio");
  wsPE.addRow(["PUNTO DE EQUILIBRIO POR CENTRO DE COSTO (sobre costo neto de pronto pago)", `Promedio Enero-${mesNombre} ${anio}`]).font = FONT_TITLE as any;
  wsPE.addRow([]);
  const hPE = wsPE.addRow(["Centro", "Ventas prom. año", "% Margen prom.", "Gastos prom. año", "Punto equilibrio", `Ventas ${mesNombre}`, "Estado"]);
  styleHeaderRow(hPE);
  const peFirstRow = wsPE.rowCount + 1;
  centros.forEach((c, i) => {
    const r = peFirstRow + i;
    wsPE.addRow([
      `${c} · ${nombres[c]}`,
      { formula: `AVERAGEIF('Histórico Mensual'!A2:A${histLastRow},"${c}",'Histórico Mensual'!D2:D${histLastRow})` },
      { formula: `(B${r}-AVERAGEIF('Histórico Mensual'!A2:A${histLastRow},"${c}",'Histórico Mensual'!E2:E${histLastRow}))/B${r}` },
      { formula: `AVERAGEIF('Histórico Mensual'!A2:A${histLastRow},"${c}",'Histórico Mensual'!F2:F${histLastRow})` },
      { formula: `D${r}/C${r}` },
      totalesMesActual[c].ingreso,
      { formula: `IF(F${r}>=E${r},"OK","NO ALCANZA")` },
    ]);
  });
  [2, 4, 5, 6].forEach(ci => wsPE.getColumn(ci).numFmt = MONEY);
  wsPE.getColumn(3).numFmt = PCT;
  wsPE.getColumn(1).width = 28;
  for (let i = 2; i <= 7; i++) wsPE.getColumn(i).width = 16;

  const wsPareto = wb.addWorksheet("Pareto y Tendencia");
  wsPareto.addRow([`PARETO DE UTILIDAD POR CENTRO DE COSTO · ${mesNombre} ${anio}`]).font = FONT_TITLE as any;
  wsPareto.addRow([]);
  const utilActual = centros.map(c => ({ c, utilidad: utilidad(totalesMesActual[c]) }))
    .sort((a, b) => b.utilidad - a.utilidad);
  const mesesHeaders = Array.from({ length: mes }, (_, m) => `Util. ${MESES[m + 1]}`);
  const hPar = wsPareto.addRow(["Centro", `Utilidad ${mesNombre}`, "% del total", "% acumulado", ...mesesHeaders]);
  styleHeaderRow(hPar);
  const parFirstRow = wsPareto.rowCount + 1;
  utilActual.forEach(({ c }) => {
    const mensuales = serie[c].ingreso.map((ing, m) =>
      ing - (serie[c].costoBruto[m] - serie[c].descuentoPP[m]) - serie[c].gasto[m]);
    wsPareto.addRow([`${c} · ${nombres[c]}`, mensuales[mes - 1], null, null, ...mensuales]);
  });
  const parLastRow = parFirstRow + utilActual.length - 1;
  for (let r = parFirstRow; r <= parLastRow; r++) {
    wsPareto.getCell(`C${r}`).value = { formula: `B${r}/SUM($B$${parFirstRow}:$B$${parLastRow})` } as any;
    wsPareto.getCell(`D${r}`).value = { formula: `SUM($C$${parFirstRow}:C${r})` } as any;
  }
  wsPareto.getColumn(2).numFmt = MONEY;
  for (let i = 5; i < 5 + mes; i++) wsPareto.getColumn(i).numFmt = MONEY;
  [3, 4].forEach(ci => wsPareto.getColumn(ci).numFmt = PCT);
  wsPareto.getColumn(1).width = 28;

  const wsPP = wb.addWorksheet("Pronto Pago");
  wsPP.addRow([`ANÁLISIS DESCUENTO POR PRONTO PAGO · Enero–${mesNombre} ${anio}`]).font = FONT_TITLE as any;
  wsPP.addRow([]);
  wsPP.addRow(["Resumen mensual (todos los centros)"]).font = FONT_BOLD as any;
  const hPPMes = wsPP.addRow(["Mes", "Costo bruto", "Descuento PP", "Costo neto", "% Descuento s/bruto"]);
  styleHeaderRow(hPPMes);
  const ppMesFirstRow = wsPP.rowCount + 1;
  for (let m = 0; m < mes; m++) {
    const bruto = centros.reduce((acc, c) => acc + serie[c].costoBruto[m], 0);
    const desc = centros.reduce((acc, c) => acc + serie[c].descuentoPP[m], 0);
    const r = ppMesFirstRow + m;
    wsPP.addRow([MESES[m + 1], bruto, desc, { formula: `B${r}-C${r}` }, { formula: `C${r}/B${r}` }]);
  }
  const ppMesLastRow = ppMesFirstRow + mes - 1;
  const rTotMes = wsPP.addRow(["TOTAL",
    { formula: `SUM(B${ppMesFirstRow}:B${ppMesLastRow})` },
    { formula: `SUM(C${ppMesFirstRow}:C${ppMesLastRow})` }, null, null]);
  rTotMes.getCell(4).value = { formula: `B${rTotMes.number}-C${rTotMes.number}` } as any;
  rTotMes.getCell(5).value = { formula: `C${rTotMes.number}/B${rTotMes.number}` } as any;
  rTotMes.font = FONT_BOLD as any;
  [2, 3, 4].forEach(ci => wsPP.getColumn(ci).numFmt = MONEY);
  wsPP.getColumn(5).numFmt = PCT;

  wsPP.addRow([]);
  wsPP.addRow([]);
  wsPP.addRow(["Descuento pronto pago por centro de costo (acumulado del año a la fecha)"]).font = FONT_BOLD as any;
  const hPPCentro = wsPP.addRow(["Centro", "Descuento PP acumulado", "Costo bruto acumulado", "% Descuento s/bruto"]);
  styleHeaderRow(hPPCentro);
  const ppCentroFirstRow = wsPP.rowCount + 1;
  const filasPPCentro = centros.map(c => {
    const desc = serie[c].descuentoPP.reduce((a, b) => a + b, 0);
    const bruto = serie[c].costoBruto.reduce((a, b) => a + b, 0);
    return { c, desc, bruto };
  }).sort((a, b) => b.desc - a.desc);
  filasPPCentro.forEach(({ c, desc, bruto }, i) => {
    const r = ppCentroFirstRow + i;
    wsPP.addRow([`${c} · ${nombres[c]}`, desc, bruto, { formula: `IF(C${r}=0,0,B${r}/C${r})` }]);
  });
  [2, 3].forEach(ci => wsPP.getColumn(ci).numFmt = MONEY);
  wsPP.getColumn(4).numFmt = PCT;
  wsPP.getColumn(1).width = 28;
  wsPP.getColumn(2).width = 20; wsPP.getColumn(3).width = 20;

  finalizarLibro(wb);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
