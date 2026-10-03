import { useEffect, useState } from "react";

/** Voz de la Oficina: síntesis de voz del navegador (Web Speech API), sin
 * costo ni cuenta externa. Aquí vive todo lo que habla — los avisos en
 * vivo (OficinaVozGlobal) y el informe que se pide con un botón.
 *
 * Dos cosas que impone el navegador y que no se pueden evitar desde el
 * código:
 *   - Solo puede hablar después de que la persona haya hecho al menos un
 *     clic en la página desde que la cargó (regla contra el audio no
 *     solicitado).
 *   - El portal debe estar abierto en alguna pestaña del navegador (puede
 *     ser otra pestaña distinta a la que se está mirando). */

const VOZ_KEY = "oficina-voz-activa";
const EVENTO_VOZ = "oficina-voz-cambio";

export function puedeHablar(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** ¿Están activados los avisos de voz? (lo decide el botón "Voz" de la Oficina). */
export function vozActivada(): boolean {
  try { return localStorage.getItem(VOZ_KEY) === "1"; } catch { return false; }
}

export function setVozActivada(activa: boolean): void {
  try { localStorage.setItem(VOZ_KEY, activa ? "1" : "0"); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(EVENTO_VOZ));
}

/** Estado del botón "Voz", sincronizado entre componentes y pestañas. */
export function useVozActivada(): boolean {
  const [activa, setActiva] = useState(vozActivada);
  useEffect(() => {
    const actualizar = () => setActiva(vozActivada());
    window.addEventListener(EVENTO_VOZ, actualizar);
    window.addEventListener("storage", actualizar);
    return () => { window.removeEventListener(EVENTO_VOZ, actualizar); window.removeEventListener("storage", actualizar); };
  }, []);
  return activa;
}

/** La mejor voz en español que tenga el equipo: colombiana si existe, luego
 * cualquier latinoamericana, luego cualquier español. */
function elegirVoz(): SpeechSynthesisVoice | null {
  const voces = window.speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith("es"));
  if (voces.length === 0) return null;
  const preferencia = ["es-co", "es-419", "es-mx", "es-us", "es-"];
  for (const prefijo of preferencia) {
    const voz = voces.find(v => v.lang.toLowerCase().replace("_", "-").startsWith(prefijo));
    if (voz) return voz;
  }
  return voces[0];
}

// ---- Quién está hablando (para que los botones muestren "Detener") ----
/** Identificador de lo que se está diciendo ("informe", "avisos") o null. */
let hablando: string | null = null;
const oyentes = new Set<() => void>();
function setHablando(valor: string | null) { if (hablando === valor) return; hablando = valor; oyentes.forEach(fn => fn()); }

export function useHablando(): string | null {
  const [valor, setValor] = useState(hablando);
  useEffect(() => {
    const fn = () => setValor(hablando);
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
  }, []);
  return valor;
}

// ---- Primer clic o tecla en la página ----
// El navegador solo deja hablar a una página en la que la persona ya hizo
// clic o escribió algo. Lo que no se pudo decir antes se dice en ese momento.
const alGesto = new Set<() => void>();
if (typeof window !== "undefined") {
  const avisar = () => alGesto.forEach(fn => { try { fn(); } catch { /* un oyente no debe tumbar a los demás */ } });
  // Con el ratón basta presionar; en pantallas táctiles el permiso llega al
  // soltar el dedo, por eso se escuchan los dos momentos.
  for (const evento of ["pointerdown", "pointerup", "keydown"]) window.addEventListener(evento, avisar, { capture: true, passive: true });
}
/** Llama a `fn` en cada clic o tecla (para reintentar lo que el navegador no dejó decir). */
export function alHacerClic(fn: () => void): () => void {
  alGesto.add(fn);
  return () => { alGesto.delete(fn); };
}

// ---- Cola propia de locuciones ----
// Se dice una frase a la vez y se vigila cada una. La cola del navegador no
// es confiable: en Chrome una locución que se corta (pestaña en segundo
// plano, frase muy larga) nunca avisa que terminó y deja mudas a todas las
// que vienen detrás, hasta recargar la página.
type Locucion = { texto: string; quien: string; alFallar?: (texto: string, motivo: string) => void };
let cola: Locucion[] = [];
let actual: Locucion | null = null;
/** Cambia cada vez que se calla o se interrumpe: lo que quedó a medias de antes ya no cuenta. */
let generacion = 0;
let vigia = 0;
let latido = 0;

