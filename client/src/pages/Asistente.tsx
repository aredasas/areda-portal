import { useMemo, useRef, useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Sparkles, Send, Loader2, Bot, User, FileText } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function Asistente() {
  const { data: clients } = trpc.clients.list.useQuery();
  const [clientId, setClientId] = useState<string>("");
  const [messagesByClient, setMessagesByClient] = useState<Record<string, ChatMessage[]>>({});
  const [input, setInput] = useState("");
  const chat = trpc.assistant.chat.useMutation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = messagesByClient[clientId] || [];
  const selectedClient = clients?.find((c: any) => String(c.id) === clientId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending]);

  const handleSend = async () => {
    if (!input.trim() || !clientId) return;
    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const history = messages;
    setMessagesByClient(prev => ({ ...prev, [clientId]: [...(prev[clientId] || []), userMessage] }));
    setInput("");
    try {
      const { answer } = await chat.mutateAsync({
        clientId: parseInt(clientId),
        message: userMessage.content,
        history: history.map(m => ({ role: m.role, content: m.content })),
      });
      setMessagesByClient(prev => ({ ...prev, [clientId]: [...(prev[clientId] || []), { role: "assistant", content: answer }] }));
    } catch (error: any) {
      toast.error(error.message || "Error al consultar el asistente");
      setMessagesByClient(prev => ({ ...prev, [clientId]: prev[clientId]?.slice(0, -1) || [] }));
      setInput(userMessage.content);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 h-[calc(100vh-140px)] flex flex-col">
        <div>
          <h1 className="text-2xl font-bold text-[#42302E] flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-[#EDA011]" />
            Asistente IA
          </h1>
          <p className="text-muted-foreground mt-1">
            Pregunte sobre un cliente — el asistente usa los soportes ya cargados (declaraciones, informes) como referencia
          </p>
        </div>

        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-full sm:w-[320px]">
            <SelectValue placeholder="Seleccione un cliente para empezar" />
          </SelectTrigger>
          <SelectContent>
            {clients?.map((c: any) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.razonSocial}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Card className="flex-1 flex flex-col min-h-0">
          <CardContent className="flex-1 flex flex-col p-0 min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {!clientId ? (
                <div className="h-full flex items-center justify-center text-center text-muted-foreground">
                  <div>
                    <Sparkles className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Elija un cliente arriba para empezar a preguntar</p>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-muted-foreground">
                  <div>
                    <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Pregunte algo sobre {selectedClient?.razonSocial}</p>
                    <p className="text-xs mt-1">Ej: "¿Qué reportamos en el período anterior de IVA?"</p>
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && (
                      <div className="h-7 w-7 rounded-full bg-[#EDA011]/15 flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-[#EDA011]" />
                      </div>
                    )}
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user" ? "bg-[#EDA011] text-white" : "bg-muted"
                    }`}>
                      {m.content}
                    </div>
                    {m.role === "user" && (
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))
              )}
              {chat.isPending && (
                <div className="flex gap-2 justify-start">
                  <div className="h-7 w-7 rounded-full bg-[#EDA011]/15 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-[#EDA011]" />
                  </div>
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando...
                  </div>
                </div>
              )}
            </div>
            <div className="border-t p-3 flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={clientId ? "Escriba su pregunta..." : "Seleccione un cliente primero"}
                disabled={!clientId || chat.isPending}
                rows={2}
                className="resize-none"
              />
              <Button
                onClick={handleSend}
                disabled={!clientId || !input.trim() || chat.isPending}
                className="bg-[#EDA011] hover:bg-[#d48f0f] text-white self-end"
              >
                {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
