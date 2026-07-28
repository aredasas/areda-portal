import ExcelJS from "exceljs";
import { getCentrosCosto, getSaldosDelAnio, getCuentasPucConocidas, getCatalogoCliente } from "./informesDb";
import { finalizarLibro } from "./informesReportUtils";
import { agregarHojaEstadoResultados } from "./informesReportERM";

/** ESTADO DE RESULTADOS POR CENTRO DE COSTO (ERI) — mismo formato y mismo
 * alcance de meses que el ERM (una columna por mes hasta el mes elegido,
 * más Acumulado), pero en vez de una sola hoja con todos los centros
 * combinados, genera una hoja "General" (todos los centros juntos, igual
 * que el ERM) y una hoja adicional por cada centro de costo activo, cada
 * una filtrada a los movimientos de ese centro únicamente. Solo tiene
 * sentido para clientes que manejan centro de costo. */
export async function generarReporteERI(
  clienteId: number, anio: number, mes: number, nivel: "resumen" | "detalle" = "resumen",
): Promise<Buffer> {
  const centrosCatalogo = await getCentrosCosto(clienteId);
  const centros = centrosCatalogo.filter(c => c.activo).map(c => c.codigo).sort();
  const nombres: Record<string, string> = {};
  for (const c of centrosCatalogo) nombres[c.codigo] = c.nombre;

  const cuentasConocidas = await getCuentasPucConocidas();
  const catalogoCliente = await getCatalogoCliente(clienteId);
  const saldosAnio = (await getSaldosDelAnio(clienteId, anio)).filter(f => f.mes <= mes);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Areda Work · Módulo Informes";
  const nombreNivel = nivel === "resumen" ? "Resumen (cuentas a 4 dígitos)" : "Detalle completo (todas las subcuentas)";

  agregarHojaEstadoResultados(
    wb, "General", `ESTADO DE RESULTADOS · TODOS LOS CENTROS · ${anio}`,
    `${nombreNivel} · Todos los centros de costo combinados · Cuenta 4=Ingreso, 5=Gasto, 6=Costo`,
    saldosAnio, nivel, cuentasConocidas, catalogoCliente,
  );

  for (const c of centros) {
    const saldosDelCentro = saldosAnio.filter(f => f.centroCodigo === c);
    agregarHojaEstadoResultados(
      wb, `${c} ${nombres[c]}`, `ESTADO DE RESULTADOS · ${nombres[c]} (${c}) · ${anio}`,
      `${nombreNivel} · Solo centro de costo "${nombres[c]}" · Cuenta 4=Ingreso, 5=Gasto, 6=Costo`,
      saldosDelCentro, nivel, cuentasConocidas, catalogoCliente,
    );
  }

  finalizarLibro(wb);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
