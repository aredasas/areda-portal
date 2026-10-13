import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { comentarioNotificado } from "@/lib/destinoNotificacion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Loader2 } from "lucide-react";

/** Comments on a specific task or deadline — for asking/flagging things
 * about that item directly, instead of a general chat between users. */
export default function CommentsSection({ entityType, entityId, destacar }: {
  entityType: "task" | "deadline" | "renta_cliente"; entityId: number;
  /** Lo que se notificó (desde la campanita): el comentario se busca, se
   * lleva a la vista y se resalta un momento. */
  destacar?: { mensaje?: string | null; cuando?: string | Date | null } | null;
}) {
  const [content, setContent] = useState("");
  const { data: commentsList, isLoading, isError, error, refetch } = trpc.comments.list.useQuery({ entityType, entityId });
  const createComment = trpc.comments.create.useMutation();

  // Llevar a la vista el comentario notificado (una sola vez por aviso).
  const refs = useRef(new Map<number, HTMLDivElement>());
  const contenedor = useRef<HTMLDivElement>(null);
  const [resaltado, setResaltado] = useState<number | null>(null);
  const yaUbicado = useRef<string | null>(null);
  useEffect(() => {
    if (!destacar || !commentsList) return;
    const clave = `${entityId}|${destacar.mensaje}|${destacar.cuando}`;
    if (yaUbicado.current === clave) return;
    yaUbicado.current = clave;
    const objetivo = comentarioNotificado(commentsList as any[], destacar.mensaje, destacar.cuando);
    // Si no se encuentra (ej. una aprobación sin observación), al menos se
    // muestran los comentarios, empezando por el más reciente.
    const t = window.setTimeout(() => {
      const el = objetivo ? refs.current.get(objetivo.id) : null;
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setResaltado(objetivo!.id); }
      else {
        if (contenedor.current) contenedor.current.scrollTop = contenedor.current.scrollHeight;
        contenedor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 250);
    const quitar = window.setTimeout(() => setResaltado(null), 4500);
    return () => { window.clearTimeout(t); window.clearTimeout(quitar); };
  }, [destacar, commentsList, entityId]);

  // Abrir los comentarios de una tarea o un vencimiento es leerlos: sus
  // avisos se marcan como leídos aunque no se haya entrado por la campanita
  // (y quien los envió se entera de que ya se vieron).
  const utils = trpc.useUtils();
  const marcarLeidas = trpc.notifications.markEntityRead.useMutation();
  useEffect(() => {
    if (entityType !== "task" && entityType !== "deadline") return;
    marcarLeidas.mutateAsync({ entityType, entityId })
      .then((r) => { if (r.leidas > 0) { utils.notifications.unreadCount.invalidate(); utils.notifications.list.invalidate(); } })
      .catch(() => { /* no impide ver los comentarios */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  const handleSend = async () => {
    if (!content.trim()) return;
    try {
      await createComment.mutateAsync({ entityType, entityId, content: content.trim() });
      setContent("");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al enviar el comentario");
    }
  };

  return (
    <div>
      <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
        <MessageSquare className="h-4 w-4" /> Comentarios
      </h4>
      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <p className="text-xs text-red-700 mb-2">{error?.message || "No se pudieron cargar los comentarios."}</p>
      ) : commentsList && commentsList.length > 0 ? (
        <div ref={contenedor} className="space-y-2 max-h-[220px] overflow-y-auto mb-2">
          {commentsList.map((c: any) => (
            <div
              key={c.id}
              ref={(el) => { if (el) refs.current.set(c.id, el); else refs.current.delete(c.id); }}
              className={`rounded-lg p-2 text-sm transition-colors duration-700 ${resaltado === c.id ? "bg-[#FFF1C7] ring-2 ring-[#EDA011]" : "bg-muted/50"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-xs">{c.authorName || "Usuario"}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{c.content}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-2">Sin comentarios todavía</p>
      )}
      <div className="flex gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escriba un comentario..."
          rows={2}
          className="resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button
          size="icon"
          className="shrink-0 self-end bg-[#EDA011] hover:bg-[#d48f0f] text-white"
          disabled={!content.trim() || createComment.isPending}
          onClick={handleSend}
        >
          {createComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
