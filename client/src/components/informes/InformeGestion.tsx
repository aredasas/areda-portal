import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Loader2, FileText, Plus, Trash2, ArrowUp, ArrowDown, Save, AlertTriangle, CheckCircle2, Info, ListChecks, Scale } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

/** Pestaña "Informe de Gestión" de Informes: el PDF de lectura financiera
 * que sale del estado de resultados por mes (y por centro de costo, y del
 * balance de prueba, cuando el cliente los tiene). Las cifras y los textos
 * de lectura los arma el portal; aquí se elige el mes de corte y se
 * escriben los puntos tributarios y el plan de acción de ese corte. */

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

type Salidas = inferRouterOutputs<AppRouter>["informes"]["gestionFinanciera"];
type Vista = NonNullable<Salidas["resumen"]["vista"]>;
type Notas = Salidas["notas"];
type Nivel = Notas["puntos"][number]["nivel"];
type Punto = { nivel: Nivel; titulo: string; texto: string };
type Accion = { titulo: string; texto: string };

const NIVELES: Record<Nivel, { texto: string; clase: string; punto: string }> = {
  critico: { texto: "Crítico", clase: "bg-red-100 text-red-800", punto: "bg-red-500" },
  revisar: { texto: "Revisar", clase: "bg-amber-100 text-amber-900", punto: "bg-amber-500" },
  vigilar: { texto: "Vigilar", clase: "bg-blue-100 text-blue-900", punto: "bg-blue-500" },
};

