import { useMemo, useRef, useState, type FormEvent } from "react";
import { isHexString, keccak256, toUtf8Bytes } from "ethers";
import { useTranslation } from "react-i18next";
import { Button, Card, Field, SectionTitle, inputCls } from "../components/ui";
import { buildTree, verifyProof as verify } from "../lib/merkle";
import { useReveal } from "../lib/motion";

/** Builds a small sample tree so users can try the checker without real data. */
function sample() {
  const leaves = ["alice-secret|kit-001", "bina-secret|kit-002", "chetan-secret|kit-003", "devi-secret|kit-004"].map((s) => keccak256(toUtf8Bytes(s)));
  const tree = buildTree(leaves);
  return { root: tree.root, leaf: leaves[0], proof: tree.proof(0).join("\n") };
}

const isB32 = (s: string) => isHexString(s, 32);

export default function ProofChecker() {
  const { t } = useTranslation();
  const demo = useMemo(sample, []);
  const [root, setRoot] = useState("");
  const [leaf, setLeaf] = useState("");
  const [proof, setProof] = useState("");
  const [result, setResult] = useState<null | { ok: boolean; key: string }>(null);
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  const onCheck = (e: FormEvent) => {
    e.preventDefault();
    const items = proof.split(/[\s,]+/).filter(Boolean);
    if (!isB32(root) || !isB32(leaf) || !items.every(isB32)) {
      return setResult({ ok: false, key: "proof.invalid" });
    }
    const ok = verify(root, leaf, items);
    setResult({ ok, key: ok ? "proof.ok" : "proof.notIncluded" });
  };

  return (
    <div ref={ref}>
      <SectionTitle eyebrow={t("proof.eyebrow")} title={t("proof.title")} />
      <p className="mb-6 max-w-2xl text-sm text-ink-70" data-reveal>{t("proof.lead")}</p>
      <Card className="max-w-3xl">
        <form onSubmit={onCheck} className="space-y-4">
          <Field label={t("proof.root")}>
            <input className={`${inputCls} font-mono`} value={root} onChange={(e) => setRoot(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <Field label={t("proof.leaf")}>
            <input className={`${inputCls} font-mono`} value={leaf} onChange={(e) => setLeaf(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <Field label={t("proof.proof")}>
            <textarea className={`${inputCls} h-28 font-mono`} value={proof} onChange={(e) => setProof(e.target.value)} placeholder="0x…" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{t("proof.verify")}</Button>
            <Button type="button" variant="ghost" onClick={() => { setRoot(demo.root); setLeaf(demo.leaf); setProof(demo.proof); setResult(null); }}>
              {t("proof.sample")}
            </Button>
          </div>
        </form>
        {result && (
          <p role="status" className={`mt-4 rounded-xl px-4 py-3 text-sm ${result.ok ? "bg-ok-100 text-ok" : "bg-potion-50 text-potion-600"}`}>
            {t(result.key)}
          </p>
        )}
      </Card>
    </div>
  );
}
