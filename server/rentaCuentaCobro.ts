import PDFDocument from "pdfkit";

/** Convierte un número entero (pesos, sin decimales) a su escritura en
 * letras en español — usado en la línea "SON:" de la cuenta de cobro.
 * Cubre hasta miles de millones, más que suficiente para honorarios. */
export function numeroALetras(valor: number): string {
  const UNIDADES = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const DIEZ_A_DIECINUEVE = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
  const DECENAS = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

  function convertirCentenas(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    let texto = c > 0 ? CENTENAS[c] : "";
    if (resto > 0) {
      if (resto < 10) texto += (texto ? " " : "") + UNIDADES[resto];
      else if (resto < 20) texto += (texto ? " " : "") + DIEZ_A_DIECINUEVE[resto - 10];
      else {
        const d = Math.floor(resto / 10);
        const u = resto % 10;
        texto += (texto ? " " : "") + DECENAS[d] + (u > 0 ? " Y " + UNIDADES[u] : "");
      }
    }
    return texto;
  }

  function convertirGrupo(n: number, singular: string, plural: string): string {
    if (n === 0) return "";
    if (n === 1) return singular;
    return `${convertirCentenas(n)} ${plural}`;
  }

  const entero = Math.round(Math.abs(valor));
  if (entero === 0) return "CERO PESOS M/CTE.";

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];
  if (millones > 0) partes.push(convertirGrupo(millones, "UN MILLON", "MILLONES"));
  if (miles > 0) partes.push(miles === 1 ? "MIL" : `${convertirCentenas(miles)} MIL`);
  if (resto > 0) partes.push(convertirCentenas(resto));

  return partes.filter(Boolean).join(" ").replace(/\s+/g, " ").trim() + " PESOS M/CTE.";
}

/** Genera el PDF de una cuenta de cobro — mismo formato que Arlex ya
 * usaba en FoxPro (Fecha + folio arriba, cliente, "Debe a" con los
 * datos fijos de Arlex, una línea de detalle/valor, total, el valor en
 * letras, la nota del Art. 103/383 ET, los datos de pago, y la firma). */
