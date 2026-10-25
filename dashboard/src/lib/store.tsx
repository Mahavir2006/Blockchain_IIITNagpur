import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { demoData } from "./demo";
import type { Evidence, LedgerData, Role } from "./types";

export const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

/** stale = API was reachable earlier but the last refresh failed; data shown is the last live copy. */
type Source = "loading" | "live" | "stale" | "demo";

interface Ctx {
  data: LedgerData;
  source: Source;
  role: Role;
  setRole: (r: Role) => void;
  busy: boolean;
  error: string;
  clearError: () => void;
  /** One vote per viewer: keys are `ev:<id>` and `unfreeze:<campaignId>`. */
  hasVoted: (key: string) => boolean;
  /** Actions resolve true on success; on failure they resolve false and set `error`. */
  donate: (campaignId: number, amount: number) => Promise<boolean>;
  submitEvidence: (e: Pick<Evidence, "campaignId" | "vendor" | "category" | "amount">) => Promise<boolean>;
  verifierVote: (evidenceId: string, vote: "approve" | "challenge") => Promise<boolean>;
  voteUnfreeze: (campaignId: number) => Promise<boolean>;
  requestTranche: (campaignId: number, index: number) => Promise<string>;
}

const LedgerContext = createContext<Ctx | null>(null);

