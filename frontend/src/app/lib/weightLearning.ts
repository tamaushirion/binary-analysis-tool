const KEY = "weight_learning_v1";

type WeightStore = Record<string, { wins: number; losses: number }>;

function load(): WeightStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function save(store: WeightStore) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function learnWeight(key: string, isWin: boolean) {
  const store = load();

  if (!store[key]) {
    store[key] = { wins: 0, losses: 0 };
  }

  if (isWin) {
    store[key].wins += 1;
  } else {
    store[key].losses += 1;
  }

  save(store);

  return store[key];
}
