const KEY = "risk_override_v1";
export function saveRiskOverride(pair: string) {
  if (typeof window !== "undefined") localStorage.setItem(`${KEY}_${pair}`, "1");
}
export function hasRiskOverride(pair: string) {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(`${KEY}_${pair}`) === "1";
}
