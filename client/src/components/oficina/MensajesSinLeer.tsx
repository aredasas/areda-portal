import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Loader2, MailQuestion, ChevronDown, ChevronRight, ArrowUpRight, CheckCircle2 } from "lucide-react";

/** Seguimiento de la Oficina: lo que le he escrito al equipo y sigue sin
 * leerse — comentarios, devoluciones para corregir o completar y
 * publicaciones del tablero — agrupado por persona, del más atrasado al más
 * reciente, con el enlace para ir a insistir. */

const hace = (dias: number) => (dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`);
/** Entre más días sin leer, más llama la atención. */
const tonoDias = (dias: number) => (dias >= 5 ? "text-red-700" : dias >= 2 ? "text-amber-700" : "text-muted-foreground");

export default function MensajesSinLeer() {
  const [, setLocation] = useLocation();
  const consulta = trpc.oficina.estadista.mensajesSinLeer.useQuery(undefined, { refetchInterval: 60_000 });
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const datos = consulta.data;
  const alternar = (id: number) => setAbiertos(previo => { const s = new Set(previo); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <MailQuestion className="w-4 h-4" /> Tus mensajes sin leer
          {!!datos && datos.total > 0 && <Badge className="bg-amber-100 text-amber-900 border-amber-200">{datos.total}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">Comentarios, devoluciones y publicaciones que el equipo no ha abierto</p>
      </CardHeader>
      <CardContent>
        {consulta.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !datos ? (
          <p className="text-sm text-muted-foreground">{consulta.error?.message || "No se pudo cargar el seguimiento."}</p>
        ) : datos.total === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> Todo lo que le has escrito al equipo está leído.</p>
        ) : (
          <div className="space-y-2">
            {datos.porPersona.map((p) => {
              const abierto = abiertos.has(p.usuarioId);
              const mensajes = datos.mensajes.filter(m => m.destinatarioId === p.usuarioId);
              return (
                <div key={p.usuarioId} className="rounded-md border">
                  <button
                    type="button" onClick={() => alternar(p.usuarioId)} aria-expanded={abierto}
                    className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/50 rounded-md"
                  >
                    {abierto ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                    <span className="font-medium flex-1 min-w-0 truncate">{p.nombre}</span>
                    <span className="tabular-nums">
                      {p.sinLeer > 0 && <><strong>{p.sinLeer}</strong> sin leer</>}
                      {p.sinLeer > 0 && p.marcadosSinAbrir > 0 && <span className="text-muted-foreground"> · </span>}
                      {p.marcadosSinAbrir > 0 && <span className={p.sinLeer > 0 ? "text-muted-foreground" : ""}><strong>{p.marcadosSinAbrir}</strong> {p.marcadosSinAbrir === 1 ? "marcado" : "marcados"} sin abrir</span>}
                    </span>
                    <span className={`text-xs tabular-nums ${tonoDias(p.masAntiguoDias)}`}>el más antiguo, {hace(p.masAntiguoDias)}</span>
                  </button>
                  {abierto && (
                    <ul className="border-t divide-y">
                      {mensajes.map((m) => (
                        <li key={m.clave} className="flex items-start gap-3 px-3 py-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium break-words">{m.descripcion}</p>
                            {m.extracto && <p className="text-xs text-muted-foreground mt-0.5 break-words">“{m.extracto}”</p>}
                            <p className="text-[11px] mt-0.5">
                              <span className={tonoDias(m.dias)}>Enviado {hace(m.dias)}</span>
                              <span className="text-muted-foreground"> · {m.estado === "sin_leer" ? "sin leer" : "lo marcó como leído sin abrirlo"}</span>
                            </p>
                          </div>
                          {m.enlace && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={() => setLocation(m.enlace!)} title="Abrir donde está el mensaje, para insistir" aria-label="Abrir donde está el mensaje">
                              <ArrowUpRight className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Abrir</span>
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {datos.marcadosSinAbrir > 0 && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                «Marcado sin abrir»: la persona usó «marcar todas como leídas» en la campanita y después no ha abierto la tarea.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
