import PDFDocument from "pdfkit";
import {
  MESES_ABREV, MESES_NOMBRE, millones, pesosM, porcentaje,
  type ClaveER, type InformeGestion, type NivelAlerta,
} from "./informesGestionCalculo";
import type { ClienteGestion } from "./informesGestionFinDb";

/** INFORME DE GESTIÓN en PDF. Portada con el título y los datos del
 * cliente, indicadores, gráficas y tablas del estado de resultados por
 * mes, los centros de costo (si aplica), las variaciones atípicas, el
 * balance (si hay balance de prueba) y las notas del contador.
 *
 * Todo se dibuja a mano sobre PDFKit (texto y vectores, sin imágenes), con
 * las fuentes estándar del PDF: solo se usan caracteres que esas fuentes
 * traen (nada de flechas ni del signo menos tipográfico). */

// ---- Página ----
const ANCHO = 612, ALTO = 792, MARGEN = 44;
const W = ANCHO - MARGEN * 2;
const TOPE = 58, LIMITE = ALTO - 50;

// ---- Color ----
const MARCA = "#42302E", AMBAR = "#EDA011";
const TINTA = "#1f1a17", SEGUNDA = "#55504b", TENUE = "#8a857e", LINEA = "#e4e1da", EJE = "#c3c2b7", FONDO = "#f7f5f1";
const AZUL = "#2a78d6", NARANJA = "#eb6834", AGUA = "#1baf7a", ROJO = "#e34948";
const BIEN = "#0a6b0a", MAL = "#c0392b";
const NIVEL: Record<NivelAlerta, { texto: string; fondo: string; tinta: string; punto: string }> = {
  critico: { texto: "Crítico", fondo: "#fbe4e2", tinta: "#a52a22", punto: "#d03b3b" },
  revisar: { texto: "Revisar", fondo: "#fdf0d0", tinta: "#8a5a00", punto: "#e09400" },
  vigilar: { texto: "Vigilar", fondo: "#e1edfb", tinta: "#1c4f8f", punto: "#2a78d6" },
};

