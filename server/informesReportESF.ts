import ExcelJS from "exceljs";
import type { ESF, FilaESF, SerieESF } from "./informesBalanceDb";
import { MESES, FONT_BOLD, FONT_TITLE, styleHeaderRow, styleSubtotalRow, colLetter } from "./informesReportUtils";

/** Hoja "ESF" — historial del balance, un mes por columna, con la misma
 * estructura del informe financiero: las cuentas de detalle del activo y
 * su total, las del pasivo y su total, el patrimonio con el resultado del
 * ejercicio, pasivo + patrimonio y la diferencia; al final de cada cuenta,
 * su estado de conciliación y la observación del contador.
 *
 * Los totales van como fórmulas (con su resultado ya calculado, para que
 * se lean igual en visores que no recalculan). */

const NUMERO = "#,##0_);[Red](#,##0)";
const NOTA = { name: "Arial", size: 9, italic: true, color: { argb: "FF6B5F5B" } };

export function agregarHojaESF(wb: ExcelJS.Workbook, esf: ESF, cliente: { razonSocial: string; nit: string | null }): void {
  const ws = wb.addWorksheet("ESF");
  const { meses } = esf;
  const colInicial = 3; // A cuenta, B detalle, C apertura, D… meses
  const colMes = (i: number) => 4 + i;
  const colEstado = 4 + meses.length;
  const colObs = colEstado + 1;
  const ultimaColValor = colEstado - 1;

  ws.addRow([cliente.razonSocial]).font = FONT_TITLE as any;
  ws.addRow([cliente.nit ? `NIT. ${cliente.nit}` : ""]);
  ws.addRow([`ESTADO DE SITUACIÓN FINANCIERA POR MES - AÑO ${esf.anio}`]).font = FONT_BOLD as any;
  ws.addRow(["Según el balance de prueba cargado cada mes. El resultado del ejercicio es ingresos − gastos − costos del mismo balance."]).font = NOTA as any;
  ws.addRow([]);
  const encabezado = ws.addRow(["CUENTA", "DETALLE", esf.etiquetaInicial, ...meses.map(m => MESES[m]), "Estado", "Observaciones"]);
  styleHeaderRow(encabezado);
  encabezado.alignment = { vertical: "middle", wrapText: true };
  for (let c = colInicial; c <= colEstado; c++) encabezado.getCell(c).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  const escribirCuentas = (filas: FilaESF[]): { desde: number; hasta: number } | null => {
    if (filas.length === 0) return null;
    const desde = ws.rowCount + 1;
    for (const x of filas) {
      const r = ws.addRow([x.cuenta, x.nombre, x.inicial, ...meses.map(m => x.valores[m] || 0)]);
      if (x.estado) { r.getCell(colEstado).value = x.estado; r.getCell(colEstado).alignment = { horizontal: "center" }; }
      if (x.observacion) r.getCell(colObs).value = x.observacion;
    }
    return { desde, hasta: ws.rowCount };
  };
  const valorDe = (serie: SerieESF, c: number) => (c === colInicial ? serie.inicial : serie.valores[meses[c - 4]]);
  /** Fila de total: una fórmula por columna de valores. */
  const filaTotal = (titulo: string, serie: SerieESF, formula: (L: string) => string | null): number => {
    const r = ws.addRow([null, titulo]);
    for (let c = colInicial; c <= ultimaColValor; c++) {
      const f = formula(colLetter(c));
      r.getCell(c).value = f ? ({ formula: f, result: valorDe(serie, c) } as any) : valorDe(serie, c);
    }
    styleSubtotalRow(r);
    return r.number;
  };
  const suma = (rango: { desde: number; hasta: number } | null, extra?: number) => (L: string) => {
    const partes = [rango ? `SUM(${L}${rango.desde}:${L}${rango.hasta})` : null, extra ? `${L}${extra}` : null].filter(Boolean);
    return partes.length > 0 ? partes.join("+") : null;
  };

  const rActivo = escribirCuentas(esf.activo);
  ws.addRow([]);
  const fActivo = filaTotal("TOTAL ACTIVO", esf.totalActivo, suma(rActivo));
  ws.addRow([]);
  const rPasivo = escribirCuentas(esf.pasivo);
  ws.addRow([]);
  const fPasivo = filaTotal("TOTAL PASIVO", esf.totalPasivo, suma(rPasivo));
  ws.addRow([]);
  const rPatrimonio = escribirCuentas(esf.patrimonio);
  const rResultado = ws.addRow([null, "Resultado del ejercicio", esf.resultado.inicial, ...meses.map(m => esf.resultado.valores[m])]);
  ws.addRow([]);
  const fPatrimonio = filaTotal("TOTAL PATRIMONIO", esf.totalPatrimonio, suma(rPatrimonio, rResultado.number));
  ws.addRow([]);
  const fPasPat = filaTotal("PASIVO + PATRIMONIO", esf.pasivoPatrimonio, L => `${L}${fPasivo}+${L}${fPatrimonio}`);
  ws.addRow([]);
  const fDif = filaTotal("DIFERENCIA", esf.diferencia, L => `${L}${fActivo}-${L}${fPasPat}`);
  ws.getRow(fDif).getCell(colObs).value = "Activo − (pasivo + patrimonio): debe ser cero. Si no, la contabilidad de ese mes no cuadra.";
  ws.getRow(fDif).getCell(colObs).font = NOTA as any;

  for (let c = colInicial; c <= ultimaColValor; c++) { ws.getColumn(c).numFmt = NUMERO; ws.getColumn(c).width = 17.5; }
  ws.getColumn(1).width = 11; ws.getColumn(2).width = 42; ws.getColumn(colEstado).width = 9; ws.getColumn(colObs).width = 80;
  ws.views = [{ state: "frozen", ySplit: encabezado.number, xSplit: 2 }];
}
