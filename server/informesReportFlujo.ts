import ExcelJS from "exceljs";
import { getCatalogoCliente } from "./informesDb";
import { armarInformeFlujo, listarDetalleFlujo, type InformeFlujo } from "./informesFlujoDb";
import { NOMBRES_PUC } from "./informesFlujoPuc";
import {
  MESES, MESES_CORTO, FONT_BOLD, FONT_TITLE, MONEY, styleHeaderRow, styleSubtotalRow, colLetter, finalizarLibro,
} from "./informesReportUtils";

/** FLUJO DE EFECTIVO comparativo del año (meses en columnas), con la
 * misma estructura del libro modelo: el flujo con fórmulas, la validación
 * del grupo de documentos, la agrupación por cuenta, el detalle por
 * subcuenta y las cuentas de efectivo con sus saldos. Cada fórmula lleva
 * además su resultado ya calculado, para que el libro se lea igual en
 * visores que no recalculan. */

const HOJA_FLUJO = "Flujo de efectivo";
const HOJA_VALIDACION = "Validación";
const HOJA_AGRUPACION = "Agrupación";
const HOJA_DETALLE = "Detalle por subcuenta";
const HOJA_EFECTIVO = "Cuentas de efectivo";
const ENTERO = "#,##0";
const NOTA = { name: "Arial", size: 9, italic: true, color: { argb: "FF6B5F5B" } };

type Formula = { formula: string; result: number | string };
const f = (formula: string, result: number | string): Formula => ({ formula, result });
const ref = (hoja: string) => `'${hoja}'!`;

