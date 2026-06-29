export type PayoutCacheItem = {
  key: string;
  accountId: string;
  pair: string;
  direction: "HIGH" | "LOW";
  amount: number;
  duration: number;
  durationUnit: "s" | "m" | "h" | "d";
  currency: string;
  proposalId: string | null;
  askPrice: number | null;
  payout: number | null;
  payoutRate: number | null;
  spot: number | null;
  createdAt: number;
  expiresAt: number;
};

const CACHE_TTL_MS = 20_000;

const payoutCache = new Map<string, PayoutCacheItem>();

export function createPayoutCacheKey(input: {
  accountId: string;
  pair: string;
  direction: "HIGH" | "LOW";
  amount: number;
  duration: number;
  durationUnit: "s" | "m" | "h" | "d";
  currency: string;
}) {
  return [
    input.accountId,
    input.pair,
    input.direction,
    input.amount,
    input.duration,
    input.durationUnit,
    input.currency,
  ].join("|");
}

export function setPayoutCache(item: Omit<PayoutCacheItem, "createdAt" | "expiresAt">) {
  const now = Date.now();

  const cacheItem: PayoutCacheItem = {
    ...item,
    createdAt: now,
    expiresAt: now + CACHE_TTL_MS,
  };

  payoutCache.set(item.key, cacheItem);

  return cacheItem;
}

export function getPayoutCache(key: string) {
  const item = payoutCache.get(key);

  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    payoutCache.delete(key);
    return null;
  }

  return item;
}

export function getAllPayoutCache() {
  const now = Date.now();

  for (const [key, item] of payoutCache.entries()) {
    if (now > item.expiresAt) {
      payoutCache.delete(key);
    }
  }

  return Array.from(payoutCache.values());
}