const R = "Helvetica", B = "Helvetica-Bold";
type Doc = InstanceType<typeof PDFDocument>;
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Mezcla dos colores hex (t = 0 → a, t = 1 → b). */
function mezclar(a: string, b: string, t: number): string {
  const n = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map(i => Math.round(n(a, i) + (n(b, i) - n(a, i)) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0")).join("");
}

/** Marcas "redondas" del eje para un rango de valores. */
export function escala(min: number, max: number, pasos = 4): { min: number; max: number; marcas: number[] } {
  const lo = Math.min(min, 0), hi = Math.max(max, 0);
  const rango = hi - lo || 1;
  const bruto = rango / pasos;
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map(m => m * potencia).find(p => p >= bruto) || 10 * potencia;
  const desde = Math.floor(lo / paso) * paso, hasta = Math.ceil(hi / paso) * paso;
  const marcas: number[] = [];
  for (let v = desde; v <= hasta + paso / 2; v += paso) marcas.push(Math.abs(v) < paso / 1e6 ? 0 : v);
  return { min: desde, max: hasta, marcas };
}

type Columna = { titulo: string; ancho: number; alinear?: "left" | "right" | "center" };
type Celda = string | { texto: string; color?: string; fondo?: string; negrita?: boolean; pastilla?: NivelAlerta | "cubre" | "ajustado" | "no_cubre" };
type FilaTabla = { celdas: Celda[]; negrita?: boolean; fondo?: string };

export async function generarPdfGestion(informe: InformeGestion, cliente: ClienteGestion, generadoEn: Date = new Date()): Promise<Buffer> {
  const doc: Doc = new PDFDocument({ size: "letter", margin: 0, bufferPages: true, info: { Title: `Informe de gestión ${informe.periodo} - ${cliente.razonSocial}`, Author: "Areda S.A.S." } });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(trozos))); doc.on("error", reject); });

  const { meses, er, acumulado } = informe;
  const abrevs = meses.map(m => MESES_ABREV[m]);
  let y = 0;

  // =================== Utilidades de dibujo ===================
  /** PDFKit parte la línea después de un guion, y deja «-» al final de un
   * renglón y «$346,7 M» en el siguiente. Cuando el texto trae una cifra
   * negativa se parte aquí, solo por los espacios. */
  const envolver = (t: string, ancho: number, o: { fuente?: string; tam?: number; espaciado?: number } = {}, sangria = 0): string => {
    if (!t.includes("-$")) return t;
    doc.font(o.fuente || R).fontSize(o.tam || 9);
    const medir = (x: string) => doc.widthOfString(x, { characterSpacing: o.espaciado || 0 });
    return t.split("\n").map(parrafo => {
      const lineas: string[] = [];
      let linea = "", disponible = ancho - sangria;
      for (const palabra of parrafo.split(" ")) {
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (linea && medir(prueba) > disponible - 0.5) { lineas.push(linea); linea = palabra; disponible = ancho; } else linea = prueba;
      }
      lineas.push(linea);
      return lineas.join("\n");
    }).join("\n");
  };
  const texto = (t: string, x: number, yy: number, o: { fuente?: string; tam?: number; color?: string; ancho?: number; alinear?: "left" | "right" | "center"; espaciado?: number; interlinea?: number; elipsis?: boolean; alto?: number } = {}) => {
    if (o.ancho !== undefined && !o.elipsis) t = envolver(t, o.ancho, o);
    doc.font(o.fuente || R).fontSize(o.tam || 9).fillColor(o.color || TINTA);
    doc.text(t, x, yy, {
      width: o.ancho, align: o.alinear || "left", characterSpacing: o.espaciado || 0, lineGap: o.interlinea ?? 0,
      lineBreak: o.ancho !== undefined, ellipsis: o.elipsis, height: o.alto,
    });
  };
  const altoTexto = (t: string, ancho: number, o: { fuente?: string; tam?: number; interlinea?: number } = {}) => {
    t = envolver(t, ancho, o);
    doc.font(o.fuente || R).fontSize(o.tam || 9);
    return doc.heightOfString(t, { width: ancho, lineGap: o.interlinea ?? 0 });
  };
  const anchoTexto = (t: string, o: { fuente?: string; tam?: number; espaciado?: number } = {}) => {
    doc.font(o.fuente || R).fontSize(o.tam || 9);
    return doc.widthOfString(t, { characterSpacing: o.espaciado || 0 });
  };
  /** Recorta a una línea con puntos suspensivos, letra por letra (PDFKit
   * recorta por palabras y se come medio nombre). */
  const recortar = (t: string, ancho: number, o: { fuente?: string; tam?: number; espaciado?: number } = {}): string => {
    if (anchoTexto(t, o) <= ancho) return t;
    let corto = t;
    while (corto.length > 1 && anchoTexto(`${corto.trimEnd()}…`, o) > ancho) corto = corto.slice(0, -1);
    return `${corto.trimEnd()}…`;
  };
  const nuevaPagina = () => { doc.addPage(); y = TOPE; };
  /** Si lo que viene no cabe en lo que queda de la página, pasa a la siguiente. */
  const reservar = (alto: number) => { if (y + alto > LIMITE) nuevaPagina(); };
  const marco = (x: number, yy: number, w: number, h: number, fondo = "#ffffff") => {
    doc.roundedRect(x, yy, w, h, 6).fillAndStroke(fondo, LINEA);
  };
  const lineaH = (x1: number, x2: number, yy: number, color = LINEA, grosor = 0.6) => {
    doc.moveTo(x1, yy).lineTo(x2, yy).lineWidth(grosor).strokeColor(color).stroke();
  };

  /** Antetítulo + título + párrafo de una sección. `siguiente` es el alto del
   * primer bloque que le sigue: si título y bloque no caben juntos, la sección
   * empieza en la página siguiente (el título nunca queda solo al pie). */
  const indice: { titulo: string; pagina: number }[] = [];
  let ySeccion = -1;
  const seccion = (antetitulo: string, titulo: string, parrafo?: string, siguiente = 90, enIndice = titulo) => {
    const altoParrafo = parrafo ? altoTexto(parrafo, W * 0.82, { tam: 9, interlinea: 2.5 }) + 6 : 0;
    reservar(Math.min(56 + altoParrafo + siguiente, LIMITE - TOPE));
    if (y > TOPE + 4) y += 10;
    indice.push({ titulo: enIndice, pagina: doc.bufferedPageRange().count });
    texto(antetitulo.toUpperCase(), MARGEN, y, { fuente: B, tam: 7, color: AMBAR, espaciado: 1.4 });
    y += 13;
    texto(titulo, MARGEN, y, { fuente: B, tam: 15, color: TINTA });
    y += 22;
    if (parrafo) { texto(parrafo, MARGEN, y, { tam: 9, color: SEGUNDA, ancho: W * 0.82, interlinea: 2.5 }); y += altoParrafo; }
    y += 4;
    ySeccion = y;
  };

  /** Encabezado de una tarjeta: título y subtítulo. Devuelve el alto que ocupa. */
  const cabeceraTarjeta = (x: number, yy: number, titulo: string, subtitulo?: string) => {
    texto(titulo, x + 12, yy + 11, { fuente: B, tam: 9.5 });
    if (subtitulo) texto(subtitulo, x + 12, yy + 25, { tam: 7.5, color: TENUE });
    return subtitulo ? 42 : 30;
  };
  const leyenda = (x: number, yy: number, items: { nombre: string; color: string }[]) => {
    let cx = x;
    for (const it of items) {
      doc.roundedRect(cx, yy + 1, 6, 6, 1.5).fill(it.color);
      texto(it.nombre, cx + 10, yy, { tam: 7.5, color: SEGUNDA });
      cx += 10 + anchoTexto(it.nombre, { tam: 7.5 }) + 14;
    }
  };

  /** Barra vertical con el extremo de datos redondeado y la base recta. */
  const columna = (x: number, base: number, ancho: number, alto: number, color: string, redondear = true) => {
    if (Math.abs(alto) < 0.4) return;
    const r = redondear ? Math.min(3, ancho / 2, Math.abs(alto)) : 0;
    const s = alto > 0 ? -1 : 1; // hacia arriba si es positivo
    const tope = base + s * Math.abs(alto);
    doc.moveTo(x, base).lineTo(x, tope - s * r).quadraticCurveTo(x, tope, x + r, tope)
      .lineTo(x + ancho - r, tope).quadraticCurveTo(x + ancho, tope, x + ancho, tope - s * r).lineTo(x + ancho, base).closePath().fill(color);
  };

  type SerieG = { nombre: string; color: string; valores: (number | null)[] };
  /** Ejes comunes: rejilla, marcas del eje Y (en millones) y categorías. Devuelve cómo ubicar un valor. */
  const ejes = (x: number, yy: number, w: number, h: number, categorias: string[], valores: number[], o: { margenIzq?: number; desdeCero?: boolean } = {}) => {
    const izq = o.margenIzq ?? 34, abajo = 14, arriba = 6;
    const px = x + izq, pw = w - izq - 4, py = yy + arriba, ph = h - arriba - abajo;
    const finitos = valores.filter(v => Number.isFinite(v));
    let esc = escala(Math.min(...finitos, 0), Math.max(...finitos, 0));
    if (o.desdeCero === false && finitos.length) {
      const lo = Math.min(...finitos), hi = Math.max(...finitos), holgura = (hi - lo || hi || 1) * 0.15;
      const e = escala(0, hi - (lo - holgura));
      const paso = e.marcas[1] - e.marcas[0];
      const desde = Math.max(0, Math.floor((lo - holgura) / paso) * paso);
      const marcas: number[] = [];
      for (let v = desde; v <= hi + paso * 0.999; v += paso) marcas.push(v);
      esc = { min: desde, max: marcas[marcas.length - 1], marcas };
    }
    const aY = (v: number) => py + ph - ((v - esc.min) / (esc.max - esc.min || 1)) * ph;
    for (const m of esc.marcas) {
      lineaH(px, px + pw, aY(m), m === 0 ? EJE : LINEA, m === 0 ? 0.8 : 0.5);
      texto(millones(m, 0), x, aY(m) - 3.2, { tam: 6.5, color: TENUE, ancho: izq - 6, alinear: "right" });
    }
    const banda = pw / Math.max(categorias.length, 1);
    categorias.forEach((c, i) => texto(c, px + banda * i, py + ph + 4, { tam: 6.5, color: TENUE, ancho: banda, alinear: "center" }));
    return { px, pw, py, ph, banda, aY, base: aY(Math.max(esc.min, 0)) };
  };

  const graficoColumnas = (x: number, yy: number, w: number, h: number, categorias: string[], series: SerieG[], apilado = false) => {
    const totales = categorias.map((_, i) => series.reduce((t, s) => t + Math.max(s.valores[i] || 0, 0), 0));
    const todos = apilado ? totales : series.flatMap(s => s.valores.map(v => v || 0));
    const e = ejes(x, yy, w, h, categorias, todos);
    const k = apilado ? 1 : series.length;
    const anchoBarra = Math.min(20, (e.banda * 0.72 - 2 * (k - 1)) / k);
    const grupo = anchoBarra * k + 2 * (k - 1);
    categorias.forEach((_, i) => {
      const x0 = e.px + e.banda * i + (e.banda - grupo) / 2;
      if (apilado) {
        let acum = 0;
        const visibles = series.filter(s => (s.valores[i] || 0) > 0);
        visibles.forEach((s, j) => {
          const v = s.valores[i] || 0;
          const yBase = e.aY(acum), alto = yBase - e.aY(acum + v);
          const ultimo = j === visibles.length - 1;
          // 1,5 pt de aire entre segmentos: se separan por el espacio, no por un borde.
          columna(x0, yBase - (j === 0 ? 0 : 0.75), anchoBarra, Math.max(alto - (ultimo ? 0.75 : 1.5), 0.5), s.color, ultimo);
          acum += v;
        });
      } else {
        series.forEach((s, j) => {
          const v = s.valores[i] || 0;
          columna(x0 + j * (anchoBarra + 2), e.base, anchoBarra, (e.base - e.aY(v)), s.color);
        });
      }
    });
    return e;
  };

  const graficoLineas = (x: number, yy: number, w: number, h: number, categorias: string[], series: SerieG[]) => {
    const e = ejes(x, yy, w - 40, h, categorias, series.flatMap(s => s.valores.filter((v): v is number => v !== null)), { desdeCero: false });
    const cx = (i: number) => e.px + e.banda * (i + 0.5);
    const finales: { yy: number; valor: number; color: string }[] = [];
    for (const s of series) {
      let abierto = false;
      s.valores.forEach((v, i) => {
        if (v === null) { abierto = false; return; }
        if (!abierto) { doc.moveTo(cx(i), e.aY(v)); abierto = true; } else doc.lineTo(cx(i), e.aY(v));
      });
      doc.lineWidth(1.6).lineJoin("round").lineCap("round").strokeColor(s.color).stroke();
      const ult = s.valores.map((v, i) => ({ v, i })).filter(p => p.v !== null).pop();
      if (ult) {
        doc.circle(cx(ult.i), e.aY(ult.v as number), 4.2).fill("#ffffff");
        doc.circle(cx(ult.i), e.aY(ult.v as number), 2.8).fill(s.color);
        finales.push({ yy: e.aY(ult.v as number), valor: ult.v as number, color: s.color });
      }
    }
    // Valor al final de cada línea; si dos quedan encima, se separan lo justo.
    finales.sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < finales.length; i++) if (finales[i].yy - finales[i - 1].yy < 8) finales[i].yy = finales[i - 1].yy + 8;
    for (const f of finales) texto(millones(f.valor), e.px + e.pw + 2, f.yy - 3.5, { fuente: B, tam: 7, color: TINTA });
  };

  /** Barras horizontales con el valor en la punta. `divergente`: positivos en azul, negativos en rojo. */
  const graficoBarrasH = (x: number, yy: number, w: number, filas: { etiqueta: string; valor: number }[], o: { divergente?: boolean; anchoEtiqueta?: number; rango?: [number, number] } = {}) => {
    const etq = o.anchoEtiqueta ?? 150, altoFila = 13.5, grosor = 8;
    const valores = filas.map(f => f.valor);
    const min = o.rango ? o.rango[0] : Math.min(...valores, 0), max = o.rango ? o.rango[1] : Math.max(...valores, 0);
    const holgura = 46; // espacio para el valor en la punta
    const px = x + etq + 8, pw = w - etq - 8 - holgura - (min < 0 ? holgura : 0);
    const cero = px + (min < 0 ? holgura : 0) + (pw * (0 - min)) / (max - min || 1);
    const aX = (v: number) => cero + (pw * v) / (max - min || 1);
    filas.forEach((f, i) => {
      const cy = yy + i * altoFila;
      texto(recortar(f.etiqueta, etq, { tam: 7.5 }), x, cy + 2.2, { tam: 7.5, color: SEGUNDA, ancho: etq, alinear: "right", elipsis: true, alto: 9 });
      const largo = Math.abs(aX(f.valor) - cero);
      const color = o.divergente && f.valor < 0 ? ROJO : AZUL;
      if (largo >= 0.4) {
        const r = Math.min(3, largo);
        const d = f.valor >= 0 ? 1 : -1, fin = cero + d * largo, top = cy + (altoFila - grosor) / 2;
        doc.moveTo(cero, top).lineTo(fin - d * r, top).quadraticCurveTo(fin, top, fin, top + r)
          .lineTo(fin, top + grosor - r).quadraticCurveTo(fin, top + grosor, fin - d * r, top + grosor).lineTo(cero, top + grosor).closePath().fill(color);
      }
      const etiqueta = millones(f.valor);
      if (f.valor >= 0) texto(etiqueta, aX(f.valor) + 4, cy + 2.4, { tam: 7, color: TINTA });
      else texto(etiqueta, aX(f.valor) - 4 - holgura, cy + 2.4, { tam: 7, color: TINTA, ancho: holgura, alinear: "right" });
    });
    doc.moveTo(cero, yy - 2).lineTo(cero, yy + filas.length * altoFila + 2).lineWidth(0.8).strokeColor(EJE).stroke();
    return filas.length * altoFila;
  };

  /** Pastilla de estado: punto de color + palabra. El color nunca va solo. */
  const pastilla = (x: number, yy: number, clave: NivelAlerta | "cubre" | "ajustado" | "no_cubre") => {
    const estilo = clave === "cubre" ? { texto: "Cubre", fondo: "#e2f3e2", tinta: BIEN, punto: "#0ca30c" }
      : clave === "ajustado" ? { ...NIVEL.revisar, texto: "Ajustado" }
      : clave === "no_cubre" ? { ...NIVEL.critico, texto: "No cubre" } : NIVEL[clave];
    const w = anchoTexto(estilo.texto, { fuente: B, tam: 6.5 }) + 17;
    doc.roundedRect(x, yy, w, 11, 5.5).fill(estilo.fondo);
    doc.circle(x + 6.5, yy + 5.5, 2).fill(estilo.punto);
    texto(estilo.texto, x + 11, yy + 2.6, { fuente: B, tam: 6.5, color: estilo.tinta });
    return w;
  };

  const ALTO_FILA = 15.5;
  /** Alto del encabezado: los títulos pueden traer un salto de línea. */
  const altoCabecera = (columnas: Columna[]) => (columnas.some(c => c.titulo.includes("\n")) ? 22 : 15);
  /** Dibuja una tabla desde (x, yy). No pagina: quien llama reserva el alto. Devuelve el alto usado. */
  const tabla = (x: number, yy: number, columnas: Columna[], filas: FilaTabla[], o: { tam?: number; altoFila?: number } = {}) => {
    const tam = o.tam || 7.5, altoFila = o.altoFila || ALTO_FILA, altoCab = altoCabecera(columnas);
    let cx = x;
    for (const c of columnas) {
      const lineas = c.titulo.toUpperCase().split("\n");
      lineas.forEach((l, i) => texto(l, cx + 4, yy + altoCab - 4 - (lineas.length - i) * 7, { tam: 6, color: TENUE, espaciado: 0.6, ancho: c.ancho - 8, alinear: c.alinear || "left", elipsis: true, alto: 7 }));
      cx += c.ancho;
    }
    const total = columnas.reduce((t, c) => t + c.ancho, 0);
    lineaH(x, x + total, yy + altoCab, EJE, 0.6);
    let cy = yy + altoCab;
    for (const f of filas) {
      if (f.fondo) doc.rect(x, cy, total, altoFila).fill(f.fondo);
      cx = x;
      f.celdas.forEach((celda, i) => {
        const c = columnas[i];
        const dato = typeof celda === "string" ? { texto: celda } : celda;
        if (dato.fondo) doc.rect(cx + 0.5, cy + 0.5, c.ancho - 1, altoFila - 1).fill(dato.fondo);
        if (dato.pastilla) pastilla(cx + 4, cy + (altoFila - 11) / 2, dato.pastilla);
        else {
          const fuente = f.negrita || dato.negrita ? B : R;
          texto(recortar(dato.texto, c.ancho - 8, { fuente, tam }), cx + 4, cy + (altoFila - tam) / 2 + 0.6, {
            fuente, tam, color: dato.color || TINTA, ancho: c.ancho - 8, alinear: c.alinear || "left", elipsis: true, alto: tam + 2,
          });
        }
        cx += c.ancho;
      });
      cy += altoFila;
      lineaH(x, x + total, cy, LINEA, 0.5);
    }
    return cy - yy;
  };

  /** Alto de una tabla en su tarjeta, si cupiera entera. */
  const altoTarjetaTabla = (columnas: Columna[], nFilas: number, o: { titulo?: boolean; subtitulo?: boolean; pie?: string } = {}) =>
    (o.titulo ? (o.subtitulo ? 42 : 30) : 12) + altoCabecera(columnas) + nFilas * ALTO_FILA + 12
    + (o.pie ? altoTexto(o.pie, W - 24, { tam: 6.8, interlinea: 1.5 }) + 8 : 0);

  /** Tabla dentro de una tarjeta. Si cabe entera en una página se mantiene
   * junta; si es más larga se parte, repitiendo el encabezado en cada página. */
  const tarjetaTabla = (titulo: string | null, subtitulo: string | undefined, columnas: Columna[], filas: FilaTabla[], o: { tam?: number; pie?: string } = {}) => {
    const altoCab = altoCabecera(columnas);
    const altoPie = o.pie ? altoTexto(o.pie, W - 24, { tam: 6.8, interlinea: 1.5 }) + 8 : 0;
    let pendientes = filas, primera = true;
    while (pendientes.length > 0) {
      const cabecera = primera && titulo ? (subtitulo ? 42 : 30) : 12;
      const fijo = cabecera + altoCab + 12 + altoPie;
      const completo = fijo + pendientes.length * ALTO_FILA;
      // Cabe entera en una página pero no en lo que queda de esta: pasa completa
      // (salvo justo después del título de la sección, que no debe quedar solo).
      if (y + completo > LIMITE && completo <= LIMITE - TOPE && y !== ySeccion && y > TOPE) { nuevaPagina(); continue; }
      const caben = Math.floor((LIMITE - y - fijo) / ALTO_FILA);
      if (caben < Math.min(4, pendientes.length) && y > TOPE) { nuevaPagina(); continue; }
      // Que no queden una o dos filas sueltas en la página siguiente.
      const sobran = pendientes.length - caben;
      const lote = pendientes.slice(0, Math.max(sobran > 0 && sobran < 4 && caben > 8 ? pendientes.length - 4 : caben, 1));
      pendientes = pendientes.slice(lote.length);
      const ultimo = pendientes.length === 0;
      const alto = cabecera + altoCab + lote.length * ALTO_FILA + 12 + (ultimo ? altoPie : 0);
      marco(MARGEN, y, W, alto);
      if (primera && titulo) cabeceraTarjeta(MARGEN, y, titulo, subtitulo);
      tabla(MARGEN + 12, y + cabecera - (primera && titulo ? 0 : 2), columnas, lote, { tam: o.tam });
      if (ultimo && o.pie) texto(o.pie, MARGEN + 12, y + alto - altoPie - 2, { tam: 6.8, color: TENUE, ancho: W - 24, interlinea: 1.5 });
      y += alto + 10;
      primera = false;
      if (!ultimo) nuevaPagina();
    }
  };
  /** Cuando las cifras de todos los meses no caben en una sola tabla, los
   * meses se reparten en dos o tres tramos (una tabla por tramo). `libre` es
   * el ancho que queda para las columnas de mes. */
  const tramosDeMeses = (valores: number[], libre: number, tam: number): number[][] => {
    const necesario = Math.max(...valores.map(v => anchoTexto(millones(v), { fuente: B, tam })), 0) + 8.5;
    let partes = 1;
    while (partes < 3 && libre / Math.ceil(meses.length / partes) < necesario) partes++;
    const porTramo = Math.ceil(meses.length / partes);
    return Array.from({ length: partes }, (_, i) => meses.slice(i * porTramo, (i + 1) * porTramo)).filter(t => t.length > 0);
  };
  const etiquetaTramo = (tramo: number[]) => (tramo.length === meses.length ? capital(informe.periodo) : `${capital(MESES_NOMBRE[tramo[0]])} a ${MESES_NOMBRE[tramo[tramo.length - 1]]} de ${informe.anio}`);
  /** Ancho de una columna de mes: lo que quepa, sin estirarse cuando hay pocos meses. */
  const anchoDeMes = (libre: number, n: number) => Math.min(62, libre / n);
  const num = (v: number, negrita = false): Celda => ({ texto: millones(v), color: v < -50_000 ? MAL : undefined, negrita });
  const pct = (f: number): Celda => ({ texto: porcentaje(f), color: f < 0 ? MAL : undefined });

  // =================== 1. Portada ===================
  // El nombre del cliente es el título: se reduce hasta que quepa en dos líneas.
  let tamTitulo = 25;
  while (tamTitulo > 15 && altoTexto(cliente.razonSocial, W, { fuente: B, tam: tamTitulo }) > tamTitulo * 2.5) tamTitulo -= 1;
  const altoTitulo = altoTexto(cliente.razonSocial, W, { fuente: B, tam: tamTitulo });
  const yTitulo = 68;
  // La banda crece con el título; la ficha del cliente monta 30 pt sobre ella.
  const yFicha = yTitulo + altoTitulo + 52;
  const ALTO_BANDA = yFicha + 30;
  doc.rect(0, 0, ANCHO, ALTO_BANDA).fill(MARCA);
  doc.rect(0, ALTO_BANDA, ANCHO, 3).fill(AMBAR);
  texto("INFORME DE GESTIÓN", MARGEN, 38, { fuente: B, tam: 8, color: AMBAR, espaciado: 2 });
  texto("AREDA S.A.S.", MARGEN, 38, { fuente: B, tam: 8, color: "#ffffff", espaciado: 1.6, ancho: W, alinear: "right" });
  const fechaLarga = `${generadoEn.getDate()} de ${MESES_NOMBRE[generadoEn.getMonth() + 1]} de ${generadoEn.getFullYear()}`;
  texto(`Generado el ${fechaLarga}`, MARGEN, 50, { tam: 7.5, color: "#cdbfb8", ancho: W, alinear: "right" });
  texto(cliente.razonSocial, MARGEN, yTitulo, { fuente: B, tam: tamTitulo, color: "#ffffff", ancho: W });
  const [desde, hasta] = [meses[0], meses[meses.length - 1]];
  const rango = desde === hasta ? `${capital(MESES_NOMBRE[hasta])} de ${informe.anio}` : `${capital(MESES_NOMBRE[desde])} a ${MESES_NOMBRE[hasta]} de ${informe.anio}`;
  texto(rango, MARGEN, yTitulo + altoTitulo + 5, { tam: 13, color: "#f4d9a0" });
  texto("Lectura financiera del estado de resultados por mes · cifras en millones de pesos (COP)", MARGEN, yTitulo + altoTitulo + 25, { tam: 8, color: "#cdbfb8" });

  // Ficha del cliente: una tarjeta que monta sobre la banda. Cuatro columnas;
  // un dato largo ocupa dos, y el último de cada fila se estira hasta el borde.
  const puntos = informe.centros.filter(c => c.esPuntoDeVenta);
  const administrativos = informe.centros.filter(c => !c.esPuntoDeVenta);
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const datos = [
    ["NIT", cliente.nit],
    ["Actividad económica", [cliente.actividadEconomica, cliente.codigoCIIU ? `CIIU ${cliente.codigoCIIU}` : null].filter(Boolean).join(" · ") || null],
    ["Ciudad", [cliente.ciudad, cliente.departamento].filter(Boolean).join(", ") || null],
    ["Representante legal", cliente.representanteLegal],
    ["Periodo analizado", `${capital(informe.periodo)}\n${plural(meses.length, "mes", "meses")}`],
    ["Centros de costo", informe.hayCentros ? [puntos.length ? plural(puntos.length, "punto de venta", "puntos de venta") : null, administrativos.length ? plural(administrativos.length, "administrativo", "administrativos") : null].filter(Boolean).join("\n") : null],
    ["Fuente", informe.balance ? `Libro auxiliar y balance de prueba a ${informe.balance.etiquetaFinal.toLowerCase()}` : "Libro auxiliar cargado en AREDA Work"],
  ].filter((d): d is [string, string] => !!d[1]);
  const COLS_FICHA = 4, anchoCol = (W - 24) / COLS_FICHA, PASO_FICHA = 42;
  const estiloDato = { fuente: B, tam: 8.5, interlinea: 0.5 };
  const dosLineas = altoTexto("Xy\nXy", 200, estiloDato) + 1;
  type DatoFicha = { etiqueta: string; valor: string; col: number; fila: number; span: number };
  const ficha: DatoFicha[] = [];
  let col = 0, fila = 0;
  for (const [etiqueta, valor] of datos) {
    const span = altoTexto(valor, anchoCol - 16, estiloDato) > dosLineas ? 2 : 1; // en una columna pediría más de dos líneas
    if (col + span > COLS_FICHA) {
      const previo = ficha[ficha.length - 1];
      previo.span += COLS_FICHA - col;
      col = 0; fila++;
    }
    ficha.push({ etiqueta, valor, col, fila, span });
    col += span;
  }
  if (ficha.length) ficha[ficha.length - 1].span += COLS_FICHA - col;
  const altoFicha = 14 + (fila + 1) * PASO_FICHA;
  y = yFicha;
  doc.roundedRect(MARGEN, y + 1.5, W, altoFicha, 7).fill("#d9d3cc"); // sombra corta
  doc.roundedRect(MARGEN, y, W, altoFicha, 7).fillAndStroke("#ffffff", LINEA);
  for (const d of ficha) {
    const fx = MARGEN + 12 + d.col * anchoCol, fy = y + 13 + d.fila * PASO_FICHA;
    if (d.col > 0) doc.moveTo(fx - 8, fy).lineTo(fx - 8, fy + 30).lineWidth(0.5).strokeColor(LINEA).stroke();
    if (d.fila > 0 && d.col === 0) lineaH(MARGEN + 12, MARGEN + W - 12, fy - 6.5, LINEA, 0.5);
    texto(d.etiqueta.toUpperCase(), fx, fy, { fuente: B, tam: 6, color: TENUE, espaciado: 0.8 });
    texto(d.valor, fx, fy + 10, { ...estiloDato, color: TINTA, ancho: d.span * anchoCol - 16, elipsis: true, alto: dosLineas });
  }
  y += altoFicha + 16;

  // Indicadores
  const anchoInd = (W - 16) / 3, altoInd = 58;
  informe.indicadores.forEach((ind, i) => {
    const ix = MARGEN + (i % 3) * (anchoInd + 8), iy = y + Math.floor(i / 3) * (altoInd + 8);
    marco(ix, iy, anchoInd, altoInd);
    doc.roundedRect(ix + 0.6, iy + 10, 2.6, altoInd - 20, 1.3).fill(ind.tono === "bueno" ? "#0ca30c" : ind.tono === "malo" ? "#d03b3b" : AMBAR);
    texto(ind.titulo, ix + 12, iy + 10, { tam: 7.5, color: SEGUNDA });
    texto(ind.valor, ix + 12, iy + 21, { fuente: B, tam: 16, color: TINTA });
    texto(ind.detalle, ix + 12, iy + 42, { tam: 7, color: ind.tono === "bueno" ? BIEN : ind.tono === "malo" ? MAL : TENUE, ancho: anchoInd - 20, elipsis: true, alto: 9 });
  });
  y += Math.ceil(informe.indicadores.length / 3) * (altoInd + 8) + 10;

  // Resumen ejecutivo
  texto("Resumen ejecutivo", MARGEN, y, { fuente: B, tam: 11.5 });
  y += 18;
  for (const r of informe.resumen) {
    const sangria = anchoTexto(`${r.titulo}: `, { fuente: B, tam: 8.5 });
    const cuerpo = envolver(r.texto, W - 12, { tam: 8.5 }, sangria);
    doc.font(R).fontSize(8.5);
    const alto = cuerpo.includes("\n")
      ? doc.heightOfString(cuerpo, { width: W - 12, lineGap: 2.2 })
      : doc.heightOfString(`${r.titulo}: ${r.texto}`, { width: W - 12, lineGap: 2.2 });
    reservar(alto + 6);
    doc.circle(MARGEN + 2.5, y + 4.2, 1.6).fill(AMBAR);
    doc.font(B).fontSize(8.5).fillColor(TINTA).text(`${r.titulo}: `, MARGEN + 12, y, { width: W - 12, lineGap: 2.2, continued: true })
      .font(R).fillColor(SEGUNDA).text(cuerpo, { lineGap: 2.2 });
    y += alto + 5;
  }
  // Lo que quede libre de la portada se usa al final para el contenido.
  const finPortada = doc.bufferedPageRange().count === 1 ? y : LIMITE;

  // =================== 2. Visión general ===================
  nuevaPagina();
  seccion("Visión general", informe.titularVision, informe.textoVision, 200, "Visión general");
  {
    const alto = 42 + 124 + 30;
    reservar(alto);
    marco(MARGEN, y, W, alto);
    const cab = cabeceraTarjeta(MARGEN, y, "Ventas netas y margen bruto", "Ventas del mes en millones; debajo de cada columna, el margen bruto de ese mes");
    const e = graficoColumnas(MARGEN + 12, y + cab, W - 24, 124, abrevs, [{ nombre: "Ventas netas", color: AZUL, valores: meses.map(m => er.ventasNetas[m]) }]);
    // El margen va alineado con su columna, no en una tabla aparte.
    const yMargen = y + cab + 124 + 4;
    texto("Margen", MARGEN + 12, yMargen + 0.8, { tam: 6.5, color: TENUE, ancho: 28, alinear: "right" });
    meses.forEach((m, i) => texto(porcentaje(informe.margenBrutoPorMes[m]), e.px + e.banda * i, yMargen, { fuente: B, tam: 7.5, ancho: e.banda, alinear: "center" }));
    y += alto + 10;
  }
  {
    // Estado de resultados mensual
    const lineas: { clave: ClaveER; titulo: string; negrita?: boolean; oculta?: boolean }[] = [
      { clave: "ventasNetas", titulo: "Ventas netas" },
      { clave: "otrosIngresos", titulo: "Otros ingresos" },
      { clave: "totalIngresos", titulo: "Total ingresos", negrita: true },
      { clave: "costoBruto", titulo: "Costo bruto" },
      { clave: "descuentos", titulo: "(-) Descuentos por pronto pago", oculta: Math.abs(acumulado.descuentos) < 1 },
      { clave: "costoNeto", titulo: "Costo neto", oculta: Math.abs(acumulado.descuentos) < 1 },
      { clave: "utilidadBruta", titulo: "Utilidad bruta", negrita: true },
      { clave: "gastosAdmin", titulo: "Gastos de administración" },
      { clave: "gastosVentas", titulo: "Gastos de ventas" },
      { clave: "otrosGastos", titulo: "Otros gastos (no operacionales)" },
      { clave: "totalGastos", titulo: "Total gastos", negrita: true },
      { clave: "utilidadOperativa", titulo: "Utilidad operativa", negrita: true },
      { clave: "impuestoRenta", titulo: "Impuesto de renta", oculta: Math.abs(acumulado.impuestoRenta) < 1 },
      { clave: "resultado", titulo: "Resultado del periodo", negrita: true },
    ];
    const visibles = lineas.filter(l => !l.oculta);
    const tramos = tramosDeMeses(visibles.flatMap(l => meses.map(m => er[l.clave][m])), W - 24 - 132 - 58 - 44, 7.3);
    tramos.forEach((tramo, t) => {
      const ultimo = t === tramos.length - 1;
      const anchoAcum = ultimo ? 58 : 0, anchoPct = ultimo ? 44 : 0;
      const anchoMes = anchoDeMes(W - 24 - 132 - anchoAcum - anchoPct, tramo.length);
      const anchoConcepto = W - 24 - anchoAcum - anchoPct - anchoMes * tramo.length;
      tarjetaTabla(t === 0 ? "Estado de resultados mensual" : "Estado de resultados mensual (continuación)", `${etiquetaTramo(tramo)}, millones`, [
        { titulo: "Concepto", ancho: anchoConcepto }, ...tramo.map(m => ({ titulo: MESES_ABREV[m], ancho: anchoMes, alinear: "right" as const })),
        ...(ultimo ? [{ titulo: "Acumulado", ancho: anchoAcum, alinear: "right" as const }, { titulo: "% ingr.", ancho: anchoPct, alinear: "right" as const }] : []),
      ], visibles.map(l => ({
        negrita: l.negrita, fondo: l.negrita ? FONDO : undefined,
        celdas: [l.titulo, ...tramo.map(m => num(er[l.clave][m])), ...(ultimo ? [num(acumulado[l.clave]), porcentaje(acumulado[l.clave] / (acumulado.totalIngresos || 1))] : [])],
      })), { tam: 7.3 });
    });
  }
  if (meses.length > 1) {
    const alto = 42 + 14 + 130;
    reservar(alto);
    marco(MARGEN, y, W, alto);
    const cab = cabeceraTarjeta(MARGEN, y, "Utilidad operativa y resultado", "Mensual, millones");
    leyenda(MARGEN + 12, y + cab - 2, [{ nombre: "Utilidad operativa", color: AZUL }, { nombre: "Resultado del periodo", color: NARANJA }]);
    graficoColumnas(MARGEN + 12, y + cab + 12, W - 24, 124, abrevs, [
      { nombre: "Utilidad operativa", color: AZUL, valores: meses.map(m => er.utilidadOperativa[m]) },
      { nombre: "Resultado", color: NARANJA, valores: meses.map(m => er.resultado[m]) },
    ]);
    y += alto + 10;
  }

  // =================== 3. Punto de equilibrio ===================
  {
    const q = informe.equilibrio;
    seccion("Punto de equilibrio", "Cuánto hay que vender para no perder",
      "Se calcula con todos los gastos como fijos: gastos del mes divididos por el margen bruto. Por encima de ese nivel de ingresos el periodo deja utilidad operativa; por debajo, pérdida.",
      60 + (meses.length > 1 ? 188 : 0), "Punto de equilibrio");
    const fichas = [
      { t: "Ingresos promedio al mes", v: pesosM(q.ingresosPromedio), d: `Margen bruto ${porcentaje(q.margenBruto)}` },
      { t: "Gastos al mes", v: pesosM(q.gastosPromedio), d: "Administración, ventas y otros" },
      { t: "Punto de equilibrio", v: q.punto === null ? "—" : pesosM(q.punto), d: "Ingresos necesarios al mes" },
      { t: "Margen de seguridad", v: q.margenSeguridad === null ? "—" : porcentaje(q.margenSeguridad), d: "Cuánto pueden caer los ingresos" },
    ];
    const aw = (W - 24) / 4;
    reservar(52 + 8);
    fichas.forEach((f, i) => {
      const fx = MARGEN + i * (aw + 8);
      marco(fx, y, aw, 52);
      texto(f.t, fx + 10, y + 9, { tam: 7, color: SEGUNDA });
      texto(f.v, fx + 10, y + 19, { fuente: B, tam: 13 });
      texto(f.d, fx + 10, y + 37, { tam: 6.5, color: TENUE, ancho: aw - 16, elipsis: true, alto: 8 });
    });
    y += 60;
    if (meses.length > 1) {
      const alto = 42 + 14 + 122;
      reservar(alto);
      marco(MARGEN, y, W, alto);
      const cab = cabeceraTarjeta(MARGEN, y, "Ingresos frente al punto de equilibrio", "Mensual, millones");
      leyenda(MARGEN + 12, y + cab - 2, [{ nombre: "Ingresos", color: AZUL }, { nombre: "Punto de equilibrio del mes", color: NARANJA }]);
      graficoLineas(MARGEN + 12, y + cab + 12, W - 24, 116, abrevs, [
        { nombre: "Ingresos", color: AZUL, valores: meses.map(m => er.totalIngresos[m]) },
        { nombre: "Equilibrio", color: NARANJA, valores: meses.map(m => q.porMes[m]) },
      ]);
      y += alto + 10;
    }
  }

  // =================== 4. Centros de costo ===================
  if (puntos.length > 0) {
    if (informe.aperturas.hay) {
      const a = informe.aperturas;
      const altoG = 42 + 14 + 118;
      seccion("Crecimiento", "Puntos existentes y aperturas", a.texto, altoG);
      reservar(altoG);
      marco(MARGEN, y, W, altoG);
      const cab = cabeceraTarjeta(MARGEN, y, "De dónde salen las ventas y los gastos", "Mensual, millones");
      const mitad = (W - 36) / 2;
      leyenda(MARGEN + 12, y + cab - 2, [{ nombre: "Ventas existentes", color: AZUL }, { nombre: "Ventas aperturas", color: NARANJA }]);
      graficoColumnas(MARGEN + 12, y + cab + 12, mitad, 112, abrevs, [
        { nombre: "Existentes", color: AZUL, valores: meses.map(m => a.ventasExistentes[m]) },
        { nombre: "Aperturas", color: NARANJA, valores: meses.map(m => a.ventasAperturas[m]) },
      ], true);
      leyenda(MARGEN + 24 + mitad, y + cab - 2, [{ nombre: "Gastos existentes", color: AZUL }, { nombre: "Aperturas", color: NARANJA }, { nombre: "Administración", color: AGUA }]);
      graficoColumnas(MARGEN + 24 + mitad, y + cab + 12, mitad, 112, abrevs, [
        { nombre: "Existentes", color: AZUL, valores: meses.map(m => a.gastosExistentes[m]) },
        { nombre: "Aperturas", color: NARANJA, valores: meses.map(m => a.gastosAperturas[m]) },
        { nombre: "Administración", color: AGUA, valores: meses.map(m => a.gastosAdministracion[m]) },
      ], true);
      y += altoG + 10;
      const [m0, m1] = [meses[0], meses[meses.length - 1]];
      const totalV: Record<number, number> = {}, totalG: Record<number, number> = {};
      for (const m of meses) { totalV[m] = a.ventasExistentes[m] + a.ventasAperturas[m]; totalG[m] = a.gastosExistentes[m] + a.gastosAperturas[m] + a.gastosAdministracion[m]; }
      const tramos = tramosDeMeses(meses.flatMap(m => [totalV[m], totalG[m]]), W - 24 - 150 - 58, 7.3);
      tramos.forEach((tramo, t) => {
        const ultimo = t === tramos.length - 1;
        const anchoVar = ultimo ? 58 : 0;
        const anchoMes = anchoDeMes(W - 24 - 150 - anchoVar, tramo.length);
        const anchoConcepto = W - 24 - anchoVar - anchoMes * tramo.length;
        const cambio = (c: Celda): Celda[] => (ultimo ? [c] : []);
        const filaSerie = (titulo: string, s: Record<number, number>, negrita = false): FilaTabla => ({
          negrita, fondo: negrita ? FONDO : undefined,
          celdas: [titulo, ...tramo.map(m => num(s[m])), ...cambio({ texto: `${s[m1] - s[m0] >= 0 ? "+" : ""}${millones(s[m1] - s[m0])}`, negrita: true })],
        });
        const filas: FilaTabla[] = [
          { celdas: ["Puntos con ventas", ...tramo.map(m => String(a.puntosPorMes[m])), ...cambio({ texto: `+${a.puntosPorMes[m1] - a.puntosPorMes[m0]}`, negrita: true })] },
          filaSerie("Ventas de puntos existentes", a.ventasExistentes), filaSerie("Ventas de aperturas", a.ventasAperturas), filaSerie("Ventas totales", totalV, true),
          { celdas: ["Margen bruto de existentes", ...tramo.map(m => pct(a.margenExistentes[m])), ...cambio({ texto: `${((a.margenExistentes[m1] - a.margenExistentes[m0]) * 100).toFixed(1).replace(".", ",")} pts`, negrita: true })] },
          filaSerie("Gastos de puntos existentes", a.gastosExistentes), filaSerie("Gastos de aperturas", a.gastosAperturas),
          filaSerie("Gastos administrativos", a.gastosAdministracion), filaSerie("Gastos totales", totalG, true),
          filaSerie("Resultado propio de las aperturas", a.resultadoAperturas),
        ];
        tarjetaTabla(tramos.length > 1 ? "Existentes y aperturas, mes a mes" : null, tramos.length > 1 ? `${etiquetaTramo(tramo)}, millones` : undefined, [
          { titulo: "Concepto", ancho: anchoConcepto }, ...tramo.map(m => ({ titulo: MESES_ABREV[m], ancho: anchoMes, alinear: "right" as const })),
          ...(ultimo ? [{ titulo: `${abrevs[0]} a ${abrevs[abrevs.length - 1]}`, ancho: anchoVar, alinear: "right" as const }] : []),
        ], filas, { tam: 7.3 });
      });
    }

    // Equilibrio por centro
    {
      const columnas: Columna[] = [
        { titulo: "Punto de venta", ancho: 0 }, { titulo: "Meses", ancho: 36, alinear: "right" }, { titulo: "Ingresos\nal mes", ancho: 46, alinear: "right" },
        { titulo: "Margen\nbruto", ancho: 40, alinear: "right" }, { titulo: "Gastos\nal mes", ancho: 42, alinear: "right" },
        { titulo: "Equil.\npropio", ancho: 42, alinear: "right" }, { titulo: "Equil.\ncon admón.", ancho: 56, alinear: "right" },
        { titulo: "Margen de\nseguridad", ancho: 50, alinear: "right" }, { titulo: "Estado", ancho: 56 },
      ];
      const filas: FilaTabla[] = puntos.map(c => ({
        celdas: [
          c.nombre, String(c.mesesOperacion), millones(c.ingresosMes), porcentaje(c.margenBruto), millones(c.gastosMes),
          c.equilibrioPropio === null ? "—" : millones(c.equilibrioPropio), { texto: c.equilibrioConAdmin === null ? "—" : millones(c.equilibrioConAdmin), negrita: true },
          c.margenSeguridad === null ? "—" : pct(c.margenSeguridad), { texto: "", pastilla: c.estado || "no_cubre" },
        ],
      }));
      columnas.forEach((c, i) => {
        if (i === 0) return;
        const titulo = Math.max(...c.titulo.toUpperCase().split("\n").map(l => anchoTexto(l, { tam: 6, espaciado: 0.6 })));
        const dato = i === columnas.length - 1 ? 46 : Math.max(...filas.map(f => { const celda = f.celdas[i]; return anchoTexto(typeof celda === "string" ? celda : celda.texto, { fuente: B, tam: 7.2 }); }));
        c.ancho = Math.ceil(Math.max(titulo, dato)) + 9;
      });
      columnas[0].ancho = W - 24 - columnas.reduce((t, c) => t + c.ancho, 0);
      const pie = "«Equilibrio propio» cubre solo los gastos del punto; «con administración» le suma su parte de los centros que no venden, repartida según los ingresos. Margen de seguridad: cuánto pueden caer los ingresos antes de perder.";
      seccion("Centros de costo", "Equilibrio y rentabilidad por punto de venta", informe.textoCentros, altoTarjetaTabla(columnas, filas.length, { titulo: true, subtitulo: true, pie }));
      tarjetaTabla("Equilibrio por punto de venta", "Promedio mensual de los meses en operación, millones", columnas, filas, { pie, tam: 7.2 });
    }
    {
      // Barras: si son muchos puntos se parten en páginas con la misma escala.
      const filas = [...puntos].sort((a, b) => b.resultado - a.resultado).map(c => ({ etiqueta: c.nombre, valor: c.resultado }));
      const rango: [number, number] = [Math.min(...filas.map(f => f.valor), 0), Math.max(...filas.map(f => f.valor), 0)];
      let pendientes = filas, primera = true;
      while (pendientes.length > 0) {
        const fijo = 42 + 16;
        if (y + fijo + pendientes.length * 13.5 > LIMITE && fijo + pendientes.length * 13.5 <= LIMITE - TOPE && y > TOPE) { nuevaPagina(); continue; }
        const caben = Math.floor((LIMITE - y - fijo) / 13.5);
        if (caben < Math.min(6, pendientes.length) && y > TOPE) { nuevaPagina(); continue; }
        const lote = pendientes.slice(0, Math.max(caben, 1));
        pendientes = pendientes.slice(lote.length);
        const alto = fijo + lote.length * 13.5;
        marco(MARGEN, y, W, alto);
        const cab = cabeceraTarjeta(MARGEN, y, `Resultado acumulado por punto de venta${primera ? "" : " (continuación)"}`, "Utilidad operativa después de repartir la administración, millones · azul: utilidad, rojo: pérdida");
        graficoBarrasH(MARGEN + 12, y + cab + 4, W - 24, lote, { divergente: true, rango });
        y += alto + 10;
        primera = false;
        if (pendientes.length > 0) nuevaPagina();
      }
    }
    if (meses.length > 1) {
      const maximo = Math.max(1, ...puntos.flatMap(c => meses.map(m => Math.abs(c.utilidadPorMes[m] || 0))));
      // Divergente: azul para utilidad, rojo para pérdida, gris neutro en cero.
      const tono = (v: number | null) => (v === null ? undefined : mezclar("#f3f2ef", v >= 0 ? "#86b6ef" : "#f0a3a3", Math.pow(Math.abs(v) / maximo, 0.7)));
      const anchoMes = anchoDeMes(W - 24 - 140, meses.length);
      const filas: FilaTabla[] = puntos.map(c => ({
        celdas: [c.nombre, ...meses.map(m => { const v = c.utilidadPorMes[m]; return v === null ? { texto: "—", color: TENUE } : { texto: millones(v), fondo: tono(v) }; })],
      }));
      tarjetaTabla("Mapa de utilidades", "Utilidad operativa propia por mes, millones · azul: utilidad, rojo: pérdida, raya: el punto aún no vendía",
        [{ titulo: "Punto de venta", ancho: W - 24 - anchoMes * meses.length }, ...abrevs.map(ab => ({ titulo: ab, ancho: anchoMes, alinear: "right" as const }))], filas, { tam: meses.length > 9 ? 6.8 : 7.5 });
    }
  }

  // =================== 5. Variaciones atípicas ===================
  if (informe.alertas.length > 0) {
    const cols = { nivel: 58, periodo: 56, partida: 132 };
    const anchoDetalle = W - 24 - cols.nivel - cols.periodo - cols.partida;
    const altos = informe.alertas.map(a => Math.max(
      altoTexto(a.detalle, anchoDetalle - 8, { tam: 7.5, interlinea: 1.5 }), altoTexto(a.partida, cols.partida - 8, { fuente: B, tam: 7.5, interlinea: 1.5 }), 11) + 9);
    const FIJO = 12 + 15 + 8;
    seccion("Alertas", "Variaciones atípicas", "Meses y cuentas que se salen del patrón del periodo. Las detecta el portal con reglas sobre las cifras; cada una pide una explicación, no implica un error.",
      FIJO + altos.slice(0, 4).reduce((t, h) => t + h, 0));
    // Las filas tienen alto variable: se reparten por página sin partir ninguna.
    let i = 0;
    while (i < informe.alertas.length) {
      let j = i, usado = 0;
      while (j < informe.alertas.length && y + FIJO + usado + altos[j] <= LIMITE) { usado += altos[j]; j++; }
      if (j - i < Math.min(3, informe.alertas.length - i) && y > TOPE) { nuevaPagina(); continue; }
      if (j === i) j = i + 1, usado = altos[i];
      const alto = FIJO + usado;
      marco(MARGEN, y, W, alto);
      let cx = MARGEN + 12;
      for (const [t, w] of [["Nivel", cols.nivel], ["Mes", cols.periodo], ["Partida", cols.partida], ["Qué pasó", anchoDetalle]] as const) {
        texto(t.toUpperCase(), cx + 4, y + 14, { tam: 6, color: TENUE, espaciado: 0.6 });
        cx += w;
      }
      let cy = y + 25;
      lineaH(MARGEN + 12, MARGEN + W - 12, cy, EJE, 0.6);
      for (let k = i; k < j; k++) {
        const a = informe.alertas[k];
        pastilla(MARGEN + 16, cy + 4, a.nivel);
        texto(a.periodo, MARGEN + 12 + cols.nivel + 4, cy + 5.5, { tam: 7.5, color: SEGUNDA });
        texto(a.partida, MARGEN + 12 + cols.nivel + cols.periodo + 4, cy + 5.5, { fuente: B, tam: 7.5, ancho: cols.partida - 8, interlinea: 1.5 });
        texto(a.detalle, MARGEN + 12 + cols.nivel + cols.periodo + cols.partida + 4, cy + 5.5, { tam: 7.5, color: SEGUNDA, ancho: anchoDetalle - 8, interlinea: 1.5 });
        cy += altos[k];
        if (k < j - 1) lineaH(MARGEN + 12, MARGEN + W - 12, cy, LINEA, 0.5);
      }
      y += alto + 10;
      i = j;
      if (i < informe.alertas.length) nuevaPagina();
    }
  }

  // =================== 6. Gastos ===================
  if (informe.gastos.grupos.length > 0) {
    const filas = informe.gastos.grupos.map(g => ({ etiqueta: g.nombre, valor: g.valor }));
    const alto = 42 + filas.length * 13.5 + 14;
    seccion("Estructura de costos", "Comportamiento de los gastos", informe.gastos.texto, alto);
    reservar(alto);
    marco(MARGEN, y, W, alto);
    const cab = cabeceraTarjeta(MARGEN, y, "Gastos por cuenta", `Acumulado ${informe.periodo}, millones`);
    graficoBarrasH(MARGEN + 12, y + cab + 4, W - 24, filas, { anchoEtiqueta: 190 });
    y += alto + 10;
    if (informe.gastos.crecen.length > 0) {
      const [m0, m1] = [meses[0], meses[meses.length - 1]];
      tarjetaTabla("Cuentas que más crecen", `${capital(MESES_NOMBRE[m0])} frente a ${MESES_NOMBRE[m1]}, millones`, [
        { titulo: "Cuenta", ancho: W - 24 - 68 * 4 }, { titulo: MESES_ABREV[m0], ancho: 68, alinear: "right" }, { titulo: MESES_ABREV[m1], ancho: 68, alinear: "right" },
        { titulo: "Cambio", ancho: 68, alinear: "right" }, { titulo: "Acumulado", ancho: 68, alinear: "right" },
      ], informe.gastos.crecen.map(c => ({
        celdas: [c.nombre, millones(c.inicial), millones(c.final), Number.isFinite(c.cambio) ? `+${porcentaje(c.cambio)}` : "Nueva", millones(c.acumulado)],
      })));
    }
  }

  // =================== 7. Balance ===================
  if (informe.balance) {
    const b = informe.balance;
    // Un título largo ("Saldo anterior a octubre") va en dos líneas.
    const enDos = (t: string) => {
      if (anchoTexto(t.toUpperCase(), { tam: 6, espaciado: 0.6 }) <= 82 || !t.includes(" ")) return t;
      const cortes = Array.from(t.matchAll(/ /g)).map(m => m.index as number);
      const corte = cortes.reduce((a, c) => (Math.abs(c - t.length / 2) < Math.abs(a - t.length / 2) ? c : a));
      return `${t.slice(0, corte)}\n${t.slice(corte + 1)}`;
    };
    const columnas: Columna[] = [
      { titulo: "Rubro", ancho: W - 24 - 90 * 3 }, { titulo: enDos(b.etiquetaInicial), ancho: 90, alinear: "right" },
      { titulo: enDos(b.etiquetaFinal), ancho: 90, alinear: "right" }, { titulo: "Variación", ancho: 90, alinear: "right" },
    ];
    const contra = /^\d{4}$/.test(b.etiquetaInicial) ? `al cierre de ${b.etiquetaInicial}` : `al ${b.etiquetaInicial.toLowerCase()}`;
    seccion("Balance", `Balance a ${b.etiquetaFinal.toLowerCase()}`, `Activo y pasivo por rubros según el balance de prueba cargado, frente ${contra}. El patrimonio incluye el resultado del ejercicio calculado del mismo balance.`,
      altoTarjetaTabla(columnas, b.filas.length));
    tarjetaTabla(null, undefined, columnas, b.filas.map(f => ({
      negrita: f.total, fondo: f.total ? FONDO : undefined,
      celdas: [f.titulo, num(f.inicial), num(f.final), { texto: `${f.final - f.inicial >= 0 ? "+" : ""}${millones(f.final - f.inicial)}`, color: f.final - f.inicial < -50_000 ? MAL : undefined }],
    })));
  }

  // =================== 8. Notas del contador ===================
  const tarjetaNota = (titulo: string, cuerpo: string, anchoAdorno: number, adorno: (x: number, yy: number) => void) => {
    const sangria = 12, anchoTitulo = W - 24 - anchoAdorno - 6;
    const altoTitulo = altoTexto(titulo, anchoTitulo, { fuente: B, tam: 9, interlinea: 1.5 });
    const altoCuerpo = cuerpo ? altoTexto(cuerpo, W - 24, { tam: 8.2, interlinea: 2.2 }) : 0;
    const alto = 12 + Math.max(altoTitulo, 12) + (cuerpo ? 7 + altoCuerpo : 0) + 7;
    reservar(alto);
    marco(MARGEN, y, W, alto);
    adorno(MARGEN + sangria, y + 11);
    texto(titulo, MARGEN + sangria + anchoAdorno + 6, y + 12.5, { fuente: B, tam: 9, ancho: anchoTitulo, interlinea: 1.5 });
    if (cuerpo) texto(cuerpo, MARGEN + sangria, y + 12 + Math.max(altoTitulo, 12) + 7, { tam: 8.2, color: SEGUNDA, ancho: W - 24, interlinea: 2.2 });
    y += alto + 7;
  };
  const anchoPastilla = (nivel: NivelAlerta) => anchoTexto(NIVEL[nivel].texto, { fuente: B, tam: 6.5 }) + 17;
  if (informe.notas.puntos.length > 0) {
    seccion("Balance, cumplimiento y riesgo fiscal", "Puntos de balance y tributarios", "Observaciones del contador sobre el periodo.", 70);
    for (const p of informe.notas.puntos) tarjetaNota(p.titulo || NIVEL[p.nivel].texto, p.texto, anchoPastilla(p.nivel), (x, yy) => { pastilla(x, yy, p.nivel); });
  }
  if (informe.notas.plan.length > 0) {
    seccion("Plan de acción", "Dónde poner la atención", "En el orden en que conviene atenderlas.", 70, "Plan de acción");
    informe.notas.plan.forEach((a, i) => tarjetaNota(a.titulo || `Acción ${i + 1}`, a.texto, 13, (x, yy) => {
      doc.circle(x + 6, yy + 6, 6.5).fill(MARCA);
      texto(String(i + 1), x, yy + 2.6, { fuente: B, tam: 7.5, color: "#ffffff", ancho: 12, alinear: "center" });
    }));
  }

  // Nota final
  reservar(34);
  y += 6;
  lineaH(MARGEN, MARGEN + W, y);
  texto(
    `Cifras tomadas del estado de resultados por mes${informe.hayCentros ? " y por centro de costo" : ""} cargado en AREDA Work${informe.balance ? ", y del balance de prueba" : ""}. ` +
    "Valores en millones de pesos, redondeados a un decimal. Los textos de lectura y las variaciones se generan con reglas sobre esas cifras; los puntos tributarios y el plan de acción son del contador.",
    MARGEN, y + 7, { tam: 6.8, color: TENUE, ancho: W, interlinea: 1.5 });

  // =================== Contenido, al pie de la portada ===================
  // Solo ahora se sabe en qué página quedó cada sección. Va en dos columnas,
  // anclado al pie de la portada, si el resumen dejó espacio.
  {
    const porColumna = Math.ceil(indice.length / 2), PASO = 17;
    const alto = 20 + porColumna * PASO;
    const yIndice = LIMITE - alto;
    if (indice.length >= 3 && finPortada + 14 <= yIndice) {
      doc.switchToPage(doc.bufferedPageRange().start);
      texto("CONTENIDO", MARGEN, yIndice, { fuente: B, tam: 7, color: AMBAR, espaciado: 1.4 });
      lineaH(MARGEN, MARGEN + W, yIndice + 13, MARCA, 1);
      const anchoI = (W - 28) / 2;
      indice.forEach((it, i) => {
        const ix = MARGEN + (i < porColumna ? 0 : anchoI + 28), iy = yIndice + 20 + (i % porColumna) * PASO;
        texto(String(i + 1).padStart(2, "0"), ix, iy + 0.5, { fuente: B, tam: 7.5, color: AMBAR });
        texto(it.titulo, ix + 18, iy, { tam: 8.5, color: TINTA, ancho: anchoI - 18 - 26, elipsis: true, alto: 10 });
        texto(String(it.pagina), ix, iy, { fuente: B, tam: 8.5, color: SEGUNDA, ancho: anchoI, alinear: "right" });
        lineaH(ix, ix + anchoI, iy + 12.5, LINEA, 0.5);
      });
    }
  }

  // =================== Encabezado y pie de cada página ===================
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    if (i > 0) {
      texto(`${cliente.razonSocial.toUpperCase()}${cliente.nit ? `  ·  NIT ${cliente.nit}` : ""}`, MARGEN, 30, { fuente: B, tam: 6.8, color: SEGUNDA, espaciado: 0.4 });
      texto(`Informe de gestión ${informe.periodo}`, MARGEN, 30, { tam: 6.8, color: TENUE, ancho: W, alinear: "right" });
      lineaH(MARGEN, MARGEN + W, 42);
      doc.rect(MARGEN, 41.4, 26, 1.2).fill(AMBAR);
    }
    lineaH(MARGEN, MARGEN + W, ALTO - 38);
    texto("Cifras en millones de pesos (COP)", MARGEN, ALTO - 30, { tam: 6.8, color: TENUE });
    texto("Areda S.A.S.", MARGEN, ALTO - 30, { tam: 6.8, color: TENUE, ancho: W, alinear: "center" });
    texto(`Página ${i + 1} de ${paginas.count}`, MARGEN, ALTO - 30, { tam: 6.8, color: TENUE, ancho: W, alinear: "right" });
  }
  doc.end();
  return listo;
}
