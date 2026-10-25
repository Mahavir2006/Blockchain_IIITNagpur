export type Role = "donor" | "ngo" | "vendor" | "verifier";

export interface CategoryBudget {
  name: string;
  cap: number;
  spent: number;
}

export type TrancheStatus = "released" | "pending" | "locked" | "blocked";

export interface Tranche {
  index: number;
  amount: number;
  status: TrancheStatus;
  impactScore: number;
  requiredScore: number;
  releasedAt?: string;
}

export interface Campaign {
  id: number;
  name: string;
  ngo: string;
  region: string;
  goal: number;
  raised: number;
  released: number;
  locked: number;
  frozen: boolean;
  freezeReason: number;
  unfreezeVotes: number;
  requiredUnfreezeVotes: number;
  riskScore: number;
  categories: CategoryBudget[];
  tranches: Tranche[];
}

export type StageStatus = "verified" | "pending" | "failed";

export interface TraceStage {
  key: string;
  label: string;
  plain: string;
  chainId: number;
  txHash: string;
  amount: number;
  asset: string;
  at: string;
  status: StageStatus;
  confidence: number;
  factors: string[];
}

export interface DonationTrace {
  donationId: string;
  campaignId: number;
  donor: string;
  amount: number;
  composite: number;
  stages: TraceStage[];
}

export type EvidenceState = "attested" | "pending" | "challenged" | "rejected";

export interface Evidence {
  id: string;
  campaignId: number;
  vendor: string;
  category: string;
  amount: number;
  commitment: string;
  nullifier: string;
  state: EvidenceState;
  approvals: number;
  challenges: number;
  quorum: number;
  forgeryLikelihood: number;
  submittedAt: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface Alert {
  id: string;
  campaignId: number;
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  onChainReason?: string;
  at: string;
}

export interface Tx {
  hash: string;
  campaignId: number;
  kind: "donation" | "swap" | "bridge" | "offramp" | "release" | "freeze" | "attestation" | "refund";
  from: string;
  to: string;
  amount: number;
  chainId: number;
  at: string;
}

export interface LedgerData {
  campaigns: Campaign[];
  traces: DonationTrace[];
  evidence: Evidence[];
  alerts: Alert[];
  transactions: Tx[];
}
