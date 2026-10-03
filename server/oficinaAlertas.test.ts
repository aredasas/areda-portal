import { describe, expect, it } from "vitest";
import { alertasDeTarea, yaAtendida } from "./oficinaDb";
import { armarSeguimiento } from "./oficinaEstadistaDb";
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

describe("seguimiento: mensajes míos que el equipo no ha leído", () => {
  const nombres = new Map([[2, { nombre: "Jennifer Quiroz", nombreCorto: "Jennifer" }], [3, { nombre: "Jessica Ochoa", nombreCorto: "Jessica" }]]);
  const mensaje = (clave: string, destinatarioId: number, dias: number, estado: "sin_leer" | "marcado_sin_abrir" = "sin_leer") => ({
    clave, estado, destinatarioId, tipo: "comentario", descripcion: "Comentario en la tarea «X»", extracto: null,
    enviadoAt: new Date(Date.UTC(2026, 9, 2 - dias, 15)), dias, enlace: "/tareas?taskId=1",
  });

  it("sin pendientes lo dice, en vez de callar", () => {
    const s = armarSeguimiento([], nombres);
    expect(s).toMatchObject({ total: 0, sinLeer: 0, marcadosSinAbrir: 0, porPersona: [], mensajes: [] });
    expect(s.frases).toEqual(["Mensajes: todo lo que le has escrito al equipo está leído."]);
  });

  it("cuenta por persona, primero quien más tiene, y los mensajes del más antiguo al más reciente", () => {
    const s = armarSeguimiento([
      mensaje("a", 3, 1), mensaje("b", 2, 0), mensaje("c", 2, 5), mensaje("d", 2, 2, "marcado_sin_abrir"),
    ], nombres);
    expect(s).toMatchObject({ total: 4, sinLeer: 3, marcadosSinAbrir: 1 });
    expect(s.porPersona).toEqual([
      { usuarioId: 2, nombre: "Jennifer Quiroz", nombreCorto: "Jennifer", total: 3, sinLeer: 2, marcadosSinAbrir: 1, masAntiguoDias: 5 },
      { usuarioId: 3, nombre: "Jessica Ochoa", nombreCorto: "Jessica", total: 1, sinLeer: 1, marcadosSinAbrir: 0, masAntiguoDias: 1 },
    ]);
    expect(s.mensajes.map(m => m.clave)).toEqual(["c", "d", "b", "a"]);
    expect(s.mensajes[0].destinatario).toBe("Jennifer Quiroz");
    expect(s.frases).toEqual([
      "Mensajes tuyos pendientes de lectura: 4.",
      "Jennifer: 2 sin leer y 1 marcado como leído sin abrirlo; el más antiguo es de hace 5 días.",
      "Jessica: 1 sin leer; el más antiguo es de ayer.",
    ]);
  });
});
