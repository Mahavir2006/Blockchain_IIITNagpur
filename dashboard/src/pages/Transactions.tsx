import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Card, Empty, SectionTitle, inputCls } from "../components/ui";
import { useReveal } from "../lib/motion";
import { date, fmt, short, useLedger } from "../lib/store";
import type { Tx } from "../lib/types";

const kindTone: Record<Tx["kind"], "ok" | "warn" | "danger" | "neutral"> = {
  donation: "ok", release: "ok", swap: "neutral", bridge: "neutral", offramp: "neutral", attestation: "neutral", freeze: "danger", refund: "warn",
};

export default function Transactions() {
  const { t } = useTranslation();
  const { data } = useLedger();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Tx["kind"] | "all">("all");
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  const needle = q.trim().toLowerCase();
  const list = data.transactions
    .filter((tx) => (kind === "all" || tx.kind === kind) && (!needle || [tx.hash, tx.from, tx.to].some((s) => s.toLowerCase().includes(needle))))
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div ref={ref}>
      <SectionTitle eyebrow={t("tx.eyebrow")} title={t("tx.title")}>
        <div className="flex flex-wrap gap-2">
          <label><span className="sr-only">{t("tx.search")}</span>
            <input className={inputCls} placeholder={t("tx.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label><span className="sr-only">{t("tx.type")}</span>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Tx["kind"] | "all")}>
              <option value="all">{t("tx.allTypes")}</option>
              {Object.keys(kindTone).map((k) => <option key={k} value={k}>{t("txKind." + k)}</option>)}
            </select>
          </label>
        </div>
      </SectionTitle>
      {list.length === 0 ? <Empty>{t("tx.none")}</Empty> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-cloud-300 text-xs uppercase tracking-wider text-ink-50">
              <tr>
                <th className="px-5 py-3 font-medium">{t("tx.colType")}</th>
                <th className="px-5 py-3 font-medium">{t("tx.colCampaign")}</th>
                <th className="px-5 py-3 font-medium">{t("tx.colFromTo")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("tx.colAmount")}</th>
                <th className="px-5 py-3 font-medium">{t("tx.colChain")}</th>
                <th className="px-5 py-3 font-medium">{t("tx.colWhen")}</th>
                <th className="px-5 py-3 font-medium">{t("tx.colHash")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tx) => (
                <tr key={tx.hash} className="border-b border-cloud-300/60 last:border-0 hover:bg-cloud-200/50">
                  <td className="px-5 py-3"><Badge tone={kindTone[tx.kind]}>{t("txKind." + tx.kind)}</Badge></td>
                  <td className="px-5 py-3 text-ink-70">#{tx.campaignId}</td>
                  <td className="px-5 py-3 text-ink-70">{tx.from} → {tx.to}</td>
                  <td className="tabular px-5 py-3 text-right">{tx.amount ? fmt(tx.amount) : "—"}</td>
                  <td className="px-5 py-3 text-ink-70">{tx.chainId}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-ink-70">{date(tx.at)}</td>
                  <td className="px-5 py-3 font-mono text-xs" title={tx.hash}>{short(tx.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
