import ExcelJS from "exceljs";
import { getCentrosCosto, getSaldosDelAnio, getCuentasPucConocidas, getCatalogoCliente } from "./informesDb";
import { finalizarLibro } from "./informesReportUtils";
import { agregarHojaEstadoResultados } from "./informesReportERM";

/** ESTADO DE RESULTADOS POR CENTRO DE COSTO (ERI) — mismo formato y mismo
 * alcance de meses que el ERM (una columna por mes hasta el mes elegido,
 * más Acumulado), pero en vez de una sola hoja con todos los centros
 * combinados, genera una hoja "General" (todos los centros juntos, igual
 * que el ERM) y una hoja adicional por cada código de centro de costo que
 * REALMENTE aparezca en los saldos de ese año — incluido "SC" (sin centro
 * asignado en el archivo), como "Sin centro asignado". Se basa en los
 * datos reales, no en el catálogo, para que la suma de todas las hojas de
 * centro cuadre siempre exacto con "General" — si se basara en el
 * catálogo, un centro marcado inactivo (o nunca catalogado) que aún
 * tuviera saldos quedaría sumado en General pero sin su propia hoja, y
 * los acumulados no cuadrarían. Solo tiene sentido para clientes que
 * manejan centro de costo. */
export async function generarReporteERI(
  clienteId: number, anio: number, mes: number, nivel: "resumen" | "detalle" = "resumen",
): Promise<Buffer> {
  const centrosCatalogo = await getCentrosCosto(clienteId);
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

  // Códigos que REALMENTE aparecen en los saldos de este año — no el
  // catálogo — para garantizar que General = suma exacta de estas hojas.
  const codigosEnSaldos = Array.from(new Set(saldosAnio.map(f => f.centroCodigo))).sort();
  for (const codigo of codigosEnSaldos) {
    const esSinCentro = codigo === "SC";
    const nombreCentro = esSinCentro ? "Sin centro asignado" : (nombres[codigo] || codigo);
    const nombreHoja = esSinCentro ? "Sin centro asignado" : `${codigo} ${nombreCentro}`;
    const saldosDelCentro = saldosAnio.filter(f => f.centroCodigo === codigo);
    agregarHojaEstadoResultados(
      wb, nombreHoja, `ESTADO DE RESULTADOS · ${nombreCentro}${esSinCentro ? "" : ` (${codigo})`} · ${anio}`,
      `${nombreNivel} · Solo ${esSinCentro ? "movimientos sin centro de costo en el archivo" : `centro de costo "${nombreCentro}"`} · Cuenta 4=Ingreso, 5=Gasto, 6=Costo`,
      saldosDelCentro, nivel, cuentasConocidas, catalogoCliente,
    );
  }

  finalizarLibro(wb);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
