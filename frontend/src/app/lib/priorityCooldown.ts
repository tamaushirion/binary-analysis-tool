const last = new Map<string, number>();
export function canNotifyPrioritySignal(pair: string, signal: string, cooldownMs: number) {
  const key = `${pair}-${signal}`;
  const now = Date.now();
  const prev = last.get(key) ?? 0;
  if (now - prev < cooldownMs) return false;
  last.set(key, now);
  return true;
}
