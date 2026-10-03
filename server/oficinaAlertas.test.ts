import { describe, expect, it } from "vitest";
import { alertasDeTarea, yaAtendida } from "./oficinaDb";
import { trocear } from "../client/src/lib/vozOficina";

// Hoy = 2 de octubre de 2026 (así guarda las fechas el portal: medianoche UTC).
const HOY = new Date("2026-10-02T00:00:00Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const tarea = (cambios: Partial<{ status: string; dueDate: Date | null; reviewStatus: string | null; updatedAt: Date }> = {}) => ({
  status: "pendiente", dueDate: null as Date | null, reviewStatus: null as string | null, updatedAt: dia("2026-10-01"), ...cambios,
});

describe("alertas de la Oficina sobre una tarea", () => {
  it("vencida: sin terminar y con la fecha límite ya pasada", () => {
    expect(alertasDeTarea(tarea({ dueDate: dia("2026-07-21") }), HOY)).toEqual(["tarea_vencida"]);
    expect(alertasDeTarea(tarea({ status: "en_progreso", dueDate: dia("2026-10-01") }), HOY)).toEqual(["tarea_vencida"]);
    // vence hoy o después: todavía no
    expect(alertasDeTarea(tarea({ dueDate: dia("2026-10-02") }), HOY)).toEqual([]);
    expect(alertasDeTarea(tarea({ dueDate: dia("2026-10-15") }), HOY)).toEqual([]);
  });

  it("al terminar o cancelar la tarea, deja de tener alertas", () => {
    // La tarea de la captura: vencida el 21 de julio y ya marcada como terminada.
    expect(alertasDeTarea(tarea({ status: "completada", dueDate: dia("2026-07-21") }), HOY)).toEqual([]);
    expect(alertasDeTarea(tarea({ status: "cancelada", dueDate: dia("2026-07-21") }), HOY)).toEqual([]);
    expect(alertasDeTarea(tarea({ status: "completada", reviewStatus: "correccion", updatedAt: dia("2026-09-01") }), HOY)).toEqual([]);
  });

  it("represada: devuelta para corregir o completar y sin movimiento hace más de 5 días", () => {
    expect(alertasDeTarea(tarea({ reviewStatus: "correccion", dueDate: dia("2026-12-01"), updatedAt: dia("2026-09-20") }), HOY)).toEqual(["tarea_represada"]);
    expect(alertasDeTarea(tarea({ reviewStatus: "completar", dueDate: dia("2026-12-01"), updatedAt: dia("2026-09-26") }), HOY)).toEqual(["tarea_represada"]);
    expect(alertasDeTarea(tarea({ reviewStatus: "correccion", dueDate: dia("2026-12-01"), updatedAt: dia("2026-09-28") }), HOY)).toEqual([]);
    // además vencida: las dos alertas
    expect(alertasDeTarea(tarea({ reviewStatus: "correccion", dueDate: dia("2026-09-01"), updatedAt: dia("2026-09-10") }), HOY)).toEqual(["tarea_vencida", "tarea_represada"]);
  });

  it("olvidada: sin fecha límite y sin tocarse hace más de 10 días", () => {
    expect(alertasDeTarea(tarea({ updatedAt: dia("2026-09-10") }), HOY)).toEqual(["tarea_olvidada"]);
    expect(alertasDeTarea(tarea({ updatedAt: dia("2026-09-25") }), HOY)).toEqual([]);
    expect(alertasDeTarea(tarea({ updatedAt: dia("2026-09-10"), dueDate: dia("2026-12-01") }), HOY)).toEqual([]);
  });

  it("una alerta ya atendida no vuelve a salir mientras la tarea siga igual", () => {
    const atendida = new Date("2026-10-01T15:00:00Z").getTime();
    expect(yaAtendida(undefined, new Date("2026-09-01T00:00:00Z"))).toBe(false); // nunca se atendió
    expect(yaAtendida(atendida, new Date("2026-09-20T10:00:00Z"))).toBe(true);   // la tarea no se ha movido desde entonces
    expect(yaAtendida(atendida, new Date("2026-10-01T15:00:00Z"))).toBe(true);   // se cerró en el mismo segundo en que se terminó
    expect(yaAtendida(atendida, new Date("2026-10-02T09:00:00Z"))).toBe(false);  // se reabrió o se devolvió después: vuelve a avisar
  });
});

describe("voz: frases cortas", () => {
  it("deja igual una frase corta y limpia espacios", () => {
    expect(trocear("  Jessica terminó   la tarea.  ")).toEqual(["Jessica terminó la tarea."]);
    expect(trocear("   ")).toEqual([]);
  });
  it("parte una frase larga en pausas naturales, sin perder palabras", () => {
    const larga = "Jennifer comentó en la tarea Revisión de cálculo de intereses a las cesantías y fallas de Genera Software, de Pérez Ospina Oscar Javier: ya quedó el cálculo corregido, faltan los soportes de enero y febrero; los subo mañana temprano. Además hay que revisar la liquidación de vacaciones del año pasado, que tiene el mismo error.";
    const trozos = trocear(larga);
    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(191);
    expect(trozos.join(" ")).toBe(larga);
  });
  it("corta por espacios aunque no haya puntuación", () => {
    const sinPausas = Array.from({ length: 80 }, (_, i) => `palabra${i}`).join(" ");
    const trozos = trocear(sinPausas);
    expect(trozos.join(" ")).toBe(sinPausas);
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(190);
  });
});
