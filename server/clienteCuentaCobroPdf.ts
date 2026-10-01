import PDFDocument from "pdfkit";
import { numeroALetras, formatearFechaCuentaCobro } from "./rentaCuentaCobro";

/** Un renglón del cuerpo de la cuenta de cobro. `valor` en pesos enteros. */
export type ConceptoCuentaCobro = { detalle: string; valor: number };

/** Lee `conceptosJson` de una fila de `cuentasCobroClientes`. Las cuentas
 * generadas antes de existir esa columna (NULL) tienen un único concepto:
 * su `detalle` + `valor`. Si el JSON viniera dañado, también se cae a eso
 * en vez de romper el listado completo. */
export function leerConceptosCuentaCobro(conceptosJson: string | null | undefined, detalle: string, valor: number): ConceptoCuentaCobro[] {
  if (conceptosJson) {
    try {
      const lista = JSON.parse(conceptosJson);
      if (Array.isArray(lista) && lista.length > 0) {
        return lista.map((c: any) => ({ detalle: String(c?.detalle ?? ""), valor: Number(c?.valor) || 0 }));
      }
    } catch {
      // cae al concepto único
    }
  }
  return [{ detalle, valor }];
}

/** "AAAA-MM-DD" (día calendario elegido en el formulario) → medianoche UTC
 * de ese día, la misma convención de fechas del resto del proyecto (ver
 * dateUtils.ts). Devuelve null si la fecha no existe (ej. 2026-02-30). */
export function fechaCalendarioAUtcMidnight(fechaIso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso);
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (anio < 2000 || anio > 2100) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return fecha;
}

/** Texto digitado por el usuario → caracteres seguros para Helvetica
 * estándar de pdfkit (Latin-1). Comillas tipográficas, guiones largos,
 * viñetas, etc. se pasan a su equivalente ASCII; cualquier otro carácter
 * fuera de Latin-1 (emojis, etc.) se quita, porque se imprimiría como
 * basura. Tildes y ñ sí se conservan. */
function textoSeguroPdf(texto: string): string {
  return texto
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\n\x20-\x7E¡-ÿ]/g, "")
    .trim();
}

/** Genera el PDF de una cuenta de cobro para un cliente GENERAL (empresa) —
 * mismo formato y datos fijos de Arlex que ya usa Renta PN
 * (generarCuentaCobroPdf en rentaCuentaCobro.ts), con dos diferencias:
 * el bloque del cliente también muestra dirección y teléfono, y el cuerpo
 * admite VARIOS conceptos (una fila por concepto); el total a pagar es la
 * suma de los valores de los conceptos.
 *
 * `fecha` va en la convención del proyecto: medianoche UTC del día
 * calendario que debe imprimirse. */
