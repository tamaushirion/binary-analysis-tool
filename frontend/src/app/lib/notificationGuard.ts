const last = new Map<string, number>();
export function canNotifySignal(input: { pair: string; signal: string; cooldownMs: number }) {
  const key = `${input.pair}-${input.signal}`;
  const now = Date.now();
  const prev = last.get(key) ?? 0;
  if (now - prev < input.cooldownMs) return false;
  last.set(key, now);
  return true;
}
