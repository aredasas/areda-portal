import ExcelJS from "exceljs";
import { getSaldosDelAnio, getCuentasPucConocidas, getCatalogoCliente, type TipoSaldo } from "./informesDb";
import {
  MESES_CORTO, FONT_BOLD, FONT_TITLE, MONEY, PCT,
  styleHeaderRow, styleSubtotalRow, a4Digitos, colLetter, finalizarLibro,
} from "./informesReportUtils";

type FilaCuenta = { tipo: TipoSaldo; codigo: string; valores: Record<number, number> };

/** Arma UNA hoja con el formato del Estado de Resultados (meses en
 * columnas + Acumulado, agrupado en INGRESOS/COSTO/DESCUENTO PP/GASTOS
 * con sus subtotales) a partir de saldos ya filtrados — se reutiliza
 * tanto para el ERM (todos los centros combinados) como para el ERI (una
 * hoja por cada centro de costo, con este mismo formato). */
export function agregarHojaEstadoResultados(
  wb: ExcelJS.Workbook, nombreHoja: string, tituloEncabezado: string, subtituloEncabezado: string,
  saldos: { mes: number; tipo: TipoSaldo; cuenta: string; valor: number }[],
  nivel: "resumen" | "detalle", cuentasConocidas: Map<string, { descripcion: string | null; tipo: string }>, catalogoCliente: Map<string, string>,
): void {
  const mesesConDatos = Array.from(new Set(saldos.map(f => f.mes))).sort((a, b) => a - b);

  const mapa = new Map<string, FilaCuenta>();
  for (const fila of saldos) {
    const codigo = nivel === "resumen" ? a4Digitos(fila.cuenta) : fila.cuenta;
    const key = `${fila.tipo}|${codigo}`;
    if (!mapa.has(key)) mapa.set(key, { tipo: fila.tipo, codigo, valores: {} });
    const f = mapa.get(key)!;
    f.valores[fila.mes] = (f.valores[fila.mes] || 0) + fila.valor;
  }

  const descripcionPara = (codigo: string): string => {
    const exactaCliente = catalogoCliente.get(codigo);
    if (exactaCliente) return exactaCliente;
    for (const [cta, nombre] of Array.from(catalogoCliente.entries())) {
      if (cta.startsWith(codigo)) return nombre;
    }
    const exacta = cuentasConocidas.get(codigo);
    if (exacta?.descripcion) return exacta.descripcion;
    for (const [cta, info] of Array.from(cuentasConocidas.entries())) {
      if (cta.startsWith(codigo) && info.descripcion) return info.descripcion;
    }
    return "";
  };

  const porTipo = (tipo: TipoSaldo) => Array.from(mapa.values())
    .filter(f => f.tipo === tipo)
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  const ws = wb.addWorksheet(nombreHoja.slice(0, 31));

  ws.addRow([tituloEncabezado]).font = FONT_TITLE as any;
  ws.addRow([subtituloEncabezado]).font = { name: "Arial", size: 9, italic: true } as any;
  ws.addRow([]);

  const numMeses = mesesConDatos.length;
  const primeraColMes = 3; // 1=Cuenta, 2=Descripción
  const colAcumulado = primeraColMes + numMeses;
  const headerLabels = ["Cuenta", "Descripción", ...mesesConDatos.map(m => MESES_CORTO[m]), "Acumulado"];
  const head = ws.addRow(headerLabels);
  styleHeaderRow(head);

  for (let c = primeraColMes; c <= colAcumulado; c++) ws.getColumn(c).numFmt = MONEY;

  const escribirGrupo = (titulo: string, tipo: TipoSaldo): number => {
    const rTitulo = ws.addRow([titulo]); rTitulo.font = FONT_BOLD as any;
    const startRow = ws.rowCount + 1;
    for (const f of porTipo(tipo)) {
      const valoresMes = mesesConDatos.map(m => f.valores[m] || 0);
      const r = ws.addRow([f.codigo, descripcionPara(f.codigo), ...valoresMes]);
      r.getCell(colAcumulado).value = numMeses > 0
        ? { formula: `SUM(${colLetter(primeraColMes)}${r.number}:${colLetter(colAcumulado - 1)}${r.number})` } as any
        : 0;
    }
    const endRow = ws.rowCount;
    const rTot = ws.addRow([null, `Total ${titulo.toLowerCase()}`]);
    for (let c = primeraColMes; c <= colAcumulado; c++) {
      const letra = colLetter(c);
      rTot.getCell(c).value = endRow >= startRow ? { formula: `SUM(${letra}${startRow}:${letra}${endRow})` } as any : 0;
    }
    styleSubtotalRow(rTot);
    return rTot.number;
  };

  const rowIngresos = escribirGrupo("INGRESOS", "ingreso");
  const rowCostoBruto = escribirGrupo("COSTO DE VENTA (BRUTO)", "costo");
  const rowDescPP = escribirGrupo("(-) DESCUENTO PRONTO PAGO", "descuento_pp");

  const rCostoNeto = ws.addRow([null, "Costo neto de venta"]);
  for (let c = primeraColMes; c <= colAcumulado; c++) {
    const letra = colLetter(c);
    rCostoNeto.getCell(c).value = { formula: `${letra}${rowCostoBruto}-${letra}${rowDescPP}` } as any;
  }
  rCostoNeto.font = FONT_BOLD as any;

  const rUtilBruta = ws.addRow([null, "UTILIDAD BRUTA"]);
  for (let c = primeraColMes; c <= colAcumulado; c++) {
    const letra = colLetter(c);
    rUtilBruta.getCell(c).value = { formula: `${letra}${rowIngresos}-${letra}${rCostoNeto.number}` } as any;
  }
  rUtilBruta.font = FONT_BOLD as any;

  const rowGastos = escribirGrupo("GASTOS", "gasto");

  const rResultado = ws.addRow([null, "RESULTADO DEL PERIODO (Utilidad/Pérdida)"]);
  for (let c = primeraColMes; c <= colAcumulado; c++) {
    const letra = colLetter(c);
    rResultado.getCell(c).value = { formula: `${letra}${rUtilBruta.number}-${letra}${rowGastos}` } as any;
  }
  styleSubtotalRow(rResultado);

  const rMargen = ws.addRow([null, "% Resultado sobre ventas"]);
  for (let c = primeraColMes; c <= colAcumulado; c++) {
    const letra = colLetter(c);
    const cell = rMargen.getCell(c);
    cell.value = { formula: `IF(${letra}${rowIngresos}=0,0,${letra}${rResultado.number}/${letra}${rowIngresos})` } as any;
    cell.numFmt = PCT;
  }

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 36;
  for (let c = primeraColMes; c <= colAcumulado; c++) ws.getColumn(c).width = 14;
}

