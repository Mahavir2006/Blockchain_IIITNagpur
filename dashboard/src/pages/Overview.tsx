import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import HorizonField from "../components/HorizonField";
import { Badge, Card, Empty, Meter, Stat, riskLabel, riskTone } from "../components/ui";
import { useReveal } from "../lib/motion";
import { fmt, useLedger } from "../lib/store";

export default function Overview() {
  const { t } = useTranslation();
  const { data } = useLedger();
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  const c = data.campaigns;
  const raised = c.reduce((s, x) => s + x.raised, 0);
  const released = c.reduce((s, x) => s + x.released, 0);
  const frozen = c.filter((x) => x.frozen).length;
  const verified = data.evidence.filter((e) => e.state === "attested").length;

  return (
    <div ref={ref}>
      <section data-reveal className="relative mb-8 overflow-hidden rounded-3xl bg-cloud-200">
        <div className="absolute inset-0 opacity-90">
          <HorizonField />
        </div>
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-cloud-200 via-cloud-200/80 to-transparent md:via-cloud-200/40" />
        <div className="relative max-w-xl p-6 md:p-10">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink">{t("overview.eyebrow")}</p>
          <h1 className="mt-3 font-serif text-3xl font-medium leading-tight tracking-tight text-ink md:text-5xl">{t("overview.title")}</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-70">{t("overview.lead")}</p>
        </div>
      </section>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("overview.totalRaised")} value={fmt(raised)} hint={t("overview.acrossCampaigns")} />
        <Stat label={t("overview.released")} value={fmt(released)} hint={t("overview.ofRaised", { pct: fmt(raised ? Math.round((released / raised) * 100) : 0) })} />
        <Stat label={t("overview.verifiedReceipts")} value={fmt(verified)} hint={t("overview.ofSubmitted", { count: fmt(data.evidence.length) })} />
        <Stat label={t("overview.frozenCampaigns")} value={<span className={frozen ? "text-potion" : ""}>{fmt(frozen)}</span>} hint={t("overview.haltedBy")} />
      </div>

      <h2 className="mb-4 font-serif text-2xl" data-reveal>{t("overview.campaigns")}</h2>
      {c.length === 0 && <Empty>{t("overview.none")}</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {c.map((x) => (
          <Link key={x.id} to={`/campaigns/${x.id}`} className="group block rounded-2xl focus-visible:outline-offset-4">
            <Card className="h-full transition-colors group-hover:border-potion/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium leading-snug text-ink">{x.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-50">{x.ngo} · {x.region}</p>
                </div>
                {x.frozen ? <Badge tone="danger">{t("common.frozen")}</Badge> : <Badge tone="ok">{t("common.active")}</Badge>}
              </div>
              <div className="mt-5 space-y-3">
                <Meter label={t("overview.raisedOf", { raised: fmt(x.raised), goal: fmt(x.goal) })} value={x.raised} max={x.goal} />
                <div className="flex h-2 overflow-hidden rounded-full bg-cloud-200" aria-label={t("overview.releasedLocked", { released: fmt(x.released), locked: fmt(x.locked) })} role="img">
                  <div data-bar className="bg-ok" style={{ width: `${x.raised ? (x.released / x.raised) * 100 : 0}%` }} />
                  <div data-bar className="bg-cloud-300" style={{ width: `${x.raised ? (x.locked / x.raised) * 100 : 0}%` }} />
                </div>
                <div className="flex justify-between gap-2 text-xs text-ink-70">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />{t("overview.releasedAmount", { amount: fmt(x.released) })}</span>
                  <span>{t("overview.inEscrow", { amount: fmt(x.locked) })}</span>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-2 border-t border-cloud-300/70 pt-3 text-sm">
                <span className="text-ink-50">{t("overview.riskScore")}</span>
                <Badge tone={riskTone(x.riskScore)}>{fmt(x.riskScore)}/{fmt(100)} · {t(riskLabel(x.riskScore))}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
