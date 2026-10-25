import { useRef } from "react";
import { Link } from "react-router-dom";
import HorizonField from "../components/HorizonField";
import { Badge, Card, Empty, Meter, Stat, riskLabel, riskTone } from "../components/ui";
import { useReveal } from "../lib/motion";
import { fmt, useLedger } from "../lib/store";

export default function Overview() {
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
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink">Donation transparency</p>
          <h1 className="mt-3 font-serif text-3xl font-medium leading-tight tracking-tight text-ink md:text-5xl">
            Every rupee, followed until it reaches someone.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-70">
            Funds wait in escrow and release in tranches only after vendors sign receipts and independent verifiers agree.
            When fraud signals appear, the campaign is frozen and payouts stop.
          </p>
        </div>
      </section>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total raised" value={`${fmt(raised)}`} hint="mUSD across campaigns" />
        <Stat label="Released to NGOs" value={`${fmt(released)}`} hint={`${raised ? Math.round((released / raised) * 100) : 0}% of raised`} />
        <Stat label="Verified receipts" value={verified} hint={`of ${data.evidence.length} submitted`} />
        <Stat label="Frozen campaigns" value={<span className={frozen ? "text-potion" : ""}>{frozen}</span>} hint="halted by automatic rules" />
      </div>

      <h2 className="mb-4 font-serif text-2xl" data-reveal>Campaigns</h2>
      {c.length === 0 && <Empty>No campaigns have been published yet.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {c.map((x) => (
          <Link key={x.id} to={`/campaigns/${x.id}`} className="group block rounded-2xl focus-visible:outline-offset-4">
            <Card className="h-full transition-colors group-hover:border-potion/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium leading-snug text-ink">{x.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-50">{x.ngo} · {x.region}</p>
                </div>
                {x.frozen ? <Badge tone="danger">Frozen</Badge> : <Badge tone="ok">Active</Badge>}
              </div>
              <div className="mt-5 space-y-3">
                <Meter label={`Raised ${fmt(x.raised)} of ${fmt(x.goal)}`} value={x.raised} max={x.goal} />
                <div className="flex h-2 overflow-hidden rounded-full bg-cloud-200" aria-label={`Released ${fmt(x.released)}, locked ${fmt(x.locked)}`} role="img">
                  <div data-bar className="bg-ok" style={{ width: `${x.raised ? (x.released / x.raised) * 100 : 0}%` }} />
                  <div data-bar className="bg-cloud-300" style={{ width: `${x.raised ? (x.locked / x.raised) * 100 : 0}%` }} />
                </div>
                <div className="flex justify-between text-xs text-ink-70">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />Released {fmt(x.released)}</span>
                  <span>In escrow {fmt(x.locked)}</span>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-cloud-300/70 pt-3 text-sm">
                <span className="text-ink-50">Risk score</span>
                <Badge tone={riskTone(x.riskScore)}>{x.riskScore}/100 · {riskLabel(x.riskScore)}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
