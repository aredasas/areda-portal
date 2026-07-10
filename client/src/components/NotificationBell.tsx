import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, MessageSquare, ThumbsUp, RotateCcw, CheckCheck } from "lucide-react";

const typeConfig: Record<string, { icon: any; color: string }> = {
  comentario: { icon: MessageSquare, color: "text-blue-600" },
  aprobada: { icon: ThumbsUp, color: "text-green-600" },
  correccion_solicitada: { icon: RotateCcw, color: "text-orange-600" },
};

/** In-app notification bell — lets a collaborator know something happened
 * on a task/deadline they care about (comment, approval, correction)
 * without having to stumble onto it by chance. Polls every 20s, same
 * pattern used elsewhere in the app for lightweight background updates. */
export default function NotificationBell() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: unreadCount, refetch: refetchCount } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const { data: notificationsList, refetch: refetchList } = trpc.notifications.list.useQuery(
    { limit: 20 },
    { enabled: open }
  );
  const markRead = trpc.notifications.markRead.useMutation();
  const markAllRead = trpc.notifications.markAllRead.useMutation();

  const handleClickNotification = async (n: any) => {
    if (!n.isRead) {
      await markRead.mutateAsync({ id: n.id });
      refetchCount();
      refetchList();
    }
    setOpen(false);
    if (n.entityType === "task") {
      setLocation(`/tareas?taskId=${n.entityId}`);
    } else if (n.clientId) {
      setLocation(`/vencimientos?clientId=${n.clientId}&deadlineId=${n.entityId}`);
    } else {
      // Older notifications created before clientId was tracked — fall
      // back to just the page instead of a broken link.
      setLocation("/vencimientos");
    }
  };

  const handleMarkAllRead = async () => {
    await markAllRead.mutateAsync();
    refetchCount();
    refetchList();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {!!unreadCount && unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] rounded-full">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] max-h-[420px] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-medium text-sm">Notificaciones</span>
          {!!unreadCount && unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleMarkAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Marcar todas leídas
            </Button>
          )}
        </div>
        {notificationsList && notificationsList.length > 0 ? (
          <div>
            {notificationsList.map((n: any) => {
              const config = typeConfig[n.type] || typeConfig.comentario;
              const Icon = config.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => handleClickNotification(n)}
                  className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted/50 transition-colors flex gap-2 ${!n.isRead ? "bg-[#FFF8E2]" : ""}`}
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {n.message && <p className="text-xs text-muted-foreground truncate">{n.message}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(n.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  {!n.isRead && <span className="h-2 w-2 rounded-full bg-[#EDA011] shrink-0 mt-1.5" />}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Sin notificaciones</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
