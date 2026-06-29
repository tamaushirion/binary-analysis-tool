type GuardedApiRequestInput<T> = {
  key: string;
  minIntervalMs: number;
  request: () => Promise<T>;
};

const lastRequestAtMap = new Map<string, number>();
const cacheMap = new Map<string, unknown>();

export async function guardedApiRequest<T>(
  input: GuardedApiRequestInput<T>
): Promise<T> {
  const now = Date.now();
  const lastAt = lastRequestAtMap.get(input.key) ?? 0;
  const cached = cacheMap.get(input.key) as T | undefined;

  if (cached !== undefined && now - lastAt < input.minIntervalMs) {
    return cached;
  }

  const result = await input.request();

  lastRequestAtMap.set(input.key, now);
  cacheMap.set(input.key, result);

  return result;
}