/** Expected Phase 3 endpoints: GET /campaigns, /traces, /evidence, /alerts, /transactions. */
async function loadLive(): Promise<LedgerData> {
  const get = (p: string) => fetch(`${API}${p}`).then((r) => {
    if (!r.ok) throw new Error(`${p} ${r.status}`);
    return r.json();
  });
  const [campaigns, traces, evidence, alerts, transactions] = await Promise.all(
    ["/campaigns", "/traces", "/evidence", "/alerts", "/transactions"].map(get),
  );
  return { campaigns, traces, evidence, alerts, transactions };
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed (${r.status})`);
}

const EMPTY: LedgerData = { campaigns: [], traces: [], evidence: [], alerts: [], transactions: [] };
const ROLE_KEY = "bhl-role";
const ROLES: Role[] = ["donor", "ngo", "vendor", "verifier"];

function savedRole(): Role {
  try {
    const r = sessionStorage.getItem(ROLE_KEY) as Role | null;
    return r && ROLES.includes(r) ? r : "donor";
  } catch {
    return "donor";
  }
}

const rand = () => "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LedgerData>(API ? EMPTY : demoData);
  const [source, setSource] = useState<Source>(API ? "loading" : "demo");
  const [role, setRoleState] = useState<Role>(savedRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [votes, setVotes] = useState<Set<string>>(new Set());
  /** Rejects a repeat vote up front; the vote is only recorded once the action succeeds. */
  const castOnce = async (key: string, act: () => Promise<void> | void) => {
    if (votes.has(key)) throw new Error("you have already voted on this");
    await act();
    setVotes((v) => new Set(v).add(key));
  };

  const setRole = (r: Role) => {
    setRoleState(r);
    try {
      sessionStorage.setItem(ROLE_KEY, r);
    } catch {
      /* storage unavailable: role just won't survive a reload */
    }
  };

  const refresh = useCallback(async () => {
    if (!API) return;
    try {
      setData(await loadLive());
      setSource("live");
    } catch {
      // Never show stale live numbers under a "demo" label, or demo numbers as live.
      setSource((prev) => {
        if (prev === "live" || prev === "stale") return "stale";
        setData(demoData);
        return "demo";
      });
    }
  }, []);

  /** Runs an action with a busy flag and turns failures into a visible message. */
  const guard = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await fn(...a);
      return true;
    } catch (e) {
      const offline = e instanceof TypeError; // fetch() rejects with TypeError when the server is unreachable
      setError(`That action did not go through: ${offline ? "the ledger service could not be reached" : (e as Error).message}. Nothing was changed.`);
      if (offline) refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  const live = source === "live" || source === "stale";

  const donate = async (campaignId: number, amount: number): Promise<void> => {
    if (live) return post("/donations", { campaignId, amount }).then(refresh);
    setData((d) => ({
      ...d,
      campaigns: d.campaigns.map((c) => (c.id === campaignId ? { ...c, raised: c.raised + amount, locked: c.locked + amount } : c)),
      transactions: [{ hash: rand(), campaignId, kind: "donation", from: "You (demo)", to: "CampaignEscrow", amount, chainId: 31337, at: new Date().toISOString() }, ...d.transactions],
    }));
  };

  const submitEvidence = async (e: Pick<Evidence, "campaignId" | "vendor" | "category" | "amount">): Promise<void> => {
    if (live) return post("/evidence", e).then(refresh);
    setData((d) => ({
      ...d,
      evidence: [
        { ...e, id: `EV-${Math.floor(Math.random() * 900 + 400)}`, commitment: rand(), nullifier: rand(), state: "pending", approvals: 0, challenges: 0, quorum: 2, forgeryLikelihood: 0.1, submittedAt: new Date().toISOString() },
        ...d.evidence,
      ],
    }));
  };

  const verifierVote = async (evidenceId: string, vote: "approve" | "challenge"): Promise<void> => {
    const key = `ev:${evidenceId}`;
    if (live) return castOnce(key, () => post(`/evidence/${evidenceId}/${vote}`, {})).then(refresh);
    return castOnce(key, () => setData((d) => ({
      ...d,
      evidence: d.evidence.map((ev) => {
        if (ev.id !== evidenceId) return ev;
        const approvals = ev.approvals + (vote === "approve" ? 1 : 0);
        const challenges = ev.challenges + (vote === "challenge" ? 1 : 0);
        const state = challenges >= ev.quorum ? "rejected" : approvals >= ev.quorum ? "attested" : challenges > 0 ? "challenged" : "pending";
        return { ...ev, approvals, challenges, state };
      }),
    })));
  };

  const voteUnfreeze = async (campaignId: number): Promise<void> => {
    const key = `unfreeze:${campaignId}`;
    if (live) return castOnce(key, () => post(`/campaigns/${campaignId}/unfreeze-vote`, {})).then(refresh);
    return castOnce(key, () => setData((d) => ({
      ...d,
      campaigns: d.campaigns.map((c) => {
        if (c.id !== campaignId) return c;
        const votes = c.unfreezeVotes + 1;
        const unfrozen = votes >= c.requiredUnfreezeVotes;
        const tranches = unfrozen ? c.tranches.map((t) => (t.status === "blocked" ? { ...t, status: "pending" as const } : t)) : c.tranches;
        return { ...c, tranches, unfreezeVotes: unfrozen ? 0 : votes, frozen: !unfrozen, freezeReason: unfrozen ? 0 : c.freezeReason };
      }),
    })));
  };

  const requestTranche: Ctx["requestTranche"] = async (campaignId, index) => {
    const c = data.campaigns.find((x) => x.id === campaignId);
    const t = c?.tranches.find((x) => x.index === index);
    if (!c || !t) return "Tranche not found.";
    if (c.frozen) return "Release refused: this campaign is frozen.";
    if (t.impactScore < t.requiredScore) return `Release refused: impact score ${t.impactScore.toFixed(2)} is below the required ${t.requiredScore.toFixed(2)}.`;
    if (live) {
      await post(`/campaigns/${campaignId}/tranches/${index}/release`, {});
      await refresh();
      return "Release submitted.";
    }
    setData((d) => ({
      ...d,
      campaigns: d.campaigns.map((x) =>
        x.id !== campaignId ? x : {
          ...x,
          released: x.released + t.amount,
          locked: x.locked - t.amount,
          tranches: x.tranches.map((y) => (y.index === index ? { ...y, status: "released", releasedAt: new Date().toISOString() } : y)),
        },
      ),
    }));
    return "Tranche released (demo).";
  };

  return (
    <LedgerContext.Provider
      value={{
        data, source, role, setRole, busy, error, clearError: () => setError(""), hasVoted: (k) => votes.has(k),
        donate: guard(donate),
        submitEvidence: guard(submitEvidence),
        verifierVote: guard(verifierVote),
        voteUnfreeze: guard(voteUnfreeze),
        requestTranche: async (id, i) => {
          let msg = "";
          const ok = await guard(async () => { msg = await requestTranche(id, i); })();
          return ok ? msg : "";
        },
      }}
    >
      {children}
    </LedgerContext.Provider>
  );
}

export function useLedger() {
  const c = useContext(LedgerContext);
  if (!c) throw new Error("useLedger outside provider");
  return c;
}

export const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
export const short = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h);
export const date = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
