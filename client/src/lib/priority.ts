import { diasHastaVencimiento } from "./dateUtils";

export type Priority = "baja" | "media" | "alta" | "urgente";

const ORDEN: Record<Priority, number> = { baja: 0, media: 1, alta: 2, urgente: 3 };

export const priorityLabels: Record<Priority, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

export const priorityColors: Record<Priority, string> = {
  baja: "bg-gray-100 text-gray-700 border-gray-200",
  media: "bg-blue-50 text-blue-700 border-blue-200",
  alta: "bg-orange-100 text-orange-700 border-orange-200",
  urgente: "bg-red-100 text-red-700 border-red-200",
};

/** La prioridad que se le asignó a la tarea al crearla nunca baja sola —
 * pero si faltan pocos días para el vencimiento, sube automáticamente sin
 * importar cuál se le haya puesto: a 5 días o menos pasa a "alta", a 3 días
 * o menos pasa a "urgente". Una vez completada/cancelada, se muestra la
 * prioridad tal cual se asignó (ya no aplica la escalada). Nunca DEGRADA la
 * prioridad asignada — solo la sube si el umbral por días la superaría. */
export function getEffectivePriority(
  priority: Priority | null | undefined,
  dueDate: Date | string | null | undefined,
  status?: string,
): Priority {
  const base: Priority = priority || "media";
  if (!dueDate) return base;
  if (status === "completada" || status === "cancelada") return base;

  const dias = diasHastaVencimiento(dueDate);
  let porUmbral: Priority = base;
  if (dias <= 3) porUmbral = "urgente";
  else if (dias <= 5) porUmbral = "alta";

  return ORDEN[porUmbral] > ORDEN[base] ? porUmbral : base;
}