/** ESTADO DE RESULTADOS MENSUAL COMPARATIVO (ERM) — el informe principal del
 * módulo. Por cliente, un año calendario, una columna por mes (más
 * Acumulado), sumando TODOS los centros de costo combinados — funciona
 * igual para clientes que manejan centro de costo (como Colfamil) y para
 * los que no (donde todo queda bajo centroCodigo="SC"). Es la base contra
 * la que se validan/derivan los demás informes (como el ERI).
 *
 * nivel "resumen": agrupa cuentas a 4 dígitos (ej. 5105).
 * nivel "detalle": una fila por cada código de cuenta tal cual viene en el
 * libro auxiliar (subcuentas de 6+ dígitos incluidas). */
export async function generarReporteERM(
  clienteId: number, anio: number, nivel: "resumen" | "detalle",
): Promise<Buffer> {
  const saldos = await getSaldosDelAnio(clienteId, anio);
  const cuentasConocidas = await getCuentasPucConocidas();
  const catalogoCliente = await getCatalogoCliente(clienteId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";
  const nombreNivel = nivel === "resumen" ? "Resumen (cuentas a 4 dígitos)" : "Detalle completo (todas las subcuentas)";

  agregarHojaEstadoResultados(
    wb, `ERM ${anio}`, `ESTADO DE RESULTADOS MENSUAL COMPARATIVO · ${anio}`,
    `${nombreNivel} · Todos los centros de costo combinados · Cuenta 4=Ingreso, 5=Gasto, 6=Costo`,
    saldos, nivel, cuentasConocidas, catalogoCliente,
  );

  finalizarLibro(wb);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
