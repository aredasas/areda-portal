import { describe, expect, it } from "vitest";
import { calcularJornada, formatearHoras } from "../shared/jornada";
import {
  armarFrasesInforme, calcularPuntaje, diaBogota, duracionHablada, entregadaATiempo, enumerar, fechaLarga,
  inicioDiaBogota, lunesDeLaSemana, nombresCortos, resumirActividadPorPersona, resumirHoras,
  type EventoActividad, type FilaColaborador,
} from "./oficinaEstadistaDb";

// Marcas en hora de Bogotá (UTC-5): "08:00" → 13:00Z.
const marca = (type: string, dia: string, hora: string, userId = 1) => ({ userId, type, timestamp: new Date(`${dia}T${hora}:00-05:00`) });
const H = 60 * 60 * 1000;

describe("jornada — horas trabajadas de un día", () => {
  it("mañana + tarde, igual que la pantalla de Asistencia", () => {
    const r = calcularJornada([marca("inicio", "2026-10-01", "08:00"), marca("salida_almuerzo", "2026-10-01", "12:00"), marca("regreso_almuerzo", "2026-10-01", "14:00"), marca("fin", "2026-10-01", "18:30")]);
    expect(r).toEqual({ ms: 8.5 * H, completa: true });
    expect(formatearHoras(r.ms)).toBe("8h 30m");
  });
  it("jornada continua (sin marcas de almuerzo): de inicio a fin", () => {
    expect(calcularJornada([marca("inicio", "2026-10-01", "07:00"), marca("fin", "2026-10-01", "15:00")])).toEqual({ ms: 8 * H, completa: true });
  });
  it("solo cuenta bloques cerrados y avisa si quedó uno abierto", () => {
    expect(calcularJornada([marca("inicio", "2026-10-01", "08:00")])).toEqual({ ms: 0, completa: false });
    expect(calcularJornada([marca("inicio", "2026-10-01", "08:00"), marca("salida_almuerzo", "2026-10-01", "12:00"), marca("regreso_almuerzo", "2026-10-01", "14:00")])).toEqual({ ms: 4 * H, completa: false });
    expect(calcularJornada([marca("inicio", "2026-10-01", "08:00"), marca("salida_almuerzo", "2026-10-01", "12:00")])).toEqual({ ms: 4 * H, completa: true });
    // salió a almorzar y marcó fin sin marcar el regreso: la tarde no se puede medir
    expect(calcularJornada([marca("inicio", "2026-10-01", "08:00"), marca("salida_almuerzo", "2026-10-01", "12:00"), marca("fin", "2026-10-01", "18:00")])).toEqual({ ms: 4 * H, completa: false });
  });
  it("si una marca se repite vale la última; sin marcas es 0", () => {
    expect(calcularJornada([marca("inicio", "2026-10-01", "08:00"), marca("inicio", "2026-10-01", "09:00"), marca("fin", "2026-10-01", "17:00")]).ms).toBe(8 * H);
    expect(calcularJornada([])).toEqual({ ms: 0, completa: true });
  });
});

