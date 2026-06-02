// Notificações locais do lembrete de leitura.
//
// Escopo atual: lembrete LOCAL — dispara no horário enquanto o app/PWA está
// aberto ou em background recente. Não dispara com o app totalmente fechado
// (isso exige Web Push + servidor; ver push.ts / PUSH_SETUP.md).

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission {
  if (!notificationsSupported()) return "denied";
  return Notification.permission;
}

/** Pede permissão de notificação. Retorna o estado final. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Mostra a notificação (via service worker quando disponível — melhor no mobile). */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body,
    icon: "/pwa-192.png",
    badge: "/favicon-32.png",
    tag: "nhagriot-reminder", // substitui a anterior em vez de empilhar
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // cai no fallback abaixo
  }
  try {
    new Notification(title, options);
  } catch {
    // ignore
  }
}

/**
 * "HH:MM" já passou hoje? Compara com a hora local atual.
 */
export function timeReached(hhmm: string, now: Date = new Date()): boolean {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const target = h * 60 + m;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= target;
}
