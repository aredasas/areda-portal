import ExcelJS from "exceljs";

export const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const MESES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export const FONT = { name: "Arial", size: 10 };
export const FONT_BOLD = { name: "Arial", size: 10, bold: true };
export const FONT_TITLE = { name: "Arial", size: 12, bold: true };
export const MONEY = '$#,##0;($#,##0);"-"';
export const PCT = "0.0%";
export const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF42302E" } };
export const HEADER_FONT = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
export const SUBTOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0EBE8" } };

export function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell(c => { c.font = HEADER_FONT as any; c.fill = HEADER_FILL; });
}

export function styleSubtotalRow(row: ExcelJS.Row) {
  row.font = FONT_BOLD as any;
  row.eachCell(c => { c.fill = SUBTOTAL_FILL; });
}

/** Agrupa un código de cuenta PUC (a cualquier nivel de detalle) al nivel
 * de 4 dígitos, ej. "51050501" o "510505" -> "5105". Si el código tiene
 * menos de 4 dígitos (no debería pasar) se devuelve tal cual. */
export function a4Digitos(cuenta: string): string {
  return cuenta.length >= 4 ? cuenta.slice(0, 4) : cuenta;
}

/** Convierte un índice de columna (1-based) a letra de Excel: 1->A, 27->AA. */
export function colLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const m = (num - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

export function finalizarLibro(wb: ExcelJS.Workbook) {
  wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => { if (!cell.font) cell.font = FONT as any; })));
}
