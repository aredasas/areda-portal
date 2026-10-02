import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { callar, hablar, puedeHablar, useHablando } from "@/lib/vozOficina";
import { formatearHoras } from "@shared/jornada";
import { Loader2, RefreshCw, Volume2, Square, Trophy, Upload, MessageSquare, Eye, CheckCheck, FileBarChart } from "lucide-react";
import { toast } from "sonner";

/** Informe del equipo del Estadista de Tareas: pendientes por persona,
 * horas trabajadas, ranking de eficiencia y lo que ha pasado hoy. Las
 * mismas cifras que se leen en voz alta con «Escuchar informe». */

const hora = (valor: string | Date) =>
  new Date(valor).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });

/** Botón que lee el informe en voz alta (y lo detiene si ya está sonando).
 * Se usa en la pestaña Informe y en el encabezado de la Oficina. */
export function BotonEscucharInforme({ compacto = false }: { compacto?: boolean }) {
  const utils = trpc.useUtils();
  const hablando = useHablando() === "informe";
  const [cargando, setCargando] = useState(false);

  const alternar = async () => {
    if (hablando) { callar(); return; }
    if (!puedeHablar()) { toast.error("Este navegador no tiene voz — abre el portal en Chrome o Edge."); return; }
    setCargando(true);
    try {
      // Siempre con datos frescos: el informe se pide para saber cómo va el día ahora.
      const informe = await utils.oficina.estadista.informe.fetch(undefined, { staleTime: 0 });
      hablar(informe.frases, { quien: "informe", interrumpir: true });
    } catch (error: any) {
      toast.error(error?.message || "No se pudo preparar el informe");
    } finally {
      setCargando(false);
    }
  };

  return (
    <Button
      variant={hablando ? "default" : "outline"} size="sm" onClick={alternar} disabled={cargando}
      className={hablando ? "bg-[#42302E] hover:bg-[#352624] text-white" : ""}
      title={hablando ? "Detener la lectura" : "Escuchar el informe del equipo: novedades de hoy, pendientes, horas y ranking"}
    >
      {cargando ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : hablando ? <Square className="w-3.5 h-3.5 mr-1.5 fill-current" /> : compacto ? <FileBarChart className="w-4 h-4 mr-1.5" /> : <Volume2 className="w-4 h-4 mr-1.5" />}
      {hablando ? "Detener" : compacto ? "Informe" : "Escuchar informe"}
    </Button>
  );
}

function Indicador({ etiqueta, valor, nota }: { etiqueta: string; valor: number; nota?: string }) {
  return (
    <div className="rounded-md border px-3 py-2.5 min-w-0">
      <p className="text-xs text-muted-foreground truncate">{etiqueta}</p>
      <p className="text-2xl font-semibold tabular-nums leading-tight">{valor.toLocaleString("es-CO")}</p>
      {nota && <p className="text-[11px] text-muted-foreground truncate">{nota}</p>}
    </div>
  );
}

/** Número de la tabla: los ceros en gris para que resalte lo que sí hay. */
function Cifra({ valor }: { valor: number }) {
  return <span className={valor === 0 ? "text-muted-foreground/60" : "font-medium"}>{valor}</span>;
}

const iconoActividad: Record<string, any> = { entrega: Upload, comentario: MessageSquare, lectura: Eye, lecturas_marcadas: CheckCheck };

