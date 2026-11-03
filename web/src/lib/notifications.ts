import { useCallback, useEffect, useState } from "react";
import { supabase, channelName } from "./supabase";

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Registers the service worker (production builds only). */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

/** Shows a system pop-up for a new notification while the app is open in the background. */
async function popup(n: AppNotification) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts = { body: n.body, icon: "/icon-192.png", badge: "/icon-192.png", tag: `n${n.id}`, data: { url: n.link ?? "/" } };
  if (reg) await reg.showNotification(n.title, opts);
  else new Notification(n.title, opts);
}

/** The signed-in user's notifications, kept live via Realtime. */
export function useNotifications(userId: string | null) {
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("notifications").select("*").eq("user_id", userId).order("id", { ascending: false }).limit(30);
    setItems((data as AppNotification[] | null) ?? []);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    const channel = supabase
      .channel(channelName(`notifications:${userId}`))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        const n = p.new as AppNotification;
        setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 30)));
        void popup(n);
      })
      .subscribe((s) => s === "SUBSCRIBED" && void load());
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const markAllRead = async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).eq("user_id", userId).is("read_at", null);
  };

  const markRead = async (id: number) => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  };

  return { items, unread: items.filter((n) => !n.read_at).length, markAllRead, markRead };
}
