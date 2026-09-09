import { supabase } from "./supabase";

// Llave pública VAPID -- no es secreta, está hecha para vivir en el cliente
// (la privada nunca sale de config_sistema en la base, ver
// supabase/migrations/20260909100000_push_y_checador.sql).
const VAPID_PUBLIC_KEY = "BKryee_sPNVa2dcoAqUuDTPEHW5T6FNaIhBFbaM7XBFB4oh4pJDHlAU0CRskq9BTAXkMSaJgsz6WsDhjpSzeM3w";

function base64UrlABytes(base64Url: string): Uint8Array {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

export function pushSoportado(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function estaSuscrito(): Promise<boolean> {
  if (!pushSoportado()) return false;
  const registro = await navigator.serviceWorker.ready;
  const sub = await registro.pushManager.getSubscription();
  return !!sub;
}

export async function suscribirsePush(profileId: string): Promise<void> {
  if (!pushSoportado()) throw new Error("Este navegador no soporta notificaciones push.");

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error("No diste permiso de notificaciones.");

  const registro = await navigator.serviceWorker.ready;
  let sub = await registro.pushManager.getSubscription();
  if (!sub) {
    sub = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlABytes(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase
    .from("push_subscripciones")
    .upsert(
      { profile_id: profileId, endpoint: json.endpoint!, p256dh: json.keys!.p256dh, auth: json.keys!.auth },
      { onConflict: "endpoint" },
    );
  if (error) throw error;
}

export async function desuscribirsePush(): Promise<void> {
  if (!pushSoportado()) return;
  const registro = await navigator.serviceWorker.ready;
  const sub = await registro.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscripciones").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