export default function InformeEquipo() {
  const consulta = trpc.oficina.estadista.informe.useQuery(undefined, { refetchInterval: 60_000 });
  const informe = consulta.data;

  if (consulta.isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (!informe) return <p className="text-sm text-muted-foreground">{consulta.error?.message || "No se pudo cargar el informe."}</p>;

  const puntuados = informe.colaboradores.filter((f: any) => f.posicion != null);
  const sinPuntaje = informe.colaboradores.filter((f: any) => f.posicion == null && f.eficiencia.entregas > 0);
  const etiquetaDiaAnterior = informe.diaAnterior.etiqueta === "ayer" ? "Ayer" : informe.diaAnterior.etiqueta.replace(/^el /, "").replace(/^\w/, (c: string) => c.toUpperCase());
  const sr = informe.sinResponsable;
  const haySinResponsable = sr.porTerminar + sr.devueltas + sr.porCompletar > 0;
  const actividad = [...informe.actividadHoy].reverse();

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1 min-w-0">Actualizado a las {hora(informe.generadoEn)}</p>
        <Button variant="ghost" size="sm" onClick={() => consulta.refetch()} disabled={consulta.isFetching} title="Actualizar las cifras">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${consulta.isFetching ? "animate-spin" : ""}`} /> Actualizar
        </Button>
        <BotonEscucharInforme />
      </div>

      {/* ---- Totales ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Indicador etiqueta="Por terminar" valor={informe.totales.porTerminar} nota="Tareas sin entregar" />
        <Indicador etiqueta="Vencidas" valor={informe.totales.vencidas} nota="Ya pasaron su fecha" />
        <Indicador etiqueta="Devueltas" valor={informe.totales.devueltas} nota="Para corrección" />
        <Indicador etiqueta="Por completar" valor={informe.totales.porCompletar} nota="Falta una acción" />
      </div>

      {/* ---- Ranking ---- */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Trophy className="w-4 h-4 text-[#EDA011]" /> Ranking de eficiencia <span className="font-normal text-muted-foreground">· últimos 30 días</span></h3>
        {puntuados.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground text-center">
            Todavía no hay suficientes entregas para armar el ranking (se necesitan al menos 3 por persona).
          </p>
        ) : (
          <ol className="rounded-md border divide-y">
            {puntuados.map((f: any) => (
              <li key={f.userId} className="flex items-center gap-3 px-3 py-2">
                <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-muted-foreground">{f.posicion}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium truncate">{f.nombre}</p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{f.eficiencia.puntaje}<span className="font-normal text-muted-foreground"> / 100</span></p>
                  </div>
                  {/* Medidor: relleno ámbar sobre un tono más claro del mismo color. */}
                  <div className="mt-1 h-1.5 rounded-full bg-[#F6DAAB]/70 overflow-hidden" role="img" aria-label={`${f.eficiencia.puntaje} de 100 puntos`}>
                    <div className="h-full rounded-full bg-[#EDA011]" style={{ width: `${f.eficiencia.puntaje}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {f.eficiencia.entregasConFecha > 0 ? `${f.eficiencia.aTiempo} de ${f.eficiencia.entregasConFecha} a tiempo` : "Sin entregas con fecha límite"}
                    {" · "}{f.eficiencia.entregas} {f.eficiencia.entregas === 1 ? "entrega" : "entregas"}, {f.eficiencia.devoluciones} {f.eficiencia.devoluciones === 1 ? "devolución" : "devoluciones"}
                    {" · "}{f.vencidas === 0 ? "sin vencidas" : `${f.vencidas} ${f.vencidas === 1 ? "vencida" : "vencidas"}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {sinPuntaje.length > 0 && (
          <p className="text-[11px] text-muted-foreground">Con muy pocas entregas para puntuar: {sinPuntaje.map((f: any) => f.nombre).join(", ")}.</p>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Puntaje = 50 % entregas a tiempo + 30 % entregas que no fueron devueltas + 20 % no tener tareas vencidas.
        </p>
      </section>

      {/* ---- Por persona ---- */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Pendientes y horas por persona</h3>
        {informe.colaboradores.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nadie tiene tareas asignadas ni jornadas registradas.</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                  <th />
                  <th className="px-2 pt-2 text-right font-medium" colSpan={4}>Tareas</th>
                  <th className="pl-4 pr-3 pt-2 text-right font-medium border-l" colSpan={3}>Horas trabajadas</th>
                </tr>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Colaborador</th>
                  <th className="px-2 py-2 text-right font-medium">Por terminar</th>
                  <th className="px-2 py-2 text-right font-medium">Vencidas</th>
                  <th className="px-2 py-2 text-right font-medium">Devueltas</th>
                  <th className="px-2 py-2 text-right font-medium">Por completar</th>
                  <th className="pl-4 pr-2 py-2 text-right font-medium border-l">{etiquetaDiaAnterior}</th>
                  <th className="px-2 py-2 text-right font-medium">Semana</th>
                  <th className="pl-2 pr-3 py-2 text-right font-medium">Mes</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {informe.colaboradores.map((f: any) => (
                  <tr key={f.userId}>
                    <td className="px-3 py-2 max-w-[200px]"><span className="block truncate" title={f.nombre}>{f.nombre}</span></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={f.porTerminar} /></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={f.vencidas} /></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={f.devueltas} /></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={f.porCompletar} /></td>
                    <td className="pl-4 pr-2 py-2 text-right border-l whitespace-nowrap">{f.horas.diaAnteriorMs > 0 ? formatearHoras(f.horas.diaAnteriorMs) : <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{f.horas.semanaMs > 0 ? formatearHoras(f.horas.semanaMs) : <span className="text-muted-foreground/60">—</span>}</td>
                    <td className="pl-2 pr-3 py-2 text-right whitespace-nowrap">
                      {f.horas.mesMs > 0 ? formatearHoras(f.horas.mesMs) : <span className="text-muted-foreground/60">—</span>}
                      {f.horas.diasIncompletos > 0 && (
                        <span className="ml-1 cursor-help text-amber-700" title={`${f.horas.diasIncompletos} ${f.horas.diasIncompletos === 1 ? "día" : "días"} de este mes con marcación incompleta (faltó marcar una salida): esas horas no se pueden contar.`}>*</span>
                      )}
                    </td>
                  </tr>
                ))}
                {haySinResponsable && (
                  <tr className="text-muted-foreground">
                    <td className="px-3 py-2">Sin responsable</td>
                    <td className="px-2 py-2 text-right"><Cifra valor={sr.porTerminar} /></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={sr.vencidas} /></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={sr.devueltas} /></td>
                    <td className="px-2 py-2 text-right"><Cifra valor={sr.porCompletar} /></td>
                    <td className="border-l" colSpan={3} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Horas según las marcas de jornada, con la misma regla de Asistencia; semana = de lunes a hoy, mes = del día 1 a hoy.
          {informe.colaboradores.some((f: any) => f.horas.diasIncompletos > 0) && " El asterisco indica días con marcación incompleta."}
        </p>
      </section>

      {/* ---- Hoy ---- */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Lo que ha pasado hoy <span className="font-normal text-muted-foreground">· {actividad.length} {actividad.length === 1 ? "movimiento" : "movimientos"}</span></h3>
        {actividad.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground text-center">Hoy todavía no hay entregas, comentarios ni lecturas del equipo.</p>
        ) : (
          <ul className="rounded-md border divide-y max-h-64 overflow-y-auto">
            {actividad.map((e: any) => {
              const Icono = iconoActividad[e.tipo] || Eye;
              return (
                <li key={e.clave} className="flex items-start gap-2.5 px-3 py-2 text-sm">
                  <Icono className="w-3.5 h-3.5 mt-1 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 break-words">{e.texto}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{hora(e.cuando)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