describe("fechas en hora de Colombia", () => {
  it("el día cambia a la medianoche de Bogotá, no a la de UTC", () => {
    expect(diaBogota(new Date("2026-10-02T04:59:00Z"))).toBe("2026-10-01"); // 11:59 pm del 1
    expect(diaBogota(new Date("2026-10-02T05:00:00Z"))).toBe("2026-10-02");
    expect(inicioDiaBogota("2026-10-02").toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });
  it("lunes de la semana y fecha larga", () => {
    expect(lunesDeLaSemana("2026-10-02")).toBe("2026-09-28"); // viernes → lunes
    expect(lunesDeLaSemana("2026-09-28")).toBe("2026-09-28");
    expect(lunesDeLaSemana("2026-10-04")).toBe("2026-09-28"); // domingo
    expect(fechaLarga("2026-10-02")).toBe("viernes 2 de octubre");
  });
  it("entregar el mismo día del vencimiento es a tiempo", () => {
    const vence = new Date("2026-10-02T00:00:00Z"); // así se guarda dueDate
    expect(entregadaATiempo(new Date("2026-10-02T15:00:00-05:00"), vence)).toBe(true);
    expect(entregadaATiempo(new Date("2026-10-02T23:59:00-05:00"), vence)).toBe(true);
    expect(entregadaATiempo(new Date("2026-10-03T00:00:00-05:00"), vence)).toBe(false);
    expect(entregadaATiempo(new Date("2026-09-30T10:00:00-05:00"), vence)).toBe(true);
  });
});

describe("horas por período", () => {
  // Hoy = viernes 2 de octubre de 2026; lunes = 28 de septiembre.
  const periodos = { hoy: "2026-10-02", diaAnterior: "2026-10-01", lunes: "2026-09-28", primeroDeMes: "2026-10-01" };
  const diaCompleto = (dia: string, userId = 1) => [marca("inicio", dia, "08:00", userId), marca("salida_almuerzo", dia, "12:00", userId), marca("regreso_almuerzo", dia, "14:00", userId), marca("fin", dia, "18:00", userId)];

  it("suma día anterior, semana (lunes a hoy) y mes (día 1 a hoy) por separado", () => {
    const horas = resumirHoras([
      ...diaCompleto("2026-09-28"), ...diaCompleto("2026-09-29"), ...diaCompleto("2026-09-30"), // semana, mes anterior
      ...diaCompleto("2026-10-01"),
      marca("inicio", "2026-10-02", "08:00"), marca("salida_almuerzo", "2026-10-02", "12:00"), marca("regreso_almuerzo", "2026-10-02", "14:00"), // hoy, tarde en curso
      ...diaCompleto("2026-10-01", 2).slice(0, 3), // usuario 2: ayer sin marcar fin
    ], periodos);
    expect(horas.get(1)).toEqual({ diaAnteriorMs: 8 * H, semanaMs: 36 * H, mesMs: 12 * H, diasIncompletos: 0 });
    expect(horas.get(2)).toEqual({ diaAnteriorMs: 4 * H, semanaMs: 4 * H, mesMs: 4 * H, diasIncompletos: 1 });
  });
  it("una marca a las 11 pm cuenta en su día de Colombia", () => {
    const horas = resumirHoras([marca("inicio", "2026-10-01", "15:00"), marca("fin", "2026-10-01", "23:30")], periodos);
    expect(horas.get(1)!.diaAnteriorMs).toBe(8.5 * H);
  });
});

describe("nombres para la voz", () => {
  it("primer nombre; con homónimos, dos palabras", () => {
    const n = nombresCortos([
      { id: 1, name: "JESSICA PAOLA GOMEZ" }, { id: 2, name: "maría fernanda restrepo" }, { id: 3, name: "María Camila Ortiz" },
      { id: 4, name: "Arlex" }, { id: 5, name: null }, { id: 6, name: "Juan Pérez" }, { id: 7, name: "Juan Pérez" },
    ]);
    expect(n.get(1)).toBe("Jessica");
    expect(n.get(2)).toBe("María Fernanda");
    expect(n.get(3)).toBe("María Camila");
    expect(n.get(4)).toBe("Arlex");
    expect(n.get(5)).toBe("Alguien");
    expect(n.get(6)).toBe("Juan Pérez");
  });
  it("duraciones y enumeraciones habladas", () => {
    expect(duracionHablada(7.5 * H)).toBe("7 horas y 30 minutos");
    expect(duracionHablada(1 * H)).toBe("1 hora");
    expect(duracionHablada(0.75 * H)).toBe("45 minutos");
    expect(duracionHablada(H + 60000)).toBe("1 hora y 1 minuto");
    expect(duracionHablada(0)).toBe("sin registro");
    expect(enumerar(["a"])).toBe("a");
    expect(enumerar(["a", "b"])).toBe("a y b");
    expect(enumerar(["a", "b", "c"])).toBe("a, b y c");
  });
});

describe("puntaje de eficiencia", () => {
  const base = { entregas: 10, devoluciones: 0, entregasConFecha: 10, aTiempo: 10, porTerminar: 5, vencidas: 0 };
  it("100 cuando todo va a tiempo, sin devoluciones y sin vencidas", () => {
    expect(calcularPuntaje(base)).toEqual({ puntaje: 100, puntualidad: 1, calidad: 1, alDia: 1 });
  });
  it("50 % puntualidad + 30 % calidad + 20 % al día", () => {
    // 8/10 a tiempo (0.8), 2 devoluciones de 10 (0.8), 1 vencida de 5 (0.8) → 80
    expect(calcularPuntaje({ ...base, aTiempo: 8, devoluciones: 2, vencidas: 1 }).puntaje).toBe(80);
    // 5/10 a tiempo → 25 + 30 + 20 = 75
    expect(calcularPuntaje({ ...base, aTiempo: 5 }).puntaje).toBe(75);
    // todo devuelto → 50 + 0 + 20 = 70
    expect(calcularPuntaje({ ...base, devoluciones: 10 }).puntaje).toBe(70);
    // más devoluciones que entregas no baja de 0 en calidad
    expect(calcularPuntaje({ ...base, devoluciones: 15 }).calidad).toBe(0);
  });
  it("sin entregas con fecha límite, reparte el peso entre calidad y al día", () => {
    expect(calcularPuntaje({ ...base, entregasConFecha: 0, aTiempo: 0, devoluciones: 5, vencidas: 0 })).toEqual({ puntaje: 70, puntualidad: null, calidad: 0.5, alDia: 1 });
  });
  it("con menos de 3 entregas no puntúa", () => {
    expect(calcularPuntaje({ ...base, entregas: 2 }).puntaje).toBeNull();
    expect(calcularPuntaje({ ...base, entregas: 0, entregasConFecha: 0, aTiempo: 0 }).puntaje).toBeNull();
    expect(calcularPuntaje({ ...base, entregas: 3 }).puntaje).toBe(100);
  });
});

describe("informe hablado", () => {
  const evento = (clave: string, tipo: EventoActividad["tipo"], usuarioId: number, nombreCorto: string): EventoActividad =>
    ({ clave, tipo, cuando: new Date("2026-10-02T15:00:00Z"), usuarioId, nombre: nombreCorto, nombreCorto, texto: "", voz: "" });
  const fila = (userId: number, nombreCorto: string, extra: Partial<FilaColaborador>): FilaColaborador => ({
    userId, nombre: nombreCorto, nombreCorto, porTerminar: 0, vencidas: 0, devueltas: 0, porCompletar: 0,
    horas: { diaAnteriorMs: 0, semanaMs: 0, mesMs: 0, diasIncompletos: 0 },
    eficiencia: { entregas: 0, devoluciones: 0, entregasConFecha: 0, aTiempo: 0, porTerminar: 0, vencidas: 0, puntaje: null, puntualidad: null, calidad: null, alDia: 1 },
    posicion: null, ...extra,
  });

  it("resume la actividad por persona con concordancia de número", () => {
    expect(resumirActividadPorPersona([
      evento("h-1", "entrega", 1, "Jessica"), evento("h-2", "entrega", 1, "Jessica"), evento("c-1", "comentario", 1, "Jessica"),
      evento("l-1", "lectura", 2, "Carlos"), evento("l-2", "lecturas_marcadas", 2, "Carlos"), evento("l-3", "lectura", 2, "Carlos"),
      evento("h-3", "entrega", 3, "Ana"),
    ])).toEqual([
      "Jessica entregó 2 trabajos para revisión y comentó 1 vez.",
      "Ana entregó 1 trabajo para revisión.",
      "Carlos revisó sus notificaciones 3 veces.",
    ]);
  });

  it("arma el informe completo, frase por frase", () => {
    const frases = armarFrasesInforme({
      generadoEn: new Date("2026-10-02T15:00:00Z"), hoy: "2026-10-02", diaAnterior: { clave: "2026-10-01", etiqueta: "ayer" },
      colaboradores: [
        fila(1, "Jessica", { porTerminar: 5, vencidas: 1, devueltas: 1, porCompletar: 2, posicion: 1, horas: { diaAnteriorMs: 7.5 * H, semanaMs: 30 * H, mesMs: 12 * H, diasIncompletos: 0 }, eficiencia: { entregas: 10, devoluciones: 1, entregasConFecha: 8, aTiempo: 8, porTerminar: 5, vencidas: 1, puntaje: 93, puntualidad: 1, calidad: 0.9, alDia: 0.8 } }),
        fila(2, "Carlos", { porTerminar: 1, posicion: 2, eficiencia: { entregas: 4, devoluciones: 2, entregasConFecha: 4, aTiempo: 2, porTerminar: 1, vencidas: 0, puntaje: 60, puntualidad: 0.5, calidad: 0.5, alDia: 1 } }),
        fila(3, "Ana", { devueltas: 2, eficiencia: { entregas: 1, devoluciones: 0, entregasConFecha: 0, aTiempo: 0, porTerminar: 0, vencidas: 0, puntaje: null, puntualidad: null, calidad: 1, alDia: 1 } }),
      ],
      sinResponsable: { porTerminar: 2, vencidas: 0, devueltas: 0, porCompletar: 0 },
      totales: { porTerminar: 8, vencidas: 1, devueltas: 3, porCompletar: 2 },
      actividadHoy: [evento("h-1", "entrega", 1, "Jessica")],
    });
    expect(frases).toEqual([
      "Informe del equipo, viernes 2 de octubre.",
      "Novedades de hoy: 1 movimiento.",
      "Jessica entregó 1 trabajo para revisión.",
      "Pendientes. En total hay 8 tareas por terminar, 3 devueltas para corrección y 2 por completar.",
      "Jessica: 5 por terminar, 1 vencida, 1 devuelta y 2 por completar.",
      "Carlos: 1 por terminar.",
      "Ana: 2 devueltas.",
      "Sin responsable asignado: 2 por terminar.",
      "Horas trabajadas.",
      "Jessica: ayer, 7 horas y 30 minutos; esta semana, 30 horas; este mes, 12 horas.",
      "Sin marcaciones de jornada: Carlos y Ana.",
      "Ranking de eficiencia de los últimos 30 días.",
      "Primer lugar: Jessica, con 93 puntos.",
      "Segundo lugar: Carlos, con 60 puntos.",
      "Con muy pocas entregas para puntuar: Ana.",
    ]);
  });

  it("sin datos dice que no hay, en vez de callar", () => {
    const frases = armarFrasesInforme({
      generadoEn: new Date(), hoy: "2026-10-05", diaAnterior: { clave: "2026-10-02", etiqueta: "el viernes 2 de octubre" },
      colaboradores: [], sinResponsable: { porTerminar: 0, vencidas: 0, devueltas: 0, porCompletar: 0 },
      totales: { porTerminar: 0, vencidas: 0, devueltas: 0, porCompletar: 0 }, actividadHoy: [],
    });
    expect(frases).toEqual([
      "Informe del equipo, lunes 5 de octubre.",
      "Hoy todavía no hay novedades del equipo.",
      "Pendientes. En total hay 0 tareas por terminar, 0 devueltas para corrección y 0 por completar.",
      "Horas trabajadas: nadie ha marcado jornada este mes.",
      "Ranking de eficiencia: todavía no hay suficientes entregas en los últimos 30 días para armarlo.",
    ]);
  });
});