export async function generarCuentaCobroClientePdf(datos: {
  prefijo: string; numero: number; fecha: Date;
  clienteNombre: string; clienteNit: string; clienteDigitoVerificacion?: string | null;
  clienteDireccion?: string | null; clienteTelefono?: string | null;
  conceptos: ConceptoCuentaCobro[];
}): Promise<Buffer> {
  if (datos.conceptos.length === 0) throw new Error("La cuenta de cobro necesita al menos un concepto.");

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
  const folio = `${datos.prefijo} - ${String(datos.numero).padStart(4, "0")}`;
  const conceptos = datos.conceptos.map((c) => ({ detalle: textoSeguroPdf(c.detalle), valor: Math.round(c.valor) }));
  const total = conceptos.reduce((s, c) => s + c.valor, 0);

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "letter", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 100;
  const xIzq = 50;
  const xDer = doc.page.width - 50;
  const yLimite = doc.page.height - 50; // margen inferior

  // --- Encabezado: fecha a la izquierda, folio en una caja a la derecha ---
  const yEncabezado = doc.y;
  doc.font("Helvetica-Bold").fontSize(10).text("Fecha:", xIzq, yEncabezado);
  doc.font("Helvetica").text(formatearFechaCuentaCobro(datos.fecha), xIzq + 45, yEncabezado);

  const anchoCaja = 170;
  const xCaja = xDer - anchoCaja;
  doc.rect(xCaja, yEncabezado - 5, anchoCaja, 32).stroke();
  doc.moveTo(xCaja + 90, yEncabezado - 5).lineTo(xCaja + 90, yEncabezado + 27).stroke();
  doc.font("Helvetica-Bold").fontSize(8).text("CUENTA DE COBRO", xCaja + 4, yEncabezado, { width: 82 });
  doc.font("Helvetica-Bold").fontSize(11).text(folio, xCaja + 94, yEncabezado + 6, { width: anchoCaja - 98, align: "center" });

  doc.y = yEncabezado + 40;
  doc.moveDown(0.5);

  // --- Cliente: nombre, NIT, dirección y teléfono ---
  doc.font("Helvetica-Bold").fontSize(13).text(textoSeguroPdf(datos.clienteNombre).toUpperCase(), xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.font("Helvetica").fontSize(9);
  const nitTexto = datos.clienteDigitoVerificacion ? `${datos.clienteNit}-${datos.clienteDigitoVerificacion}` : datos.clienteNit;
  doc.text(`NIT -  ${nitTexto}`, xIzq, doc.y, { width: anchoUtil, align: "center" });
  if (datos.clienteDireccion) {
    doc.text(textoSeguroPdf(datos.clienteDireccion), xIzq, doc.y, { width: anchoUtil, align: "center" });
  }
  if (datos.clienteTelefono) {
    doc.text(`Tel: ${textoSeguroPdf(datos.clienteTelefono)}`, xIzq, doc.y, { width: anchoUtil, align: "center" });
  }
  doc.moveDown(1);

  // --- "Debe a" + datos fijos de Arlex (idénticos a Renta PN) ---
  doc.font("Helvetica-Bold").fontSize(10).text("Debe a:", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(13).text("RUBEN ARLEX PINEDA OCAMPO", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.font("Helvetica").fontSize(9);
  doc.text("CC 5.820.262", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.text("Calle 75 N 73-116 Escalares 802", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.text("TEL 318 793 5393 - email: contacto@aredasas.com", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.moveDown(1);

  // --- Tabla: CANT | DETALLE | VALOR TOTAL — una fila por concepto ---
  const colCant = 45, colValor = 100;
  const colDetalle = anchoUtil - colCant - colValor;
  const xDivCant = xIzq + colCant;
  const xDivValor = xIzq + colCant + colDetalle;
  const alturaEncabezadoTabla = 24;
  const relleno = 7;               // espacio arriba/abajo del texto en cada fila
  const altoMinimoCuerpo = 120;    // mismo alto visual que tenía la cuenta de 1 concepto
  const anchoTextoDetalle = colDetalle - 10;

  const dibujarEncabezadoTabla = (y: number) => {
    doc.lineWidth(1).strokeColor("black");
    doc.rect(xIzq, y, anchoUtil, alturaEncabezadoTabla).stroke();
    doc.moveTo(xDivCant, y).lineTo(xDivCant, y + alturaEncabezadoTabla).stroke();
    doc.moveTo(xDivValor, y).lineTo(xDivValor, y + alturaEncabezadoTabla).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black");
    doc.text("CANT", xIzq, y + 8, { width: colCant, align: "center", lineBreak: false });
    doc.text("DETALLE", xDivCant, y + 8, { width: colDetalle, align: "center", lineBreak: false });
    doc.text("VALOR TOTAL", xDivValor, y + 8, { width: colValor, align: "center", lineBreak: false });
    return y + alturaEncabezadoTabla;
  };

  /** Cierra el bloque de filas de la página actual: marco exterior y las
   * dos divisiones verticales de punta a punta. */
  const cerrarCuerpo = (yInicio: number, yFin: number) => {
    doc.lineWidth(1).strokeColor("black");
    doc.rect(xIzq, yInicio, anchoUtil, yFin - yInicio).stroke();
    doc.moveTo(xDivCant, yInicio).lineTo(xDivCant, yFin).stroke();
    doc.moveTo(xDivValor, yInicio).lineTo(xDivValor, yFin).stroke();
  };

  let yCuerpoInicio = dibujarEncabezadoTabla(doc.y);
  let y = yCuerpoInicio;
  let altoCuerpoPrimeraPagina = 0;
  let enPrimeraPagina = true;

  doc.font("Helvetica").fontSize(9);
  const altoLinea = doc.currentLineHeight(true);

  conceptos.forEach((c, i) => {
    doc.font("Helvetica").fontSize(9);
    const altoTexto = Math.max(doc.heightOfString(c.detalle || " ", { width: anchoTextoDetalle }), altoLinea);
    const altoFila = altoTexto + relleno * 2;

    // Si la fila no cabe, se cierra el bloque y la tabla sigue en una
    // página nueva con su encabezado repetido.
    if (y + altoFila > yLimite) {
      cerrarCuerpo(yCuerpoInicio, y);
      if (enPrimeraPagina) altoCuerpoPrimeraPagina = y - yCuerpoInicio;
      enPrimeraPagina = false;
      doc.addPage();
      yCuerpoInicio = dibujarEncabezadoTabla(doc.page.margins.top);
      y = yCuerpoInicio;
    }

    // Separador gris tenue entre conceptos (no antes del primero de la página).
    if (y > yCuerpoInicio) {
      doc.lineWidth(0.5).strokeColor("#B0B0B0");
      doc.moveTo(xIzq, y).lineTo(xIzq + anchoUtil, y).stroke();
      doc.lineWidth(1).strokeColor("black");
    }

    doc.font("Helvetica").fontSize(9).fillColor("black");
    doc.text("1", xIzq, y + relleno, { width: colCant, align: "center", lineBreak: false });
    doc.text(c.detalle, xDivCant + 5, y + relleno, { width: anchoTextoDetalle });
    doc.text(fmt(c.valor), xDivValor, y + relleno, { width: colValor, align: "center", lineBreak: false });
    y += altoFila;

    if (i === conceptos.length - 1 && enPrimeraPagina) altoCuerpoPrimeraPagina = y - yCuerpoInicio;
  });

  // Con pocos conceptos la tabla conserva el alto de siempre (espacio en
  // blanco debajo del último concepto), siempre que quepa en la página.
  if (enPrimeraPagina && altoCuerpoPrimeraPagina < altoMinimoCuerpo) {
    y = Math.min(yCuerpoInicio + altoMinimoCuerpo, yLimite);
  }
  cerrarCuerpo(yCuerpoInicio, y);

  // --- Total a pagar + SON (van pegados a la tabla) ---
  const textoSon = numeroALetras(total);
  doc.font("Helvetica").fontSize(9);
  const anchoTextoSon = anchoUtil - 10 - doc.font("Helvetica-Bold").widthOfString("SON: ");
  doc.font("Helvetica").fontSize(9);
  const altoCajaSon = Math.max(doc.heightOfString(textoSon, { width: anchoTextoSon }), altoLinea) + 14;
  const altoTotalYSon = 10 + 18 + 12 + altoCajaSon;

  let yBloque = y + 10;
  if (y + altoTotalYSon > yLimite) {
    doc.addPage();
    yBloque = doc.page.margins.top;
  }

  doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
  doc.text("TOTAL A PAGAR", xIzq, yBloque + 2, { width: anchoUtil - 120, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(13).text(fmt(total), xIzq, yBloque, { width: anchoUtil, align: "right", lineBreak: false });
  yBloque += 18 + 12;

  doc.lineWidth(1).strokeColor("black").rect(xIzq, yBloque, anchoUtil, altoCajaSon).stroke();
  doc.font("Helvetica-Bold").fontSize(9).text("SON: ", xIzq + 5, yBloque + 7, { continued: true });
  doc.font("Helvetica").text(textoSon, { width: anchoTextoSon });
  yBloque += altoCajaSon;

  // --- Nota legal + datos de pago + firma (se mantienen juntos) ---
  const textoNota = "De acuerdo con el artículo 103 y 383 parágrafo 2 del ET, mis ingresos se consideran rentas de trabajo, favor efectuar la retención según la tabla del artículo 383 del ET.";
  doc.font("Helvetica").fontSize(9);
  const altoCajaNota = doc.heightOfString(textoNota, { width: anchoUtil - 10 }) + 12;
  const altoCajaPago = 62;
  // Firma: línea + nombre (10pt) + 3 renglones (9pt).
  const altoBloqueFirma = 4 + doc.font("Helvetica-Bold").fontSize(10).currentLineHeight(true) + 3 * altoLinea;
  doc.font("Helvetica").fontSize(9);
  // Espaciado normal (igual al formato de siempre) y uno compacto que se
  // usa solo si con el normal el pie no cabe en la página — así una
  // cuenta con varios conceptos no manda la firma sola a otra hoja.
  const espaciado = { antesNota: 18, despuesNota: 18, despuesPago: 26, sobreFirma: 30 };
  const altoPie = (e: typeof espaciado) =>
    e.antesNota + altoCajaNota + e.despuesNota + altoCajaPago + e.despuesPago + e.sobreFirma + altoBloqueFirma;
  const compacto = { antesNota: 10, despuesNota: 10, despuesPago: 12, sobreFirma: 22 };

  let esp = espaciado;
  if (yBloque + altoPie(espaciado) > yLimite) {
    if (yBloque + altoPie(compacto) <= yLimite) {
      esp = compacto;
      yBloque += esp.antesNota;
    } else {
      doc.addPage();
      yBloque = doc.page.margins.top;
    }
  } else {
    yBloque += esp.antesNota;
  }

  doc.rect(xIzq, yBloque, anchoUtil, altoCajaNota).stroke();
  doc.font("Helvetica").fontSize(9).text(textoNota, xIzq + 5, yBloque + 6, { width: anchoUtil - 10 });
  yBloque += altoCajaNota + esp.despuesNota;

  // --- Datos de pago (fijos) ---
  const yPago = yBloque;
  doc.rect(xIzq, yPago, anchoUtil, altoCajaPago).stroke();
  doc.font("Helvetica").fontSize(9);
  doc.text("Favor consignar a la cuenta:", xIzq + 5, yPago + 6);
  doc.text("Llave NU: @RPO262 - Arlex Pineda Ocampo", xIzq + 5, doc.y);
  doc.text("Cuenta de ahorros banco de Occidente N 322-806-241 a nombre de Arlex Pineda Ocampo", xIzq + 5, doc.y);
  doc.moveDown(0.5);
  doc.text("Deposito DAVIPLATA LLAVE: 5820262 / deposito Nequi 3187935393", xIzq + 5, doc.y);
  yBloque = yPago + altoCajaPago + esp.despuesPago;

  // --- Firma ---
  const yFirma = yBloque + esp.sobreFirma;
  doc.moveTo(xIzq, yFirma).lineTo(xIzq + 220, yFirma).stroke();
  doc.font("Helvetica-Bold").fontSize(10).text("RUBEN ARLEX PINEDA OCAMPO", xIzq, yFirma + 4);
  doc.font("Helvetica").fontSize(9);
  doc.text("CC 5.820.262", xIzq, doc.y);
  doc.text("Contador Público - Especialista NIIF", xIzq, doc.y);
  doc.text("Magister en Tributación", xIzq, doc.y);

  doc.end();
  return done;
}
