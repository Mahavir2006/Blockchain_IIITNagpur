import type { TFunction } from "i18next";
import type { LedgerData } from "../lib/types";

/** Spoken summary of the page at `path`, built from the same data the page shows. */
export function summarize(path: string, data: LedgerData, t: TFunction, fmt: (n: number) => string): string {
  const campaignMatch = path.match(/^\/campaigns\/(\d+)/);
  if (campaignMatch) {
    const c = data.campaigns.find((x) => x.id === Number(campaignMatch[1]));
    if (!c) return t("campaign.notFound");
    const status = c.frozen ? t("voice.summary.campaignFrozen", { reason: t(`freezeReasons.${c.freezeReason}`) }) : t("voice.summary.campaignActive");
    return t("voice.summary.campaign", { name: c.name, raised: fmt(c.raised), goal: fmt(c.goal), released: fmt(c.released), locked: fmt(c.locked), status });
  }
  switch (path) {
    case "/": {
      const c = data.campaigns;
      return t("voice.summary.overview", {
        count: fmt(c.length),
        raised: fmt(c.reduce((s, x) => s + x.raised, 0)),
        released: fmt(c.reduce((s, x) => s + x.released, 0)),
        frozen: fmt(c.filter((x) => x.frozen).length),
        verified: fmt(data.evidence.filter((e) => e.state === "attested").length),
        receipts: fmt(data.evidence.length),
      });
    }
    case "/alerts":
      return t("voice.summary.alerts", { count: fmt(data.alerts.length), serious: fmt(data.alerts.filter((a) => a.severity === "critical" || a.severity === "high").length) });
    case "/evidence": {
      const by = (s: string) => fmt(data.evidence.filter((e) => e.state === s).length);
      return t("voice.summary.evidence", { count: fmt(data.evidence.length), verified: by("attested"), pending: by("pending"), rejected: by("rejected") });
    }
    case "/transactions":
      return t("voice.summary.transactions", { count: fmt(data.transactions.length) });
    case "/trace": {
      const tr = data.traces[0];
      return tr ? t("voice.summary.trace", { id: tr.donationId, amount: fmt(tr.amount), pct: fmt(Math.round(tr.composite * 100)) }) : t("trace.none");
    }
    case "/verify-delivery":
      return t("voice.summary.delivery");
    default:
      return t("voice.summary.none");
  }
}
