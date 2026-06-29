export type DerivAccount = {
  accountId: string;
  currency: string;
  accountType: "demo" | "real";
};

export type ProposalRequest = {
  symbol: string;
  contractType: "CALL" | "PUT";
  stake: number;
  duration: number;
  durationUnit: "s" | "m" | "t";
};

export type ProposalResult = {
  proposalId: string | null;

  askPrice: number | null;

  payout: number | null;

  profit: number | null;

  payoutRate: number | null;

  latencyMs: number;

  raw: unknown;
};

export type BuyResult = {
  contractId: string;

  buyPrice: number;

  buyTime: number;

  raw: unknown;
};

export type ContractStatus = {
  contractId: string;

  isSold: boolean;

  isExpired: boolean;

  profit: number;

  sellPrice: number;

  raw: unknown;
};