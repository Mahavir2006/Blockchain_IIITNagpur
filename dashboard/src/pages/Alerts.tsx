import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, Empty, SectionTitle, inputCls } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, useLedger } from "../lib/store";
import type { Severity } from "../lib/types";

const sevTone = { critical: "danger", high: "danger", medium: "warn", low: "neutral" } as const;
const ruleText: Record<string, string> = {
  "duplicate-evidence": "Duplicate evidence",
  "forgery-ratio": "Forged receipts",
  "vendor-concentration": "Vendor concentration",
  "amount-clustering": "Amount clustering",
  "report-mismatch": "Report vs ledger",
  "unexplained-transfer": "Unexplained transfer",
  "category-breach": "Outside category",
};

export default function Alerts() {
  const { data } = useLedger();
  const [sev, setSev] = useState<Severity | "all">("all");
  const [camp, setCamp] = useState("all");
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, [sev, camp]);
  const list = data.alerts.filter((a) => (sev === "all" || a.severity === sev) && (camp === "all" || String(a.campaignId) === camp));

  return (
    <div ref={ref}>
      <SectionTitle eyebrow="Fraud and anomaly signals" title="Alerts">
        <div className="flex flex-wrap gap-2">
          <label><span className="sr-only">Severity</span>
            <select className={inputCls} value={sev} onChange={(e) => setSev(e.target.value as Severity | "all")}>
              <option value="all">All severities</option>
              {(["critical", "high", "medium", "low"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label><span className="sr-only">Campaign</span>
            <select className={inputCls} value={camp} onChange={(e) => setCamp(e.target.value)}>
              <option value="all">All campaigns</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </SectionTitle>
      <p className="mb-6 max-w-2xl text-sm text-ink-70" data-reveal>
        Statistical signals are prompts for review, not proof of fraud. Only rule breaches with an on-chain reason freeze a campaign.
      </p>
      {list.length === 0 ? <Empty>No alerts match these filters.</Empty> : (
        <ul className="space-y-3">
          {list.map((a) => {
            const c = data.campaigns.find((x) => x.id === a.campaignId);
            return (
              <li key={a.id}>
                <Card className={a.severity === "critical" ? "border-potion/40" : ""}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-ink-50">{ruleText[a.rule] ?? a.rule} · {date(a.at)}</p>
                      <h2 className="font-medium">{a.title}</h2>
                    </div>
                    <Badge tone={sevTone[a.severity]}>{a.severity}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-70">{a.detail}</p>
                  {a.onChainReason && <p className="mt-2 rounded-lg bg-cloud-200 px-3 py-2 font-mono text-xs text-ink-70">{a.onChainReason}</p>}
                  {c && <Link to={`/campaigns/${c.id}`} className="mt-3 inline-block text-sm text-potion hover:underline">{c.name} →</Link>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
