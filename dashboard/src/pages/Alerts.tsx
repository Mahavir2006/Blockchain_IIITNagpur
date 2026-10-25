import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Card, Empty, SectionTitle, inputCls } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, useLedger } from "../lib/store";
import type { Severity } from "../lib/types";

const sevTone = { critical: "danger", high: "danger", medium: "warn", low: "neutral" } as const;
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const asSeverity = (v: string | null): Severity | "all" => (SEVERITIES as string[]).includes(v ?? "") ? (v as Severity) : "all";

export default function Alerts() {
  const { t } = useTranslation();
  const { data } = useLedger();
  const [params, setParams] = useSearchParams();
  // ?severity=critical (set by voice commands or links) selects the filter.
  const [sev, setSevState] = useState<Severity | "all">(asSeverity(params.get("severity")));
  useEffect(() => setSevState(asSeverity(params.get("severity"))), [params]);
  const setSev = (s: Severity | "all") => {
    setSevState(s);
    setParams(s === "all" ? {} : { severity: s }, { replace: true });
  };
  const [camp, setCamp] = useState("all");
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, [sev, camp]);
  const list = data.alerts.filter((a) => (sev === "all" || a.severity === sev) && (camp === "all" || String(a.campaignId) === camp));

  return (
    <div ref={ref}>
      <SectionTitle eyebrow={t("alerts.eyebrow")} title={t("alerts.title")}>
        <div className="flex flex-wrap gap-2">
          <label><span className="sr-only">{t("alerts.severity")}</span>
            <select className={inputCls} value={sev} onChange={(e) => setSev(e.target.value as Severity | "all")}>
              <option value="all">{t("alerts.allSeverities")}</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{t(`severity.${s}`)}</option>)}
            </select>
          </label>
          <label><span className="sr-only">{t("alerts.campaign")}</span>
            <select className={inputCls} value={camp} onChange={(e) => setCamp(e.target.value)}>
              <option value="all">{t("alerts.allCampaigns")}</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </SectionTitle>
      <p className="mb-6 max-w-2xl text-sm text-ink-70" data-reveal>{t("alerts.note")}</p>
      {list.length === 0 ? <Empty>{t("alerts.none")}</Empty> : (
        <ul className="space-y-3">
          {list.map((a) => {
            const c = data.campaigns.find((x) => x.id === a.campaignId);
            return (
              <li key={a.id}>
                <Card className={a.severity === "critical" ? "border-potion/40" : ""}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-ink-50">{t(`rules.${a.rule}`, { defaultValue: a.rule })} · {date(a.at)}</p>
                      <h2 className="font-medium">{a.title}</h2>
                    </div>
                    <Badge tone={sevTone[a.severity]}>{t(`severity.${a.severity}`)}</Badge>
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
