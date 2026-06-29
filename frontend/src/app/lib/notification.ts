export function shouldNotifySignal(signal: string, confidence: number) {
  return (signal === "HIGH" || signal === "LOW") && confidence >= 80;
}
export function playSignalSound() {}
export function showBrowserNotification(title: string, body: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification(title, { body });
}
export async function requestNotificationPermission() {
  if (typeof window === "undefined") return "denied";
  if (!("Notification" in window)) return "denied";
  return Notification.requestPermission();
}
