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
function setHablando(valor: string | null) { hablando = valor; oyentes.forEach(fn => fn()); }

export function useHablando(): string | null {
  const [valor, setValor] = useState(hablando);
  useEffect(() => {
    const fn = () => setValor(hablando);
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
  }, []);
  return valor;
}

let turno = 0;

/** Dice las frases una tras otra. Cada frase va como una locución aparte:
 * los navegadores cortan las locuciones muy largas, y así además se puede
 * detener entre frases. `interrumpir` calla lo que se esté diciendo antes
 * de empezar (lo usa el informe); sin eso, se pone en cola. */
export function hablar(frases: string[], opciones: { quien?: string; interrumpir?: boolean } = {}): boolean {
  const textos = frases.map(f => f.trim()).filter(Boolean);
  if (!puedeHablar() || textos.length === 0) return false;
  const sintesis = window.speechSynthesis;
  if (opciones.interrumpir) sintesis.cancel();
  const miTurno = ++turno;
  const voz = elegirVoz();
  // Si se suma a algo que ya se está diciendo, el botón de eso sigue activo.
  setHablando(!opciones.interrumpir && hablando ? hablando : opciones.quien ?? "avisos");
  textos.forEach((texto, i) => {
    const locucion = new SpeechSynthesisUtterance(texto);
    locucion.lang = voz?.lang || "es-CO";
    if (voz) locucion.voice = voz;
    locucion.rate = 1;
    if (i === textos.length - 1) {
      const terminar = () => { if (turno === miTurno) setHablando(null); };
      locucion.onend = terminar;
      locucion.onerror = terminar;
    }
    sintesis.speak(locucion);
  });
  return true;
}

export function callar(): void {
  if (!puedeHablar()) return;
  turno++;
  window.speechSynthesis.cancel();
  setHablando(null);
}
