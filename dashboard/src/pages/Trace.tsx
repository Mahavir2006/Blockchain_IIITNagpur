import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Card, Empty, Meter, SectionTitle, inputCls } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, fmt, short, useLedger } from "../lib/store";

const statusTone = { verified: "ok", pending: "warn", failed: "danger" } as const;

export default function Trace() {
  const { t } = useTranslation();
  const { data } = useLedger();
  const [sel, setSel] = useState(data.traces[0]?.donationId ?? "");
  const tr = data.traces.find((x) => x.donationId === sel) ?? data.traces[0];
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, [sel]);
  const campaign = data.campaigns.find((c) => c.id === tr?.campaignId);

  return (
    <div ref={ref}>
      <SectionTitle eyebrow={t("trace.eyebrow")} title={t("trace.title")}>
        <label className="text-sm">
          <span className="sr-only">{t("trace.choose")}</span>
          <select className={inputCls} value={sel} onChange={(e) => setSel(e.target.value)}>
            {data.traces.map((x) => (
              <option key={x.donationId} value={x.donationId}>{x.donationId} · {fmt(x.amount)} mUSD</option>
            ))}
          </select>
        </label>
      </SectionTitle>

      {!tr && <Empty>{t("trace.none")}</Empty>}
      {tr && (
        <>
          <Card className="mb-6 grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm text-ink-50">{t("trace.campaign")}</p>
              <p className="mt-1 font-medium">{campaign?.name}</p>
            </div>
            <div>
              <p className="text-sm text-ink-50">{t("trace.donor")}</p>
              <p className="mt-1 font-mono text-sm">{tr.donor}</p>
            </div>
            <div>
              <Meter label={t("trace.overall")} value={tr.composite} />
              <p className="mt-1 text-xs text-ink-50">{t("trace.combined")}</p>
            </div>
          </Card>

          <ol className="relative space-y-4 border-l-2 border-cloud-300 pl-6">
            {tr.stages.map((s, i) => (
              <li key={s.key} className="relative" data-reveal>
                <span
                  aria-hidden
                  className={`absolute -left-[33px] top-5 grid h-4 w-4 place-items-center rounded-full border-2 border-cloud ${s.status === "verified" ? "bg-ok" : s.status === "failed" ? "bg-potion" : "bg-pepper"}`}
                />
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-ink-50">{t("trace.step", { n: fmt(i + 1), chain: s.chainId })}</p>
                      <h2 className="font-medium">{s.label}</h2>
                    </div>
                    <Badge tone={statusTone[s.status]}>{t("stage." + s.status)}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-70">{s.plain}</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1.2fr]">
                    <div className="space-y-1 text-xs text-ink-70">
                      <p><span className="text-ink-50">{t("trace.amount")}</span> <span className="tabular">{fmt(s.amount)}</span> {s.asset}</p>
                      <p><span className="text-ink-50">{t("trace.when")}</span> {date(s.at)}</p>
                      <p><span className="text-ink-50">{t("trace.transaction")}</span> <code className="font-mono" title={s.txHash}>{short(s.txHash)}</code></p>
                    </div>
                    <div>
                      <Meter label={t("trace.stageConfidence")} value={s.confidence} />
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-potion">{t("trace.why")}</summary>
                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-ink-70">
                          {s.factors.map((f) => <li key={f}>{f}</li>)}
                        </ul>
                      </details>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
