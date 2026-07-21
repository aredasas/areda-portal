import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  LayoutGrid,
  Loader2,
  Send,
  MessageSquare,
  Paperclip,
  Pin,
  PinOff,
  Trash2,
  Download,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export default function Tablero() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [filtroObligacion, setFiltroObligacion] = useState<string>("todas");
  const [nuevoContenido, setNuevoContenido] = useState("");
  const [nuevaObligacion, setNuevaObligacion] = useState<string>("general");
  const [archivosNuevos, setArchivosNuevos] = useState<File[]>([]);
  const [publicando, setPublicando] = useState(false);
  const [postExpandido, setPostExpandido] = useState<number | null>(null);

  const { data: obligations } = trpc.obligations.list.useQuery();
  const { data: posts, isLoading, refetch } = trpc.board.posts.list.useQuery({
    obligationId: filtroObligacion === "todas" ? undefined : filtroObligacion === "general" ? 0 : parseInt(filtroObligacion),
  });

  const createPost = trpc.board.posts.create.useMutation();
  const uploadAttachment = trpc.board.posts.uploadAttachment.useMutation();
  const setPinned = trpc.board.posts.setPinned.useMutation();
  const deletePost = trpc.board.posts.delete.useMutation();

  const handlePublicar = async () => {
    if (!nuevoContenido.trim()) return;
    setPublicando(true);
    try {
      const obligationId = nuevaObligacion === "general" ? undefined : parseInt(nuevaObligacion);
      const { id } = await createPost.mutateAsync({ content: nuevoContenido.trim(), obligationId });
      for (const file of archivosNuevos) {
        const fileBase64 = await fileToBase64(file);
        await uploadAttachment.mutateAsync({
          postId: id, fileName: file.name, fileBase64, contentType: file.type || "application/octet-stream", fileSize: file.size,
        });
      }
      setNuevoContenido("");
      setNuevaObligacion("general");
      setArchivosNuevos([]);
      refetch();
      toast.success("Publicado en el Tablero");
    } catch (error: any) {
      toast.error(error.message || "Error al publicar");
    } finally {
      setPublicando(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <LayoutGrid className="w-6 h-6" /> Tablero
          </h1>
          <p className="text-muted-foreground text-sm">
            Avisos y aclaraciones para todo el equipo — documentos, dudas de proceso, y todo lo que no es de una tarea puntual
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <Textarea
              value={nuevoContenido}
              onChange={(e) => setNuevoContenido(e.target.value)}
              placeholder="Escribe un aviso, aclaración, o comparte un documento..."
              rows={3}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Select value={nuevaObligacion} onValueChange={setNuevaObligacion}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  {obligations?.map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="flex items-center gap-1 text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                <Paperclip className="w-4 h-4" />
                {archivosNuevos.length > 0 ? `${archivosNuevos.length} archivo(s)` : "Adjuntar documento"}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setArchivosNuevos(Array.from(e.target.files || []))}
                />
              </label>

              <div className="flex-1" />
              <Button onClick={handlePublicar} disabled={publicando || !nuevoContenido.trim()} className="gap-2">
                {publicando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Publicar
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtrar:</span>
          <Select value={filtroObligacion} onValueChange={setFiltroObligacion}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todo</SelectItem>
              <SelectItem value="general">Solo General</SelectItem>
              {obligations?.map((o: any) => (
                <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !posts?.length ? (
          <p className="text-sm text-muted-foreground text-center py-10">Todavía no hay publicaciones.</p>
        ) : (
          <div className="space-y-3">
            {posts.map((post: any) => (
              <PostCard
                key={post.id}
                post={post}
                isAdmin={isAdmin}
                expandido={postExpandido === post.id}
                onToggleExpand={() => setPostExpandido(postExpandido === post.id ? null : post.id)}
                onPin={() => setPinned.mutateAsync({ id: post.id, pinned: !post.pinned }).then(() => refetch())}
                onDelete={() => {
                  if (confirm("¿Eliminar esta publicación y sus comentarios?")) {
                    deletePost.mutateAsync({ id: post.id }).then(() => refetch());
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function PostCard({ post, isAdmin, expandido, onToggleExpand, onPin, onDelete }: {
  post: any; isAdmin: boolean; expandido: boolean; onToggleExpand: () => void; onPin: () => void; onDelete: () => void;
}) {
  const { data: attachments } = trpc.board.posts.getAttachments.useQuery({ postId: post.id }, { enabled: expandido });
  const { data: comentarios } = trpc.board.comments.list.useQuery({ postId: post.id }, { enabled: expandido });

  return (
    <Card className={post.pinned ? "border-[#42302E]/40 bg-[#42302E]/[0.03]" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {post.pinned && <Pin className="w-3.5 h-3.5 text-[#42302E]" />}
            <span className="font-medium text-sm">{post.authorName || "Usuario"}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(post.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
            </span>
            <Badge variant="outline" className="text-xs">
              {post.obligationName || "General"}
            </Badge>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPin} title={post.pinned ? "Desfijar" : "Fijar"}>
                {post.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={onDelete} title="Eliminar">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-sm whitespace-pre-wrap">{post.content}</p>

        <button onClick={onToggleExpand} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <MessageSquare className="w-3.5 h-3.5" />
          {expandido ? "Ocultar" : "Ver"} adjuntos y comentarios
          {expandido ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {expandido && (
          <div className="space-y-3 pt-2 border-t">
            {!!attachments?.length && (
              <div className="space-y-1">
                {attachments.map((a: any) => (
                  <AttachmentRow key={a.id} attachment={a} />
                ))}
              </div>
            )}
            <PostComments postId={post.id} comentarios={comentarios} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentRow({ attachment }: { attachment: any }) {
  const utils = trpc.useUtils();
  const handleDownload = async () => {
    const { signedUrl } = await utils.board.posts.getAttachmentUrl.fetch({ fileKey: attachment.fileKey });
    window.open(signedUrl, "_blank");
  };
  return (
    <button onClick={handleDownload} className="flex items-center gap-2 text-sm text-blue-700 hover:underline">
      <FileText className="w-3.5 h-3.5" /> {attachment.fileName}
      <Download className="w-3 h-3" />
    </button>
  );
}

function PostComments({ postId, comentarios }: { postId: number; comentarios: any }) {
  const [content, setContent] = useState("");
  const utils = trpc.useUtils();
  const createComment = trpc.board.comments.create.useMutation();

  const handleSend = async () => {
    if (!content.trim()) return;
    try {
      await createComment.mutateAsync({ postId, content: content.trim() });
      setContent("");
      utils.board.comments.list.invalidate({ postId });
    } catch (error: any) {
      toast.error(error.message || "Error al comentar");
    }
  };

  return (
    <div className="space-y-2">
      {comentarios?.map((c: any) => (
        <div key={c.id} className="bg-muted/50 rounded-lg p-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium text-xs">{c.authorName || "Usuario"}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(c.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{c.content}</p>
        </div>
      ))}
      <div className="flex items-end gap-2">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Responder..." rows={1} className="min-h-[38px]" />
        <Button size="icon" onClick={handleSend} disabled={!content.trim()}><Send className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}
