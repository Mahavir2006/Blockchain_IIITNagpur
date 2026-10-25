import { useMemo, useRef, useState, type FormEvent } from "react";
import { isHexString, keccak256, toUtf8Bytes } from "ethers";
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
  const demo = useMemo(sample, []);
  const [root, setRoot] = useState("");
  const [leaf, setLeaf] = useState("");
  const [proof, setProof] = useState("");
  const [result, setResult] = useState<null | { ok: boolean; text: string }>(null);
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);

  const onCheck = (e: FormEvent) => {
    e.preventDefault();
    const items = proof.split(/[\s,]+/).filter(Boolean);
    if (!isB32(root) || !isB32(leaf) || !items.every(isB32)) {
      return setResult({ ok: false, text: "Each value must be a 32-byte hex string starting with 0x (66 characters)." });
    }
    const ok = verify(root, leaf, items);
    setResult({ ok, text: ok ? "Delivery confirmed. This leaf is included in the published delivery root." : "Not included. This leaf and proof do not lead to the published root." });
  };

  return (
    <div ref={ref}>
      <SectionTitle eyebrow="Beneficiary privacy" title="Check a delivery" />
      <p className="mb-6 max-w-2xl text-sm text-ink-70" data-reveal>
        NGOs publish only a Merkle root of delivery commitments. A beneficiary (or anyone they share their receipt with) can prove inclusion here — no names or personal data go on-chain.
        This is commitment-based selective disclosure, not zero-knowledge. The check runs entirely in your browser.
      </p>
      <Card className="max-w-3xl">
        <form onSubmit={onCheck} className="space-y-4">
          <Field label="Published delivery root">
            <input className={`${inputCls} font-mono`} value={root} onChange={(e) => setRoot(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <Field label="Your delivery leaf">
            <input className={`${inputCls} font-mono`} value={leaf} onChange={(e) => setLeaf(e.target.value.trim())} placeholder="0x…" />
          </Field>
          <Field label="Proof (one hash per line)">
            <textarea className={`${inputCls} h-28 font-mono`} value={proof} onChange={(e) => setProof(e.target.value)} placeholder="0x…" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Verify inclusion</Button>
            <Button type="button" variant="ghost" onClick={() => { setRoot(demo.root); setLeaf(demo.leaf); setProof(demo.proof); setResult(null); }}>
              Load sample (demo)
            </Button>
          </div>
        </form>
        {result && (
          <p role="status" className={`mt-4 rounded-xl px-4 py-3 text-sm ${result.ok ? "bg-ok-100 text-ok" : "bg-potion-50 text-potion-600"}`}>
            {result.text}
          </p>
        )}
      </Card>
    </div>
  );
}