/** Frases cortas: una locución de más de ~15 segundos se corta en Chrome. */
export function trocear(texto: string, max = 190): string[] {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio ? [limpio] : [];
  const trozos: string[] = [];
  let resto = limpio;
  while (resto.length > max) {
    const ventana = resto.slice(0, max + 1);
    // El corte más natural que haya: punto, punto y coma, coma, o un espacio.
    const corte = Math.max(ventana.lastIndexOf(". "), ventana.lastIndexOf("; "), ventana.lastIndexOf(": "));
    const coma = ventana.lastIndexOf(", ");
    const espacio = ventana.lastIndexOf(" ");
    const hasta = corte > max * 0.4 ? corte + 1 : coma > max * 0.4 ? coma + 1 : espacio > 0 ? espacio : max;
    trozos.push(resto.slice(0, hasta).trim());
    resto = resto.slice(hasta).trim();
  }
  if (resto) trozos.push(resto);
  return trozos;
}

function detenerVigilancia() {
  window.clearTimeout(vigia);
  window.clearInterval(latido);
}

function siguiente() {
  if (actual) return;
  const locucion = cola.shift();
  if (!locucion) { setHablando(null); return; }
  actual = locucion;
  setHablando(locucion.quien);
  const sintesis = window.speechSynthesis;
  const miGeneracion = generacion;
  let cerrada = false;
  const cerrar = (motivo: string | null) => {
    if (cerrada) return;
    cerrada = true;
    detenerVigilancia();
    if (miGeneracion !== generacion) return; // se calló o se interrumpió: la cola ya es otra
    actual = null;
    if (motivo) { try { locucion.alFallar?.(locucion.texto, motivo); } catch { /* el aviso de fallo no debe frenar la cola */ } }
    siguiente();
  };
  const decir = () => {
    if (cerrada || miGeneracion !== generacion) return;
    const voz = elegirVoz();
    const u = new SpeechSynthesisUtterance(locucion.texto);
    u.lang = voz?.lang || "es-CO";
    if (voz) u.voice = voz;
    u.rate = 1;
    u.onend = () => cerrar(null);
    // "interrupted"/"canceled" es que alguien la calló a propósito, no un fallo.
    u.onerror = (e) => cerrar(e.error === "interrupted" || e.error === "canceled" ? null : e.error || "error");
    // Si el navegador no responde en un tiempo razonable para el largo de
    // la frase, se da por perdida y se sigue con la siguiente.
    vigia = window.setTimeout(() => { try { sintesis.cancel(); } catch { /* nada que cancelar */ } cerrar("sin-respuesta"); }, 8000 + locucion.texto.length * 130);
    // Al volver de segundo plano Chrome a veces deja la voz "en pausa".
    latido = window.setInterval(() => { if (sintesis.paused) sintesis.resume(); }, 3000);
    try { sintesis.speak(u); } catch { cerrar("error"); }
  };
  try {
    if (sintesis.paused) sintesis.resume();
    // Algo colgado de antes (no debería haber nada: solo se dice una a la
    // vez): se limpia, y se espera un instante porque Chrome descarta lo
    // que se le pide decir justo después de cancelar.
    if (sintesis.speaking || sintesis.pending) { sintesis.cancel(); window.setTimeout(decir, 150); } else decir();
  } catch { cerrar("error"); }
}

/** Dice las frases una tras otra. `interrumpir` calla lo que se esté
 * diciendo antes de empezar (lo usa el informe); sin eso, se pone en cola.
 * `alFallar` avisa por cada frase que el navegador no dejó decir (motivo
 * "not-allowed": falta un clic en la página). */
export function hablar(frases: string[], opciones: { quien?: string; interrumpir?: boolean; alFallar?: (texto: string, motivo: string) => void } = {}): boolean {
  const textos = frases.flatMap(f => trocear(f));
  if (!puedeHablar() || textos.length === 0) return false;
  if (opciones.interrumpir) {
    generacion++;
    detenerVigilancia();
    cola = [];
    actual = null;
    try { window.speechSynthesis.cancel(); } catch { /* nada que cancelar */ }
  }
  const quien = opciones.quien ?? "avisos";
  cola.push(...textos.map(texto => ({ texto, quien, alFallar: opciones.alFallar })));
  // Tras un cancel() Chrome necesita un instante antes de aceptar otra frase.
  if (opciones.interrumpir) { setHablando(quien); window.setTimeout(siguiente, 150); } else siguiente();
  return true;
}

export function callar(): void {
  if (!puedeHablar()) return;
  generacion++;
  detenerVigilancia();
  cola = [];
  actual = null;
  try { window.speechSynthesis.cancel(); } catch { /* nada que cancelar */ }
  setHablando(null);
}

// Las voces se cargan solas un momento después de abrir la página: pedirlas
// ya deja lista la voz en español para el primer aviso.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  try { window.speechSynthesis.getVoices(); } catch { /* sin voces todavía */ }
}