export async function generarCuentaCobroPdf(datos: {
  prefijo: string; numero: number; fecha: Date;
  clienteNombre: string; clienteCedula: string;
  detalle: string; valor: number;
}): Promise<Buffer> {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
  const folio = `${datos.prefijo} - ${String(datos.numero).padStart(4, "0")}`;

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "letter", margin: 50 });
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const anchoUtil = doc.page.width - 100;
  const xIzq = 50;
  const xDer = doc.page.width - 50;

  // --- Encabezado: fecha a la izquierda, folio en una caja a la derecha ---
  const yEncabezado = doc.y;
  doc.font("Helvetica-Bold").fontSize(10).text("Fecha:", xIzq, yEncabezado);
  const fechaFormateada = [
    String(datos.fecha.getDate()).padStart(2, "0"),
    String(datos.fecha.getMonth() + 1).padStart(2, "0"),
    datos.fecha.getFullYear(),
  ].join("/");
  doc.font("Helvetica").text(fechaFormateada, xIzq + 45, yEncabezado);

  const anchoCaja = 170;
  const xCaja = xDer - anchoCaja;
  doc.rect(xCaja, yEncabezado - 5, anchoCaja, 32).stroke();
  doc.moveTo(xCaja + 90, yEncabezado - 5).lineTo(xCaja + 90, yEncabezado + 27).stroke();
  doc.font("Helvetica-Bold").fontSize(8).text("CUENTA DE COBRO", xCaja + 4, yEncabezado, { width: 82 });
  doc.font("Helvetica-Bold").fontSize(11).text(folio, xCaja + 94, yEncabezado + 6, { width: anchoCaja - 98, align: "center" });

  doc.y = yEncabezado + 40;
  doc.moveDown(0.5);

  // --- Cliente ---
  doc.font("Helvetica-Bold").fontSize(13).text(datos.clienteNombre.toUpperCase(), xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.font("Helvetica").fontSize(9).text(`NIT -  ${datos.clienteCedula}`, xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.moveDown(1);

  // --- "Debe a" + datos fijos de Arlex ---
  doc.font("Helvetica-Bold").fontSize(10).text("Debe a:", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(13).text("RUBEN ARLEX PINEDA OCAMPO", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.font("Helvetica").fontSize(9);
  doc.text("CC 5.820.262", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.text("Calle 75 N 73-116 Escalares 802", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.text("TEL 318 793 5393 - email: contacto@aredasas.com", xIzq, doc.y, { width: anchoUtil, align: "center" });
  doc.moveDown(1);

  // --- Tabla: CANT | DETALLE | VALOR TOTAL ---
  const yTabla = doc.y;
  const colCant = 45, colValor = 100;
  const colDetalle = anchoUtil - colCant - colValor;
  const alturaFila = 24;
  doc.rect(xIzq, yTabla, anchoUtil, alturaFila).stroke();
  doc.moveTo(xIzq + colCant, yTabla).lineTo(xIzq + colCant, yTabla + alturaFila).stroke();
  doc.moveTo(xIzq + colCant + colDetalle, yTabla).lineTo(xIzq + colCant + colDetalle, yTabla + alturaFila).stroke();
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("CANT", xIzq, yTabla + 7, { width: colCant, align: "center" });
  doc.text("DETALLE", xIzq + colCant, yTabla + 7, { width: colDetalle, align: "center" });
  doc.text("VALOR TOTAL", xIzq + colCant + colDetalle, yTabla + 7, { width: colValor, align: "center" });

  const yFila = yTabla + alturaFila;
  const alturaFilaDatos = 120;
  doc.rect(xIzq, yFila, anchoUtil, alturaFilaDatos).stroke();
  doc.moveTo(xIzq + colCant, yFila).lineTo(xIzq + colCant, yFila + alturaFilaDatos).stroke();
  doc.moveTo(xIzq + colCant + colDetalle, yFila).lineTo(xIzq + colCant + colDetalle, yFila + alturaFilaDatos).stroke();
  doc.font("Helvetica").fontSize(9);
  doc.text("1", xIzq, yFila + 8, { width: colCant, align: "center" });
  doc.text(datos.detalle, xIzq + colCant + 5, yFila + 8, { width: colDetalle - 10 });
  doc.text(fmt(datos.valor), xIzq + colCant + colDetalle, yFila + 8, { width: colValor, align: "center" });

  doc.y = yFila + alturaFilaDatos + 10;

  // --- Total a pagar ---
  doc.font("Helvetica-Bold").fontSize(11);
  doc.text("TOTAL A PAGAR", xIzq, doc.y, { width: anchoUtil - 100, align: "left", continued: false });
  doc.font("Helvetica-Bold").fontSize(13).text(fmt(datos.valor), xIzq, doc.y - 14, { width: anchoUtil, align: "right" });
  doc.moveDown(1);

  // --- SON: (valor en letras) ---
  doc.rect(xIzq, doc.y, anchoUtil, 24).stroke();
  doc.font("Helvetica-Bold").fontSize(9).text("SON: ", xIzq + 5, doc.y + 7, { continued: true });
  doc.font("Helvetica").text(numeroALetras(datos.valor), { width: anchoUtil - 50 });
  doc.moveDown(1.5);

  // --- Nota legal Art. 103/383 ET ---
  doc.rect(xIzq, doc.y, anchoUtil, 38).stroke();
  doc.font("Helvetica").fontSize(9).text(
    "De acuerdo con el artículo 103 y 383 parágrafo 2 del ET, mis ingresos se consideran rentas de trabajo, favor efectuar la retención según la tabla del artículo 383 del ET.",
    xIzq + 5, doc.y + 6, { width: anchoUtil - 10 },
  );
  doc.y += 20;
  doc.moveDown(1.5);

  // --- Datos de pago (fijos) ---
  const yPago = doc.y;
  doc.rect(xIzq, yPago, anchoUtil, 62).stroke();
  doc.font("Helvetica").fontSize(9);
  doc.text("Favor consignar a la cuenta:", xIzq + 5, yPago + 6);
  doc.text("Llave NU: @RPO262 - Arlex Pineda Ocampo", xIzq + 5, doc.y);
  doc.text("Cuenta de ahorros banco de Occidente N 322-806-241 a nombre de Arlex Pineda Ocampo", xIzq + 5, doc.y);
  doc.moveDown(0.5);
  doc.text("Deposito DAVIPLATA LLAVE: 5820262 / deposito Nequi 3187935393", xIzq + 5, doc.y);
  doc.y = yPago + 70;
  doc.moveDown(1.5);

  // --- Firma ---
  doc.moveDown(2);
  doc.moveTo(xIzq, doc.y).lineTo(xIzq + 220, doc.y).stroke();
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(10).text("RUBEN ARLEX PINEDA OCAMPO", xIzq, doc.y);
  doc.font("Helvetica").fontSize(9);
  doc.text("CC 5.820.262", xIzq, doc.y);
  doc.text("Contador Público - Especialista NIIF", xIzq, doc.y);
  doc.text("Magister en Tributación", xIzq, doc.y);

  doc.end();
  return done;
}
