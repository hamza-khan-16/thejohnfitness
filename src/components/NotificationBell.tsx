import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, CheckCheck, AlertTriangle, Info, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const typeIcon: Record<string, any> = {
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
  error: XCircle,
};
const typeCls: Record<string, string> = {
  warning: "text-amber-500 bg-amber-500/10",
  info: "text-blue-500 bg-blue-500/10",
  success: "text-green-500 bg-green-500/10",
  error: "text-red-500 bg-red-500/10",
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: notifs = [] } = useQuery({
    enabled: !!user,
    queryKey: ["notifications", user?.id],
    queryFn: async () =>
      (await supabase.from("notifications").select("*").eq("user_id", user!.id)
        .order("created_at", { ascending: false }).limit(20)).data ?? [],
    // FIX #21: only refetch when tab is visible
    refetchInterval: () => document.visibilityState === "visible" ? 60_000 : false,
    refetchIntervalInBackground: false,
  });

  const unread = notifs.filter((n) => !n.is_read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from("notifications").update({ is_read: true })
        .eq("user_id", user!.id).eq("is_read", false);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-full border border-border p-2 hover:bg-secondary transition"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-semibold">Notifications</span>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button
                    onClick={() => markAllRead.mutate()}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <CheckCheck className="h-3 w-3" /> Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)}><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No notifications</div>
              ) : (
                notifs.map((n) => {
                  const Icon = typeIcon[n.type] ?? Info;
                  return (
                    <div
                      key={n.id}
                      className={`flex gap-3 border-b border-border px-4 py-3 transition ${!n.is_read ? "bg-secondary/40" : ""}`}
                    >
                      <div className={`mt-0.5 rounded-full p-1.5 ${typeCls[n.type] ?? typeCls.info}`}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold leading-tight">{n.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{n.message}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(n.created_at).toLocaleDateString("en-IN")}
                        </div>
                      </div>
                      {!n.is_read && (
                        <button onClick={() => dismiss.mutate(n.id)} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
