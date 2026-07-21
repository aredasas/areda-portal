// Bogotá no tiene horario de verano — es UTC-5 todo el año, así que un
// offset fijo es correcto y no necesita la API de Intl con timezone.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** "Hoy" en fecha calendario de Bogotá, como medianoche UTC de ese día —
 * misma convención con la que se guardan dueDate de tareas y vencimientos
 * (UTC midnight del día calendario). Usar SIEMPRE esta función (nunca
 * `new Date(Date.UTC(now.getUTCFullYear(), ...))` directo) para calcular
 * "hoy" en cualquier comparación de vencimientos — de lo contrario, el día
 * cambia a las 7:00pm hora Colombia (medianoche UTC) en vez de a
 * medianoche Colombia, y todo lo que vence "mañana" se muestra como que
 * vence "hoy" durante esas 5 horas cada noche. */
export function bogotaTodayUTCMidnight(referenceInstant: Date = new Date()): Date {
  const bogotaInstant = new Date(referenceInstant.getTime() - BOGOTA_OFFSET_MS);
  return new Date(Date.UTC(bogotaInstant.getUTCFullYear(), bogotaInstant.getUTCMonth(), bogotaInstant.getUTCDate()));
}

/** Días calendario (Bogotá) entre hoy y una fecha de vencimiento — negativo
 * si ya venció, 0 si vence hoy, positivo si falta. dueDate debe venir en la
 * misma convención (UTC midnight del día calendario). */
export function diasHastaVencimiento(dueDate: Date | string, referenceInstant: Date = new Date()): number {
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  const hoy = bogotaTodayUTCMidnight(referenceInstant);
  return Math.round((due.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}
