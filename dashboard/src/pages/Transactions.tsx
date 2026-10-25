import { useRef, useState } from "react";
import { Badge, Card, Empty, SectionTitle, inputCls } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, fmt, short, useLedger } from "../lib/store";
import type { Tx } from "../lib/types";

const kindTone: Record<Tx["kind"], "ok" | "warn" | "danger" | "neutral"> = {
  donation: "ok", release: "ok", swap: "neutral", bridge: "neutral", offramp: "neutral", attestation: "neutral", freeze: "danger", refund: "warn",
};

export default function Transactions() {
  const { data } = useLedger();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Tx["kind"] | "all">("all");
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  const needle = q.trim().toLowerCase();
  const list = data.transactions
    .filter((t) => (kind === "all" || t.kind === kind) && (!needle || [t.hash, t.from, t.to].some((s) => s.toLowerCase().includes(needle))))
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div ref={ref}>
      <SectionTitle eyebrow="Ledger" title="Transaction history">
        <div className="flex flex-wrap gap-2">
          <label><span className="sr-only">Search</span>
            <input className={inputCls} placeholder="Search hash or party" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label><span className="sr-only">Type</span>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Tx["kind"] | "all")}>
              <option value="all">All types</option>
              {Object.keys(kindTone).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        </div>
      </SectionTitle>
      {list.length === 0 ? <Empty>No transactions match.</Empty> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-cloud-300 text-xs uppercase tracking-wider text-ink-50">
              <tr>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-5 py-3 font-medium">From → To</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Chain</th>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.hash} className="border-b border-cloud-300/60 last:border-0 hover:bg-cloud-200/50">
                  <td className="px-5 py-3"><Badge tone={kindTone[t.kind]}>{t.kind}</Badge></td>
                  <td className="px-5 py-3 text-ink-70">#{t.campaignId}</td>
                  <td className="px-5 py-3 text-ink-70">{t.from} → {t.to}</td>
                  <td className="tabular px-5 py-3 text-right">{t.amount ? fmt(t.amount) : "—"}</td>
                  <td className="px-5 py-3 text-ink-70">{t.chainId}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-ink-70">{date(t.at)}</td>
                  <td className="px-5 py-3 font-mono text-xs" title={t.hash}>{short(t.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
