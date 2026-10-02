/** Cálculo de las horas trabajadas en un día a partir de las marcas de
 * jornada (inicio / salida a almuerzo / regreso de almuerzo / fin).
 *
 * Es la ÚNICA regla para ese cálculo: la usan la pantalla de Asistencia y
 * el informe del Estadista de Tareas en la Oficina, así que las horas de
 * un colaborador siempre coinciden entre los dos sitios.
 *
 * Regla (solo cuentan los bloques CERRADOS — con su marca de entrada y de
 * salida):
 *   - mañana: de "inicio" a "salida_almuerzo"
 *   - tarde:  de "regreso_almuerzo" a "fin"
 *   - jornada continua: si no hay NINGUNA marca de almuerzo, de "inicio" a "fin"
 * Si una marca se repite en el día, vale la última. */

export type TipoMarca = "inicio" | "salida_almuerzo" | "regreso_almuerzo" | "fin";

export type ResultadoJornada = {
  /** Milisegundos trabajados en bloques cerrados. */
  ms: number;
  /** false si quedó algún bloque abierto (ej. marcó inicio pero no salida,
   * o regreso pero no fin) — esas horas no se pueden contar. */
  completa: boolean;
};

export function calcularJornada(marcas: { type: string; timestamp: Date | string | number }[]): ResultadoJornada {
  const porTipo: Partial<Record<TipoMarca, number>> = {};
  for (const m of marcas) {
    const t = new Date(m.timestamp).getTime();
    if (Number.isFinite(t)) porTipo[m.type as TipoMarca] = t;
  }
  const { inicio, salida_almuerzo: salida, regreso_almuerzo: regreso, fin } = porTipo;
  const tramo = (desde?: number, hasta?: number) => (desde != null && hasta != null && hasta > desde ? hasta - desde : 0);

  if (salida == null && regreso == null) {
    // Jornada continua (nunca marcó almuerzo).
    return { ms: tramo(inicio, fin), completa: inicio == null || fin != null };
  }
  const manana = tramo(inicio, salida);
  const tarde = tramo(regreso, fin);
  const mananaAbierta = inicio != null && salida == null;
  const tardeAbierta = regreso != null && fin == null;
  // Marcó salida a almuerzo y fin, pero no el regreso: la tarde no se puede medir.
  const tardeSinRegreso = salida != null && fin != null && regreso == null;
  return { ms: manana + tarde, completa: !mananaAbierta && !tardeAbierta && !tardeSinRegreso };
}

/** "7h 30m" — formato corto para pantalla. */
export function formatearHoras(ms: number): string {
  const totalMinutos = Math.round(ms / 60000);
  return `${Math.floor(totalMinutos / 60)}h ${totalMinutos % 60}m`;
}