export function construirLibroFlujo(
  informe: InformeFlujo, cliente: { razonSocial: string; nit: string | null },
  detalle: { mes: number; clase: string; cuenta: string; tipoDocumento: string; debitos: number; creditos: number; documentos: number; lineas: number }[],
  catalogo: Map<string, string>,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";
  const { meses, anio } = informe;
  const n = meses.length;

  // Las hojas se crean en el orden en que se leen; se llenan en el orden
  // en que unas dependen de otras.
  const wsFlujo = wb.addWorksheet(HOJA_FLUJO);
  const wsVal = wb.addWorksheet(HOJA_VALIDACION);
  const wsAgr = wb.addWorksheet(HOJA_AGRUPACION);
  const wsDet = wb.addWorksheet(HOJA_DETALLE);
  const wsEfe = wb.addWorksheet(HOJA_EFECTIVO);

  // =================== Cuentas de efectivo (una fila por cuenta y mes) ===================
  styleHeaderRow(wsEfe.addRow([
    "Mes", "Nombre del mes", "Cuenta", "Nombre", "Grupo", "Saldo inicial", "Débitos", "Créditos",
    "Variación del mes (débitos − créditos)", "Saldo final calculado", "Saldo final contabilidad", "Diferencia (calculado − contabilidad)",
    "Origen de los saldos",
  ]));
  for (const m of meses) {
    for (const e of informe.efectivo) {
      const c = e.porMes[m];
      if (!c?.requerida) continue;
      const r = wsEfe.addRow([m, MESES[m], e.cuenta, e.nombre, e.grupo, c.saldoInicial, c.debitos, c.creditos]);
      const i = r.number;
      r.getCell(9).value = f(`G${i}-H${i}`, c.variacion);
      if (c.saldoInicial !== null) r.getCell(10).value = f(`F${i}+I${i}`, c.finalCalculado!);
      r.getCell(11).value = c.saldoFinal;
      if (c.diferencia !== null) r.getCell(12).value = f(`J${i}-K${i}`, c.diferencia);
      r.getCell(13).value = c.origen === "balance" ? "Balance de prueba" : c.origen === "digitado" ? "Digitado" : "";
    }
  }
  const finEfe = Math.max(wsEfe.rowCount, 2);
  for (let c = 6; c <= 12; c++) wsEfe.getColumn(c).numFmt = MONEY;
  [6, 16, 14, 34, 8, 16, 16, 16, 20, 18, 18, 20, 20].forEach((w, i) => { wsEfe.getColumn(i + 1).width = w; });
  wsEfe.views = [{ state: "frozen", ySplit: 1 }];
  wsEfe.addRow([]);
  wsEfe.addRow(["Los saldos inicial y final salen del balance de prueba del mes cuando está cargado; si no, los digita el contador por cada cuenta. Una celda vacía es un saldo todavía sin digitar."]).font = NOTA as any;
  const rangoEfe = (col: string) => `${ref(HOJA_EFECTIVO)}$${col}$2:$${col}$${finEfe}`;

  // =================== Agrupación (una fila por cuenta contrapartida) ===================
  const colMesAgr = (i: number) => 4 + i; // A cuenta, B nombre, C sección, D… meses
  const colTotalAgr = 4 + n;
  styleHeaderRow(wsAgr.addRow(["Cuenta", "Nombre", "Sección del flujo", ...meses.map(m => `Neto ${MESES_CORTO[m]}`), "Neto acumulado (créditos − débitos)", "Débitos", "Créditos"]));
  const filasAgr: { codigo: string; nombre: string; seccion: string; netos: Record<number, number>; debitos: number | null; creditos: number | null }[] = [
    ...informe.secciones.flatMap(s => s.filas.map(x => ({ codigo: x.cuenta, nombre: x.nombre, seccion: s.titulo, netos: x.netos, debitos: x.debitos, creditos: x.creditos }))),
    ...informe.sinEfecto.map(x => ({ codigo: x.codigo, nombre: x.nombre, seccion: "Sin efecto en caja", netos: x.valores, debitos: null, creditos: null })),
  ];
  for (const x of filasAgr) {
    const r = wsAgr.addRow([x.codigo, x.nombre, x.seccion, ...meses.map(m => x.netos[m] || 0)]);
    r.getCell(colTotalAgr).value = n > 0
      ? f(`SUM(${colLetter(colMesAgr(0))}${r.number}:${colLetter(colMesAgr(n - 1))}${r.number})`, meses.reduce((s, m) => s + (x.netos[m] || 0), 0))
      : 0;
    if (x.debitos !== null) { r.getCell(colTotalAgr + 1).value = x.debitos; r.getCell(colTotalAgr + 2).value = x.creditos; }
  }
  const finAgr = Math.max(wsAgr.rowCount, 2);
  const totAgr = wsAgr.addRow(["Total"]);
  for (let c = 4; c <= colTotalAgr; c++) {
    const L = colLetter(c);
    const valor = c < colTotalAgr
      ? filasAgr.reduce((s, x) => s + (x.netos[meses[c - 4]] || 0), 0)
      : filasAgr.reduce((s, x) => s + meses.reduce((t, m) => t + (x.netos[m] || 0), 0), 0);
    totAgr.getCell(c).value = f(`SUM(${L}2:${L}${finAgr})`, valor);
  }
  styleSubtotalRow(totAgr);
  for (let c = 4; c <= colTotalAgr + 2; c++) { wsAgr.getColumn(c).numFmt = MONEY; wsAgr.getColumn(c).width = 16; }
  wsAgr.getColumn(1).width = 12; wsAgr.getColumn(2).width = 48; wsAgr.getColumn(3).width = 22;
  wsAgr.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  const sumifAgr = (i: number, fila: number) =>
    `SUMIFS(${ref(HOJA_AGRUPACION)}$${colLetter(colMesAgr(i))}$2:$${colLetter(colMesAgr(i))}$${finAgr},${ref(HOJA_AGRUPACION)}$A$2:$A$${finAgr},$A${fila})`;

  // =================== Flujo de efectivo ===================
  const colMes = (i: number) => 3 + i; // A código, B nombre, C… meses
  const colAcum = 3 + n;
  const colObs = colAcum + 1;
  wsFlujo.addRow([`ESTADO DE FLUJO DE EFECTIVO · ${anio}`]).font = FONT_TITLE as any;
  wsFlujo.addRow([cliente.razonSocial]).font = FONT_BOLD as any;
  wsFlujo.addRow([cliente.nit ? `NIT. ${cliente.nit}` : ""]);
  wsFlujo.addRow([`Método: documentos del libro auxiliar que afectan caja o bancos (${informe.prefijos.join(", ")}), agrupados por cuenta contrapartida.`]).font = NOTA as any;
  wsFlujo.addRow([]);
  styleHeaderRow(wsFlujo.addRow(["CÓDIGO", "N. CÓDIGO", ...meses.map(m => `${MESES_CORTO[m].toUpperCase()} ${anio}`), "ACUMULADO", "OBSERVACIONES"]));

  const acumular = (r: ExcelJS.Row, total: number) => {
    r.getCell(colAcum).value = n > 0 ? f(`SUM(${colLetter(colMes(0))}${r.number}:${colLetter(colMes(n - 1))}${r.number})`, total) : 0;
  };
  const escribirSeccion = (titulo: string, s: InformeFlujo["secciones"][number], signo: 1 | -1, nombreTotal: string): number => {
    wsFlujo.addRow([titulo]).font = FONT_BOLD as any;
    const inicio = wsFlujo.rowCount + 1;
    for (const x of s.filas) {
      const r = wsFlujo.addRow([x.cuenta, x.nombre]);
      meses.forEach((m, i) => { r.getCell(colMes(i)).value = f(`${signo === 1 ? "" : "-"}${sumifAgr(i, r.number)}`, x.valores[m]); });
      acumular(r, x.total);
      r.getCell(colObs).value = x.observacion;
    }
    const fin = wsFlujo.rowCount;
    const t = wsFlujo.addRow([nombreTotal]);
    for (let c = colMes(0); c <= colAcum; c++) {
      const L = colLetter(c);
      const valor = c < colAcum ? s.totales[meses[c - 3]] : s.total;
      t.getCell(c).value = fin >= inicio ? f(`SUM(${L}${inicio}:${L}${fin})`, valor) : 0;
    }
    styleSubtotalRow(t);
    return t.number;
  };
  const seccion = (clave: string) => informe.secciones.find(s => s.seccion === clave)!;
  /** Fila de resultado: una fórmula por columna (meses y acumulado). */
  const filaCalculada = (titulo: string, formula: (L: string) => string, valor: (m: number | null) => number | string, resaltar = false) => {
    const r = wsFlujo.addRow([titulo]);
    for (let c = colMes(0); c <= colAcum; c++) {
      const v = valor(c < colAcum ? meses[c - 3] : null);
      r.getCell(c).value = f(formula(colLetter(c)), v);
    }
    if (resaltar) styleSubtotalRow(r); else r.font = FONT_BOLD as any;
    return r.number;
  };
  const R = informe.resumen;
  const A = informe.acumulado;

  const fRec = escribirSeccion("Recaudos", seccion("recaudos"), 1, "Total recaudos");
  wsFlujo.addRow([]);
  const fEgr = escribirSeccion("Egresos de operación", seccion("egresos_operacion"), -1, "Total egresos de operación");
  wsFlujo.addRow([]);
  const fOpe = filaCalculada("Total flujo operativo", L => `${L}${fRec}-${L}${fEgr}`, m => (m ? R[m].operativo : A.operativo), true);
  wsFlujo.addRow([]);
  // "Inversión" solo aparece si el contador asignó alguna cuenta a esa sección.
  let fInv: number | null = null;
  if (seccion("inversion").filas.length > 0) {
    fInv = escribirSeccion("Flujo de inversión", seccion("inversion"), -1, "Total flujo de inversión");
    wsFlujo.addRow([]);
  }
  const fFin = escribirSeccion("Flujo de financiación", seccion("financiacion"), -1, "Total flujo de financiación");
  wsFlujo.addRow([]);
  const fAum = filaCalculada(
    "Aumento neto (disminución neta) de efectivo y equivalentes al efectivo",
    L => `${L}${fOpe}${fInv ? `-${L}${fInv}` : ""}-${L}${fFin}`, m => (m ? R[m].aumentoNeto : A.aumentoNeto), true,
  );

  // ---- Conciliación contra los saldos digitados ----
  const SIN_SALDOS = "Sin saldos";
  const rIni = wsFlujo.addRow(["Efectivo y equivalentes al efectivo al inicio del periodo"]);
  const rCal = wsFlujo.addRow(["Efectivo y equivalentes al efectivo al corte (calculado)"]);
  const rCon = wsFlujo.addRow(["Efectivo y equivalentes al efectivo al corte (contabilidad)"]);
  const rVar = wsFlujo.addRow(["Variación (calculado − contabilidad)"]);
  const rEst = wsFlujo.addRow(["Conciliación"]);
  meses.forEach((m, i) => {
    const L = colLetter(colMes(i));
    const x = R[m];
    if (!x.saldosCompletos) {
      for (const r of [rIni, rCal, rCon, rVar]) { r.getCell(colMes(i)).value = SIN_SALDOS; r.getCell(colMes(i)).alignment = { horizontal: "right" }; }
      rEst.getCell(colMes(i)).value = x.cuentasSinSaldo === 1 ? "Falta el saldo de 1 cuenta" : `Faltan los saldos de ${x.cuentasSinSaldo} cuentas`;
      return;
    }
    rIni.getCell(colMes(i)).value = f(`SUMIFS(${rangoEfe("F")},${rangoEfe("A")},${m})`, x.saldoInicial!);
    rCal.getCell(colMes(i)).value = f(`${L}${fAum}+${L}${rIni.number}`, x.finalCalculado!);
    rCon.getCell(colMes(i)).value = f(`SUMIFS(${rangoEfe("K")},${rangoEfe("A")},${m})`, x.saldoFinal!);
    rVar.getCell(colMes(i)).value = f(`${L}${rCal.number}-${L}${rCon.number}`, x.variacion!);
    rEst.getCell(colMes(i)).value = f(`IF(ABS(${L}${rVar.number})<1,"Cuadra","Revisar diferencia")`, Math.abs(x.variacion!) < 1 ? "Cuadra" : "Revisar diferencia");
  });
  // Acumulado: inicial del primer mes y final del último, si todos los
  // meses tienen saldos y van seguidos.
  if (n > 0) {
    const La = colLetter(colAcum);
    if (A.saldosCompletos) {
      rIni.getCell(colAcum).value = f(`${colLetter(colMes(0))}${rIni.number}`, A.saldoInicial!);
      rCal.getCell(colAcum).value = f(`${La}${fAum}+${La}${rIni.number}`, A.finalCalculado!);
      rCon.getCell(colAcum).value = f(`${colLetter(colMes(n - 1))}${rCon.number}`, A.saldoFinal!);
      rVar.getCell(colAcum).value = f(`${La}${rCal.number}-${La}${rCon.number}`, A.variacion!);
      rEst.getCell(colAcum).value = f(`IF(ABS(${La}${rVar.number})<1,"Cuadra","Revisar diferencia")`, Math.abs(A.variacion!) < 1 ? "Cuadra" : "Revisar diferencia");
    } else {
      for (const r of [rIni, rCal, rCon, rVar]) { r.getCell(colAcum).value = "—"; r.getCell(colAcum).alignment = { horizontal: "right" }; }
    }
  }
  rIni.getCell(colObs).value = "Del balance de prueba del mes o, si no está cargado, digitado por el contador; cuenta por cuenta en la hoja «Cuentas de efectivo»";
  rCon.getCell(colObs).value = "Del balance de prueba del mes o, si no está cargado, digitado por el contador; cuenta por cuenta en la hoja «Cuentas de efectivo»";
  rVar.getCell(colObs).value = "Menos de $1 son centavos del auxiliar; más que eso, los saldos no coinciden con el movimiento del auxiliar";
  for (const r of [rIni, rCal, rCon]) r.font = FONT_BOLD as any;
  styleSubtotalRow(rVar);
  rEst.eachCell(c => { c.alignment = { horizontal: Number(c.col) === 1 ? "left" : "right" }; });
  rEst.font = NOTA as any;

  // ---- Movimientos sin efecto en caja ----
  if (informe.sinEfecto.length > 0) {
    wsFlujo.addRow([]);
    wsFlujo.addRow(["Movimientos sin efecto en caja dentro de los documentos seleccionados (se excluyen del flujo)"]).font = FONT_BOLD as any;
    const inicio = wsFlujo.rowCount + 1;
    for (const x of informe.sinEfecto) {
      const r = wsFlujo.addRow([x.codigo, x.nombre]);
      meses.forEach((m, i) => { r.getCell(colMes(i)).value = f(sumifAgr(i, r.number), x.valores[m]); });
      acumular(r, x.total);
      r.getCell(colObs).value = "Cada factura de venta registra el costo contra el inventario en el mismo documento";
    }
    const fin = wsFlujo.rowCount;
    const t = wsFlujo.addRow(["Neto (debe ser cero)"]);
    for (let c = colMes(0); c <= colAcum; c++) {
      const L = colLetter(c);
      const valor = informe.sinEfecto.reduce((s, x) => s + (c < colAcum ? x.valores[meses[c - 3]] : x.total), 0);
      t.getCell(c).value = f(`SUM(${L}${inicio}:${L}${fin})`, Math.round(valor * 100) / 100);
    }
    t.font = FONT_BOLD as any;
  }

  // ---- Verificación con las cuentas de efectivo ----
  wsFlujo.addRow([]);
  wsFlujo.addRow(["Verificación con el movimiento de las cuentas de efectivo"]).font = FONT_BOLD as any;
  const grupos = Array.from(new Set(informe.efectivo.map(e => e.grupo))).sort();
  const inicioVer = wsFlujo.rowCount + 1;
  for (const g of grupos) {
    const r = wsFlujo.addRow([g, NOMBRES_PUC[g] || catalogo.get(g) || "Efectivo"]);
    let total = 0;
    meses.forEach((m, i) => {
      const valor = informe.efectivo.filter(e => e.grupo === g).reduce((s, e) => s + (e.porMes[m]?.variacion || 0), 0);
      total += valor;
      r.getCell(colMes(i)).value = f(`SUMIFS(${rangoEfe("I")},${rangoEfe("A")},${m},${rangoEfe("E")},$A${r.number})`, Math.round(valor * 100) / 100);
    });
    acumular(r, Math.round(total * 100) / 100);
  }
  const finVer = wsFlujo.rowCount;
  const variacionMes = (m: number) => informe.estados.find(e => e.mes === m)?.variacionEfectivo || 0;
  const variacionAcum = Math.round(meses.reduce((s, m) => s + variacionMes(m), 0) * 100) / 100;
  const rTotVar = wsFlujo.addRow(["Total variación cuentas de efectivo"]);
  for (let c = colMes(0); c <= colAcum; c++) {
    const L = colLetter(c);
    rTotVar.getCell(c).value = finVer >= inicioVer ? f(`SUM(${L}${inicioVer}:${L}${finVer})`, c < colAcum ? variacionMes(meses[c - 3]) : variacionAcum) : 0;
  }
  rTotVar.font = FONT_BOLD as any;
  const rDif = wsFlujo.addRow(["Diferencia contra el aumento neto del flujo"]);
  for (let c = colMes(0); c <= colAcum; c++) {
    const L = colLetter(c);
    const valor = c < colAcum ? variacionMes(meses[c - 3]) - R[meses[c - 3]].aumentoNeto : variacionAcum - A.aumentoNeto;
    rDif.getCell(c).value = f(`${L}${rTotVar.number}-${L}${fAum}`, Math.round(valor * 100) / 100);
  }
  rDif.getCell(colObs).value = "Debe ser cero: solo es distinta si hay documentos descuadrados";
  rDif.font = FONT_BOLD as any;

  for (let c = colMes(0); c <= colAcum; c++) { wsFlujo.getColumn(c).numFmt = MONEY; wsFlujo.getColumn(c).width = 17; }
  wsFlujo.getColumn(1).width = 12; wsFlujo.getColumn(2).width = 52; wsFlujo.getColumn(colObs).width = 90;
  wsFlujo.views = [{ state: "frozen", ySplit: 6, xSplit: 2 }];

  // =================== Validación ===================
  const colMesVal = (i: number) => 2 + i;
  const colNota = 2 + n;
  wsVal.addRow([`VALIDACIÓN DEL GRUPO DE DOCUMENTOS · ${anio}`]).font = FONT_TITLE as any;
  wsVal.addRow([]);
  styleHeaderRow(wsVal.addRow(["Concepto", ...meses.map(m => `${MESES_CORTO[m]} ${anio}`), "Nota"]));
  const estado = (m: number) => informe.estados.find(e => e.mes === m)!;
  const filaVal = (titulo: string, celda: (m: number, L: string, fila: number) => ExcelJS.CellValue, nota = "", formato = MONEY) => {
    const r = wsVal.addRow([titulo]);
    meses.forEach((m, i) => {
      const cell = r.getCell(colMesVal(i));
      cell.value = celda(m, colLetter(colMesVal(i)), r.number);
      cell.numFmt = formato;
    });
    r.getCell(colNota).value = nota;
    return r.number;
  };
  const enFlujo = (i: number, fila: number) => `${ref(HOJA_FLUJO)}${colLetter(colMes(i))}${fila}`;
  const idx = (m: number) => meses.indexOf(m);
  filaVal("Documentos con movimiento en caja o bancos", m => estado(m).documentos, "Llave: tipo + número de comprobante", ENTERO);
  const vLineas = filaVal("Líneas del auxiliar en esos documentos", m => estado(m).lineas, "Contrapartidas y líneas de efectivo", ENTERO);
  const vDeb = filaVal("Total débitos de los documentos", m => estado(m).totalDebitos);
  const vCre = filaVal("Total créditos de los documentos", m => estado(m).totalCreditos);
  filaVal("Diferencia débitos − créditos", (m, L) => f(`${L}${vDeb}-${L}${vCre}`, Math.round((estado(m).totalDebitos - estado(m).totalCreditos) * 100) / 100), "Sumas iguales: debe ser cero");
  filaVal("Documentos descuadrados", m => estado(m).descuadrados, "Documentos cuya suma de débitos no iguala la de créditos", ENTERO);
  wsVal.addRow([]);
  wsVal.addRow(["Cuadre del flujo"]).font = FONT_BOLD as any;
  const vVar = filaVal("Variación neta de caja y bancos en los documentos", m => f(enFlujo(idx(m), rTotVar.number), estado(m).variacionEfectivo));
  const vCon = filaVal("Suma de contrapartidas (créditos − débitos)", m => f(`${ref(HOJA_AGRUPACION)}${colLetter(colMesAgr(idx(m)))}${totAgr.number}`, estado(m).sumaContrapartidas), "Debe ser igual a la variación de efectivo");
  filaVal("Diferencia", (m, L) => f(`${L}${vVar}-${L}${vCon}`, Math.round((estado(m).variacionEfectivo - estado(m).sumaContrapartidas) * 100) / 100));
  filaVal("Aumento neto según el flujo", m => f(enFlujo(idx(m), fAum), R[m].aumentoNeto));
  const conSaldo = (m: number, fila: number, valor: number | null): ExcelJS.CellValue => (R[m].saldosCompletos ? f(enFlujo(idx(m), fila), valor!) : SIN_SALDOS);
  filaVal("Saldo inicial suministrado", m => conSaldo(m, rIni.number, R[m].saldoInicial));
  filaVal("Saldo final calculado", m => conSaldo(m, rCal.number, R[m].finalCalculado));
  filaVal("Saldo final suministrado", m => conSaldo(m, rCon.number, R[m].saldoFinal));
  filaVal("Variación", m => conSaldo(m, rVar.number, R[m].variacion), "Calculado − contabilidad");
  wsVal.addRow([]);
  wsVal.addRow(["Alcance"]).font = FONT_BOLD as any;
  const vTot = filaVal("Líneas totales del auxiliar del mes", m => estado(m).lineasAuxiliar, "", ENTERO);
  filaVal("Líneas fuera del grupo (documentos sin caja ni bancos)", (m, L) => f(`${L}${vTot}-${L}${vLineas}`, estado(m).lineasAuxiliar - estado(m).lineas), "No afectan el flujo de efectivo", ENTERO);
  wsVal.getColumn(1).width = 52;
  for (let i = 0; i < n; i++) wsVal.getColumn(colMesVal(i)).width = 18;
  wsVal.getColumn(colNota).width = 58;
  wsVal.views = [{ state: "frozen", ySplit: 3, xSplit: 1 }];

  // =================== Detalle por subcuenta ===================
  styleHeaderRow(wsDet.addRow(["Mes", "Cuenta (grupo)", "Subcuenta", "Nombre", "Tipo de documento", "Débitos", "Créditos", "Neto (créditos − débitos)", "Documentos", "Líneas"]));
  const ordenado = detalle.filter(d => d.clase !== "efectivo").sort((a, b) =>
    a.mes - b.mes || a.cuenta.slice(0, 4).localeCompare(b.cuenta.slice(0, 4)) || a.clase.localeCompare(b.clase) || a.cuenta.localeCompare(b.cuenta) || a.tipoDocumento.localeCompare(b.tipoDocumento));
  for (const d of ordenado) {
    const grupo = d.cuenta.slice(0, 4) + (d.clase === "sin_efecto" ? "-NM" : "");
    const r = wsDet.addRow([MESES[d.mes], grupo, d.cuenta, catalogo.get(d.cuenta) || "", d.tipoDocumento, d.debitos, d.creditos]);
    r.getCell(8).value = f(`G${r.number}-F${r.number}`, Math.round((d.creditos - d.debitos) * 100) / 100);
    r.getCell(9).value = d.documentos; r.getCell(10).value = d.lineas;
  }
  for (const c of [6, 7, 8]) wsDet.getColumn(c).numFmt = MONEY;
  for (const c of [9, 10]) wsDet.getColumn(c).numFmt = ENTERO;
  [12, 14, 14, 44, 18, 18, 18, 22, 13, 10].forEach((w, i) => { wsDet.getColumn(i + 1).width = w; });
  wsDet.views = [{ state: "frozen", ySplit: 1 }];
  if (ordenado.length > 0) wsDet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };

  finalizarLibro(wb);
  return wb;
}

export async function generarReporteFlujo(clienteId: number, anio: number, cliente: { razonSocial: string; nit: string | null }): Promise<Buffer> {
  const informe = await armarInformeFlujo(clienteId, anio);
  if (informe.meses.length === 0) throw new Error("Todavía no hay ningún mes calculado para este año.");
  const [detalle, catalogo] = await Promise.all([listarDetalleFlujo(clienteId, anio, informe.meses), getCatalogoCliente(clienteId)]);
  const wb = construirLibroFlujo(informe, cliente, detalle, catalogo);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
