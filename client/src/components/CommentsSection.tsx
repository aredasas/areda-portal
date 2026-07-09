import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Loader2 } from "lucide-react";

/** Comments on a specific task or deadline — for asking/flagging things
 * about that item directly, instead of a general chat between users. */
export default function CommentsSection({ entityType, entityId }: { entityType: "task" | "deadline"; entityId: number }) {
  const [content, setContent] = useState("");
  const { data: commentsList, isLoading, refetch } = trpc.comments.list.useQuery({ entityType, entityId });
  const createComment = trpc.comments.create.useMutation();

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
      ) : commentsList && commentsList.length > 0 ? (
        <div className="space-y-2 max-h-[220px] overflow-y-auto mb-2">
          {commentsList.map((c: any) => (
            <div key={c.id} className="bg-muted/50 rounded-lg p-2 text-sm">
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
