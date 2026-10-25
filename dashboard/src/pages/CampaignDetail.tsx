import { useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Field, Meter, SectionTitle, Stat, inputCls, riskLabel, riskTone } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, fmt, useLedger } from "../lib/store";
import { FREEZE_REASONS, type TrancheStatus } from "../lib/types";

const trancheTone: Record<TrancheStatus, "ok" | "warn" | "neutral" | "danger"> = { released: "ok", pending: "warn", locked: "neutral", blocked: "danger" };
const trancheText: Record<TrancheStatus, string> = { released: "Released", pending: "Awaiting proof", locked: "Locked", blocked: "Blocked by freeze" };

export default function CampaignDetail() {
  const { id } = useParams();
  const { data, role, busy, hasVoted, donate, voteUnfreeze, requestTranche } = useLedger();
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, [id]);
  const [amount, setAmount] = useState("10");
  const [msg, setMsg] = useState("");
  const c = data.campaigns.find((x) => String(x.id) === id);
  if (!c) return <p>Campaign not found. <Link className="text-potion underline" to="/">Back to campaigns</Link></p>;

  const alerts = data.alerts.filter((a) => a.campaignId === c.id);

  const onDonate = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    const n = Number(amount);
    if (!(n > 0)) return setMsg("Enter an amount greater than zero.");
    if (c.frozen) return setMsg("This campaign is frozen; new donations are paused until verifiers resolve it.");
    if (c.raised + n > c.goal) return setMsg(`That would exceed the campaign goal. At most ${fmt(c.goal - c.raised)} mUSD can still be donated.`);
    if (await donate(c.id, n)) setMsg(`Thank you — ${fmt(n)} mUSD is now held in escrow.`);
  };

  return (
    <div ref={ref}>
      <p className="mb-2 text-sm"><Link to="/" className="text-ink-50 hover:text-potion">← All campaigns</Link></p>
      <SectionTitle eyebrow={`${c.ngo} · ${c.region}`} title={c.name}>
        <div className="flex gap-2">
          {c.frozen ? <Badge tone="danger">Frozen</Badge> : <Badge tone="ok">Active</Badge>}
          <Badge tone={riskTone(c.riskScore)}>Risk {c.riskScore}/100 · {riskLabel(c.riskScore)}</Badge>
        </div>
      </SectionTitle>

      {c.frozen && (
        <Card className="mb-6 border-potion/40 bg-potion-50" role="alert">
          <h2 className="font-medium text-potion-600">Disbursements are frozen</h2>
          <p className="mt-1 text-sm text-ink-70">{FREEZE_REASONS[c.freezeReason]}</p>
          <p className="mt-1 font-mono text-xs text-ink-50">on-chain reason code: {c.freezeReason}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="min-w-[220px] flex-1"><Meter label={`Unfreeze votes ${c.unfreezeVotes} of ${c.requiredUnfreezeVotes}`} value={c.unfreezeVotes} max={c.requiredUnfreezeVotes} /></div>
            {role === "verifier" ? (
              hasVoted(`unfreeze:${c.id}`) ? (
                <p className="text-xs text-ink-50">Your vote is recorded. Another verifier must also vote.</p>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => voteUnfreeze(c.id)}>Cast unfreeze vote</Button>
              )
            ) : (
              <p className="text-xs text-ink-50">Only a verifier quorum can lift a freeze — never a single admin.</p>
            )}
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Raised" value={fmt(c.raised)} hint={`goal ${fmt(c.goal)} mUSD`} />
        <Stat label="Released" value={fmt(c.released)} />
        <Stat label="Held in escrow" value={fmt(c.locked)} />
        <Stat label="Open alerts" value={alerts.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="mb-4 font-serif text-xl">Tranche releases</h2>
          <ol className="space-y-4">
            {c.tranches.map((t) => (
              <li key={t.index} className="rounded-xl border border-cloud-300/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Tranche {t.index} · <span className="tabular">{fmt(t.amount)} mUSD</span></p>
                  <Badge tone={trancheTone[t.status]}>{trancheText[t.status]}</Badge>
                </div>
                <div className="mt-3">
                  <Meter label={`Impact score ${t.impactScore.toFixed(2)} (needs ${t.requiredScore.toFixed(2)})`} value={t.impactScore} />
                </div>
                {t.releasedAt && <p className="mt-2 text-xs text-ink-50">Released {date(t.releasedAt)}</p>}
                {role === "ngo" && t.status === "pending" && (
                  <Button className="mt-3" disabled={busy} onClick={async () => { setMsg(""); const m = await requestTranche(c.id, t.index); if (m) setMsg(m); }}>Request release</Button>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 font-serif text-xl">Category budgets</h2>
            <div className="space-y-4">
              {c.categories.map((k) => (
                <Meter key={k.name} label={`${k.name} — ${fmt(k.spent)} of ${fmt(k.cap)}`} value={k.spent} max={k.cap} invert />
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-50">Spending is tracked against each category budget declared by the NGO.</p>
          </Card>

          {role === "donor" && (
            <Card>
              <h2 className="mb-3 font-serif text-xl">Donate</h2>
              <form onSubmit={onDonate} className="flex items-end gap-2">
                <Field label="Amount (mUSD)">
                  <input className={inputCls} type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Button type="submit" disabled={c.frozen || busy}>Donate</Button>
              </form>
            </Card>
          )}

          {msg && <p role="status" className="rounded-xl bg-cloud-200 px-4 py-3 text-sm text-ink-70">{msg}</p>}

          <Card>
            <h2 className="mb-3 font-serif text-xl">Alerts for this campaign</h2>
            {alerts.length ? (
              <ul className="space-y-2 text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2">
                    <span>{a.title}</span>
                    <Badge tone={a.severity === "critical" || a.severity === "high" ? "danger" : a.severity === "medium" ? "warn" : "neutral"}>{a.severity}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-50">No alerts.</p>
            )}
            <Link to="/trace" className="mt-4 inline-block text-sm text-potion underline-offset-4 hover:underline">Follow a donation →</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