function Pastilla({ nivel }: { nivel: Nivel }) {
  const n = NIVELES[nivel];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${n.clase}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${n.punto}`} />{n.texto}
    </span>
  );
}

export default function InformeGestion({ clienteId, anio }: { clienteId: number; anio: number }) {
  // null = el último mes con estado de resultados cargado.
  const [mesElegido, setMesElegido] = useState<number | null>(null);
  const resumenQuery = trpc.informes.gestionFinanciera.resumen.useQuery({ clienteId, anio, mes: mesElegido }, { placeholderData: (previo) => previo });

  if (resumenQuery.isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (resumenQuery.error || !resumenQuery.data) return <p className="text-sm text-red-700">{resumenQuery.error?.message || "No se pudo cargar el informe de gestión."}</p>;
  const { meses, corte, vista } = resumenQuery.data;

  if (corte === null || !vista) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Informe de gestión</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Este cliente todavía no tiene estado de resultados en {anio}. Carga el libro auxiliar en la pestaña
            «Estado de Resultados» y el informe se arma con esos meses.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <VistaCard anio={anio} meses={meses} corte={corte} vista={vista} cargando={resumenQuery.isFetching} onCorte={setMesElegido} />
      {/* La llave reinicia el editor al cambiar de corte; no al refrescar datos, para no borrar lo que se está escribiendo. */}
      <NotasYGenerar key={corte} clienteId={clienteId} anio={anio} corte={corte} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Lo que el informe va a decir
// ---------------------------------------------------------------------

function VistaCard({ anio, meses, corte, vista, cargando, onCorte }: {
  anio: number; meses: number[]; corte: number; vista: Vista; cargando: boolean; onCorte: (mes: number) => void;
}) {
  const criticas = vista.alertas.filter(a => a.nivel === "critico").length;
  const contenido = [
    "Estado de resultados por mes",
    "Punto de equilibrio",
    vista.puntosDeVenta > 0 ? `${vista.puntosDeVenta} ${vista.puntosDeVenta === 1 ? "punto de venta" : "puntos de venta"}` : null,
    vista.aperturas > 0 ? `${vista.aperturas} ${vista.aperturas === 1 ? "apertura" : "aperturas"}` : null,
    vista.balance ? `Balance a ${vista.balance.toLowerCase()}` : null,
  ].filter((x): x is string => !!x);

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1 min-w-0 flex-1 basis-80">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Informe de gestión</CardTitle>
          <p className="text-sm text-muted-foreground">
            Lectura financiera en PDF para entregar al cliente. Sale del estado de resultados por mes; los textos
            los escribe el portal a partir de las cifras.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">Corte</span>
          <Select value={String(corte)} onValueChange={(v) => onCorte(Number(v))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {meses.map((m) => <SelectItem key={m} value={String(m)}>{MESES[m]} {anio}</SelectItem>)}
            </SelectContent>
          </Select>
          {cargando && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{vista.periodo.charAt(0).toUpperCase() + vista.periodo.slice(1)}</span>
          {contenido.map((c) => <span key={c} className="rounded-full border px-2 py-0.5 text-muted-foreground">{c}</span>)}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {vista.indicadores.map((ind) => (
            <div key={ind.titulo} className={`rounded-md border border-l-4 p-3 ${ind.tono === "bueno" ? "border-l-green-600" : ind.tono === "malo" ? "border-l-red-500" : "border-l-amber-500"}`}>
              <p className="text-xs text-muted-foreground">{ind.titulo}</p>
              <p className="text-base sm:text-lg font-semibold tabular-nums leading-tight mt-0.5 whitespace-nowrap">{ind.valor}</p>
              <p className={`text-xs mt-1 ${ind.tono === "bueno" ? "text-green-700" : ind.tono === "malo" ? "text-red-700" : "text-muted-foreground"}`}>{ind.detalle}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Resumen ejecutivo</p>
          <ul className="space-y-1.5 text-sm">
            {vista.resumen.map((r) => (
              <li key={r.titulo} className="flex gap-2">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span><strong>{r.titulo}:</strong> <span className="text-muted-foreground">{r.texto}</span></span>
              </li>
            ))}
          </ul>
        </div>

        {vista.alertas.length > 0 ? (
          <div>
            <p className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Variaciones atípicas ({vista.alertas.length}{criticas ? `, ${criticas} ${criticas === 1 ? "crítica" : "críticas"}` : ""})
            </p>
            <div className="rounded-md border divide-y text-sm">
              {vista.alertas.map((a, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr] sm:grid-cols-[5.5rem_6.5rem_12rem_1fr] gap-x-3 gap-y-1 p-2.5 items-start">
                  <Pastilla nivel={a.nivel} />
                  <span className="text-muted-foreground text-xs sm:text-sm">{a.periodo}</span>
                  <span className="font-medium col-span-2 sm:col-span-1">{a.partida}</span>
                  <span className="text-muted-foreground col-span-2 sm:col-span-1">{a.detalle}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Las detecta el portal con reglas sobre las cifras. Conviene revisarlas antes de entregar el informe: cada una pide una explicación, no implica un error.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" /> Sin variaciones atípicas en el periodo.</p>
        )}

        {!vista.balance && (
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            No hay balance de prueba cargado hasta {MESES[corte].toLowerCase()}: el informe sale sin la sección de balance. Se carga en la pestaña «Balance».
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Notas del contador y generación del PDF
// ---------------------------------------------------------------------

function NotasYGenerar({ clienteId, anio, corte }: { clienteId: number; anio: number; corte: number }) {
  const notasQuery = trpc.informes.gestionFinanciera.notas.useQuery({ clienteId, anio, mes: corte }, { refetchOnWindowFocus: false });
  if (notasQuery.isLoading) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (notasQuery.error || !notasQuery.data) return <p className="text-sm text-red-700">{notasQuery.error?.message || "No se pudieron cargar las notas."}</p>;
  return <Editor clienteId={clienteId} anio={anio} corte={corte} iniciales={notasQuery.data} />;
}

const limpias = (puntos: Punto[], plan: Accion[]) => ({
  puntos: puntos.map(p => ({ nivel: p.nivel, titulo: p.titulo.trim(), texto: p.texto.trim() })).filter(p => p.titulo || p.texto),
  plan: plan.map(a => ({ titulo: a.titulo.trim(), texto: a.texto.trim() })).filter(a => a.titulo || a.texto),
});

function Editor({ clienteId, anio, corte, iniciales }: { clienteId: number; anio: number; corte: number; iniciales: Notas }) {
  const utils = trpc.useUtils();
  const [puntos, setPuntos] = useState<Punto[]>(iniciales.puntos);
  const [plan, setPlan] = useState<Accion[]>(iniciales.plan);
  // Lo último que quedó guardado para este corte (null: nada todavía).
  const [guardado, setGuardado] = useState<string | null>(iniciales.guardadas ? JSON.stringify(limpias(iniciales.puntos, iniciales.plan)) : null);
  const [borrador, setBorrador] = useState(iniciales.copiadasDe);

  const actuales = limpias(puntos, plan);
  const hayNotas = actuales.puntos.length + actuales.plan.length > 0;
  const sinGuardar = guardado === null ? hayNotas : JSON.stringify(actuales) !== guardado;

  const guardarMutation = trpc.informes.gestionFinanciera.guardarNotas.useMutation();
  const generarMutation = trpc.informes.gestionFinanciera.generarPdf.useMutation();
  const ocupado = guardarMutation.isPending || generarMutation.isPending;

  const guardar = async () => {
    await guardarMutation.mutateAsync({ clienteId, anio, mes: corte, ...actuales });
    setGuardado(JSON.stringify(actuales));
    setBorrador(null);
    utils.informes.gestionFinanciera.notas.invalidate({ clienteId, anio });
  };
  const soloGuardar = async () => {
    try { await guardar(); toast.success(`Notas de ${MESES[corte].toLowerCase()} guardadas`); }
    catch (err: any) { toast.error(err?.message || "No se pudieron guardar las notas"); }
  };
  // El PDF lleva lo que se ve aquí: primero se guarda, después se genera.
  const generar = async () => {
    try {
      if (sinGuardar) await guardar();
      const r = await generarMutation.mutateAsync({ clienteId, anio, mes: corte });
      toast.success("Informe de gestión generado");
      window.open(r.signedUrl, "_blank");
      utils.informes.reportes.list.invalidate();
    } catch (err: any) { toast.error(err?.message || "No se pudo generar el informe"); }
  };

  const cambiarPunto = (i: number, cambio: Partial<Punto>) => setPuntos(lista => lista.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  const cambiarAccion = (i: number, cambio: Partial<Accion>) => setPlan(lista => lista.map((a, j) => (j === i ? { ...a, ...cambio } : a)));
  const mover = (i: number, d: -1 | 1) => setPlan(lista => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return lista;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });

  return (
    <>
      {borrador && hayNotas && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Estas notas vienen del informe de <strong>{MESES[borrador.mes].toLowerCase()} {borrador.anio}</strong> como punto de partida.
            Ajústalas a {MESES[corte].toLowerCase()}: quedan guardadas para este corte al generar el informe o con «Guardar notas».
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="space-y-1 min-w-0 flex-1 basis-80">
            <CardTitle className="text-base flex items-center gap-2"><Scale className="w-4 h-4" /> Puntos de balance y tributarios</CardTitle>
            <p className="text-sm text-muted-foreground">Tus observaciones de {MESES[corte].toLowerCase()}. Salen en el informe tal como las escribas, en este orden.</p>
          </div>
          <Button size="sm" variant="outline" className="gap-2 shrink-0" disabled={puntos.length >= 30} onClick={() => setPuntos(l => [...l, { nivel: "revisar", titulo: "", texto: "" }])}>
            <Plus className="w-3.5 h-3.5" /> Agregar punto
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {puntos.length === 0 && <p className="text-sm text-muted-foreground">Sin puntos todavía. Si no agregas ninguno, el informe sale sin esta sección.</p>}
          {puntos.map((p, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={p.nivel} onValueChange={(v) => cambiarPunto(i, { nivel: v as Nivel })}>
                  <SelectTrigger className="w-36" aria-label="Nivel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(NIVELES) as Nivel[]).map((n) => <SelectItem key={n} value={n}><Pastilla nivel={n} /></SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="flex-1 min-w-48" maxLength={160} placeholder="Título: de qué se trata" value={p.titulo} onChange={(e) => cambiarPunto(i, { titulo: e.target.value })} />
                <Button size="icon" variant="ghost" title="Quitar este punto" aria-label="Quitar este punto" onClick={() => setPuntos(l => l.filter((_, j) => j !== i))}>
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
              <Textarea rows={3} maxLength={2000} placeholder="Qué se encontró y qué hay que hacer" value={p.texto} onChange={(e) => cambiarPunto(i, { texto: e.target.value })} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="space-y-1 min-w-0 flex-1 basis-80">
            <CardTitle className="text-base flex items-center gap-2"><ListChecks className="w-4 h-4" /> Plan de acción</CardTitle>
            <p className="text-sm text-muted-foreground">Las acciones salen numeradas, en el orden en que conviene atenderlas.</p>
          </div>
          <Button size="sm" variant="outline" className="gap-2 shrink-0" disabled={plan.length >= 30} onClick={() => setPlan(l => [...l, { titulo: "", texto: "" }])}>
            <Plus className="w-3.5 h-3.5" /> Agregar acción
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {plan.length === 0 && <p className="text-sm text-muted-foreground">Sin acciones todavía. Si no agregas ninguna, el informe sale sin esta sección.</p>}
          {plan.map((a, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <Input className="flex-1 min-w-48" maxLength={160} placeholder="Acción" value={a.titulo} onChange={(e) => cambiarAccion(i, { titulo: e.target.value })} />
                <div className="flex items-center">
                  <Button size="icon" variant="ghost" title="Subir" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp className="w-4 h-4 text-muted-foreground" /></Button>
                  <Button size="icon" variant="ghost" title="Bajar" aria-label="Bajar" disabled={i === plan.length - 1} onClick={() => mover(i, 1)}><ArrowDown className="w-4 h-4 text-muted-foreground" /></Button>
                  <Button size="icon" variant="ghost" title="Quitar esta acción" aria-label="Quitar esta acción" onClick={() => setPlan(l => l.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
              <Textarea rows={2} maxLength={2000} placeholder="Cómo, quién y para cuándo" value={a.texto} onChange={(e) => cambiarAccion(i, { texto: e.target.value })} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-muted-foreground mr-auto">
          {sinGuardar ? "Hay notas sin guardar; se guardan al generar el informe." : hayNotas ? `Notas de ${MESES[corte].toLowerCase()} guardadas.` : "El informe sale sin notas del contador."}
        </span>
        <Button variant="outline" className="gap-2" disabled={!sinGuardar || ocupado} onClick={soloGuardar}>
          {guardarMutation.isPending && !generarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar notas
        </Button>
        <Button className="gap-2" disabled={ocupado} onClick={generar}>
          {generarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Generar informe de {MESES[corte].toLowerCase()} (PDF)
        </Button>
      </div>
    </>
  );
}
