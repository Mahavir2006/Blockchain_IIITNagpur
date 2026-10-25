import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Field, Meter, SectionTitle, Stat, inputCls, riskLabel, riskTone } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, dec, fmt, useLedger } from "../lib/store";
import type { TrancheStatus } from "../lib/types";

const trancheTone: Record<TrancheStatus, "ok" | "warn" | "neutral" | "danger"> = { released: "ok", pending: "warn", locked: "neutral", blocked: "danger" };

export default function CampaignDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, role, busy, hasVoted, donate, voteUnfreeze, requestTranche } = useLedger();
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, [id]);
  const [amount, setAmount] = useState("10");
  const [msg, setMsg] = useState("");

  // A voice command like "donate 10 to campaign 1" arrives as ?donate=10: prefill, never submit.
  const prefill = params.get("donate");
  useEffect(() => {
    if (prefill && Number(prefill) > 0) {
      setAmount(prefill);
      setMsg(t("campaign.msgPrefilled", { amount: fmt(Number(prefill)) }));
    }
  }, [prefill, t]);

  const c = data.campaigns.find((x) => String(x.id) === id);
  if (!c) return <p>{t("campaign.notFound")} <Link className="text-potion underline" to="/">{t("campaign.back")}</Link></p>;

  const alerts = data.alerts.filter((a) => a.campaignId === c.id);

  const onDonate = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    const n = Number(amount);
    if (!(n > 0)) return setMsg(t("campaign.msgPositive"));
    if (c.frozen) return setMsg(t("campaign.msgFrozen"));
    if (c.raised + n > c.goal) return setMsg(t("campaign.msgExceeds", { amount: fmt(c.goal - c.raised) }));
    if (await donate(c.id, n)) setMsg(t("campaign.msgThanks", { amount: fmt(n) }));
  };

  return (
    <div ref={ref}>
      <p className="mb-2 text-sm"><Link to="/" className="text-ink-50 hover:text-potion">{t("campaign.allCampaigns")}</Link></p>
      <SectionTitle eyebrow={`${c.ngo} · ${c.region}`} title={c.name}>
        <div className="flex flex-wrap gap-2">
          {c.frozen ? <Badge tone="danger">{t("common.frozen")}</Badge> : <Badge tone="ok">{t("common.active")}</Badge>}
          <Badge tone={riskTone(c.riskScore)}>{t("campaign.risk", { score: fmt(c.riskScore), max: fmt(100), label: t(riskLabel(c.riskScore)) })}</Badge>
        </div>
      </SectionTitle>

      {c.frozen && (
        <Card className="mb-6 border-potion/40 bg-potion-50" role="alert">
          <h2 className="font-medium text-potion-600">{t("campaign.frozenTitle")}</h2>
          <p className="mt-1 text-sm text-ink-70">{t(`freezeReasons.${c.freezeReason}`)}</p>
          <p className="mt-1 font-mono text-xs text-ink-50">{t("campaign.reasonCode", { code: c.freezeReason })}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="min-w-[220px] flex-1"><Meter label={t("campaign.unfreezeVotes", { votes: fmt(c.unfreezeVotes), required: fmt(c.requiredUnfreezeVotes) })} value={c.unfreezeVotes} max={c.requiredUnfreezeVotes} /></div>
            {role === "verifier" ? (
              hasVoted(`unfreeze:${c.id}`) ? (
                <p className="text-xs text-ink-50">{t("campaign.voteRecorded")}</p>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => voteUnfreeze(c.id)}>{t("campaign.castUnfreeze")}</Button>
              )
            ) : (
              <p className="text-xs text-ink-50">{t("campaign.quorumOnly")}</p>
            )}
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("campaign.raised")} value={fmt(c.raised)} hint={t("campaign.goal", { amount: fmt(c.goal) })} />
        <Stat label={t("campaign.released")} value={fmt(c.released)} />
        <Stat label={t("campaign.held")} value={fmt(c.locked)} />
        <Stat label={t("campaign.openAlerts")} value={fmt(alerts.length)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="mb-4 font-serif text-xl">{t("campaign.tranches")}</h2>
          <ol className="space-y-4">
            {c.tranches.map((tr) => (
              <li key={tr.index} className="rounded-xl border border-cloud-300/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t("campaign.tranche", { index: fmt(tr.index) })} · <span className="tabular">{fmt(tr.amount)} mUSD</span></p>
                  <Badge tone={trancheTone[tr.status]}>{t(`tranche.${tr.status}`)}</Badge>
                </div>
                <div className="mt-3">
                  <Meter label={t("campaign.impact", { score: dec(tr.impactScore), required: dec(tr.requiredScore) })} value={tr.impactScore} />
                </div>
                {tr.releasedAt && <p className="mt-2 text-xs text-ink-50">{t("campaign.releasedAt", { date: date(tr.releasedAt) })}</p>}
                {role === "ngo" && tr.status === "pending" && (
                  <Button className="mt-3" disabled={busy} onClick={async () => { setMsg(""); const m = await requestTranche(c.id, tr.index); if (m) setMsg(m); }}>{t("campaign.requestRelease")}</Button>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-serif text-xl">{t("campaign.categories")}</h2>
            <div className="space-y-4">
              {c.categories.map((k) => (
                <Meter key={k.name} label={t("campaign.categoryLine", { name: k.name, spent: fmt(k.spent), cap: fmt(k.cap) })} value={k.spent} max={k.cap} invert />
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-50">{t("campaign.categoryNote")}</p>
          </Card>

          {role === "donor" && (
            <Card>
              <h2 className="mb-3 font-serif text-xl">{t("campaign.donate")}</h2>
              <form onSubmit={onDonate} className="flex items-end gap-2">
                <Field label={t("common.amountMusd")}>
                  <input className={inputCls} type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Button type="submit" disabled={c.frozen || busy}>{t("campaign.donate")}</Button>
              </form>
            </Card>
          )}

          {msg && <p role="status" className="rounded-xl bg-cloud-200 px-4 py-3 text-sm text-ink-70">{msg}</p>}

          <Card>
            <h2 className="mb-3 font-serif text-xl">{t("campaign.alertsTitle")}</h2>
            {alerts.length ? (
              <ul className="space-y-2 text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2">
                    <span>{a.title}</span>
                    <Badge tone={a.severity === "critical" || a.severity === "high" ? "danger" : a.severity === "medium" ? "warn" : "neutral"}>{t(`severity.${a.severity}`)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-50">{t("campaign.noAlerts")}</p>
            )}
            <Link to="/trace" className="mt-4 inline-block text-sm text-potion underline-offset-4 hover:underline">{t("campaign.followDonation")}</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
