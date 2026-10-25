import { useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, Empty, Field, Meter, SectionTitle, inputCls } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, fmt, short, useLedger } from "../lib/store";
import type { EvidenceState } from "../lib/types";

const tone = { attested: "ok", pending: "warn", challenged: "danger", rejected: "danger" } as const;
const text: Record<EvidenceState, string> = { attested: "Verified", pending: "Awaiting verifiers", challenged: "Challenged", rejected: "Rejected" };

export default function EvidencePage() {
  const { data, role, busy, hasVoted, verifierVote, submitEvidence } = useLedger();
  const [filter, setFilter] = useState<EvidenceState | "all">("all");
  const [form, setForm] = useState({ campaignId: data.campaigns[0]?.id ?? 1, vendor: "", category: "", amount: "" });
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, [filter]);
  const list = data.evidence.filter((e) => filter === "all" || e.state === filter);
  const cats = data.campaigns.find((c) => c.id === Number(form.campaignId))?.categories ?? [];

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    if (!form.vendor.trim() || !form.category || !(Number(form.amount) > 0)) return setMsg("Fill in vendor, category and a positive amount.");
    const ok = await submitEvidence({ campaignId: Number(form.campaignId), vendor: form.vendor.trim(), category: form.category, amount: Number(form.amount) });
    if (!ok) return setMsg("");
    setForm({ ...form, vendor: "", amount: "" });
    setMsg("Receipt submitted. A commitment and nullifier were recorded; verifiers will now review it.");
  };

  return (
    <div ref={ref}>
      <SectionTitle eyebrow="Evidence verification" title="Receipts and verifier quorum">
        <div className="flex flex-wrap gap-1 rounded-full bg-cloud-200 p-1" role="group" aria-label="Filter by status">
          {(["all", "pending", "attested", "challenged", "rejected"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${filter === f ? "bg-cloud-50 text-potion shadow-sm" : "text-ink-70"}`}>
              {f === "attested" ? "verified" : f}
            </button>
          ))}
        </div>
      </SectionTitle>

      {role === "vendor" && (
        <Card className="mb-6">
          <h2 className="mb-1 font-serif text-xl">Submit a signed receipt</h2>
          <p className="mb-4 text-sm text-ink-50">Each receipt gets a unique nullifier, so it can never be reused in another campaign.</p>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-5 md:items-end">
            <Field label="Campaign">
              <select className={inputCls} value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: Number(e.target.value), category: "" })}>
                {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Vendor name">
              <input className={inputCls} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Godavari Pumps" />
            </Field>
            <Field label="Category">
              <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Choose…</option>
                {cats.map((c) => <option key={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Amount (mUSD)">
              <input className={inputCls} type="number" min="0" step="0.1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Button type="submit" disabled={busy}>Submit receipt</Button>
          </form>
          {msg && <p role="status" className="mt-3 text-sm text-ink-70">{msg}</p>}
        </Card>
      )}

      {list.length === 0 ? (
        <Empty>No receipts match this filter.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((e) => {
            const c = data.campaigns.find((x) => x.id === e.campaignId);
            const dup = data.evidence.some((o) => o.id !== e.id && o.nullifier === e.nullifier);
            return (
              <Card key={e.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-ink-50">{e.id} · {c?.name}</p>
                    <h2 className="font-medium">{e.vendor}</h2>
                    <p className="text-sm text-ink-70">{e.category} · <span className="tabular">{fmt(e.amount)} mUSD</span></p>
                  </div>
                  <Badge tone={tone[e.state]}>{text[e.state]}</Badge>
                </div>
                {dup && <p className="mt-3 rounded-lg bg-potion-50 px-3 py-2 text-xs text-potion-600">Same nullifier appears on another receipt — possible reuse.</p>}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <Meter label={`Verifier approvals ${e.approvals}/${e.quorum}`} value={e.approvals} max={e.quorum} />
                  <Meter label="Forgery likelihood" value={e.forgeryLikelihood} invert />
                </div>
                <dl className="mt-4 space-y-1 text-xs text-ink-70">
                  <div className="flex gap-2"><dt className="text-ink-50">Commitment</dt><dd className="font-mono" title={e.commitment}>{short(e.commitment)}</dd></div>
                  <div className="flex gap-2"><dt className="text-ink-50">Nullifier</dt><dd className="font-mono" title={e.nullifier}>{short(e.nullifier)}</dd></div>
                  <div className="flex gap-2"><dt className="text-ink-50">Submitted</dt><dd>{date(e.submittedAt)}</dd></div>
                </dl>
                {role === "verifier" && hasVoted(`ev:${e.id}`) && <p className="mt-4 border-t border-cloud-300/70 pt-4 text-xs text-ink-50">You have voted on this receipt. Other verifiers must complete the quorum.</p>}
                {role === "verifier" && !hasVoted(`ev:${e.id}`) && (e.state === "pending" || e.state === "challenged") && (
                  <div className="mt-4 flex gap-2 border-t border-cloud-300/70 pt-4">
                    <Button disabled={busy} onClick={() => verifierVote(e.id, "approve")}>Attest</Button>
                    <Button variant="danger" disabled={busy} onClick={() => verifierVote(e.id, "challenge")}>Challenge</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
