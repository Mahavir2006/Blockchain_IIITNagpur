/**
 * Ledger API for the dashboard. Reads campaigns, evidence, freezes and events straight from the
 * chain and sends transactions for dashboard actions from the local node's unlocked role accounts.
 *
 *   npx hardhat run services/api/server.ts --network localhost      (after scripts/deploy-local.ts)
 *
 * Endpoints (JSON, CORS open for the local dashboard):
 *   GET  /health /campaigns /traces /evidence /alerts /transactions
 *   POST /donations                         {campaignId, amount}             donor account
 *   POST /evidence                          {campaignId, vendor, category, amount}  NGO files, vendor signs
 *   POST /evidence/:id/approve|challenge                                       next verifier who hasn't voted
 *   POST /campaigns/:id/unfreeze-vote                                          next verifier who hasn't voted
 *   POST /campaigns/:id/tranches/:index/release   (index is 1-based)            the campaign's NGO
 *
 * Local demo only: the API signs with Hardhat's test accounts. A real deployment would have each
 * participant sign in their own wallet.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";

const PORT = Number(process.env.API_PORT || 4000);
const fmt = (v: bigint) => Number(ethers.formatEther(v));

type Deployment = {
  chainId: number;
  startBlock: number;
  accounts: Record<string, number>;
  contracts: Record<string, string>;
  campaigns: Record<string, { name: string; org: string; region: string }>;
  names: Record<string, string>;
  hops: { campaignId: number; messageId: string; swapTx: string; lockTx: string; mintTx: string; fiatTx: string }[];
};

const FREEZE_REASON_TEXT: Record<number, string> = {
  1: "DUPLICATE_NULLIFIER",
  2: "FORGED_RATIO",
  3: "CATEGORY_BREACH",
  4: "QUORUM_CHALLENGE",
};
// AttestationVerifier states -> dashboard evidence states
const EVIDENCE_STATE = ["pending", "pending", "attested", "challenged", "rejected"] as const;

async function main() {
  const file = path.join(__dirname, "..", "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment found at ${file}. Run: npm run deploy:local`);
  const dep: Deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  if ((await ethers.provider.getCode(dep.contracts.CampaignEscrow)) === "0x") {
    throw new Error("The deployed contracts are not on this chain (was the node restarted?). Run: npm run deploy:local");
  }

  const at = (name: string, key = name) => ethers.getContractAt(name, dep.contracts[key]) as Promise<any>;
  const escrow = await at("CampaignEscrow");
  const freeze = await at("FreezeController");
  const impact = await at("ImpactVerifier");
  const evidence = await at("EvidenceRegistry");
  const attest = await at("AttestationVerifier");
  const swap = await at("MockSwap");
  const bridge = await at("BridgeGateway");
  const fiat = await at("FiatOffRampAttestor");
  const signers = await ethers.getSigners();
  const role = (k: string) => signers[dep.accounts[k]];
  const verifiers = ["v1", "v2", "v3"].map(role);
  const chainId = dep.chainId;

  const name = (addr: string) => dep.names[ethers.getAddress(addr)] ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const label = (addr: string) => {
    const known: Record<string, string> = {
      [dep.contracts.CampaignEscrow.toLowerCase()]: "CampaignEscrow",
      [dep.contracts.MockSwap.toLowerCase()]: "MockSwap",
      [dep.contracts.BridgeGateway.toLowerCase()]: "BridgeGateway",
      [dep.contracts.FiatOffRampAttestor.toLowerCase()]: "FiatOffRampAttestor",
    };
    return known[addr.toLowerCase()] ?? name(addr);
  };

  // ---------- chain reading helpers
  const blockTimes = new Map<number, string>();
  const time = async (blockNumber: number) => {
    if (!blockTimes.has(blockNumber)) {
      const b = await ethers.provider.getBlock(blockNumber);
      blockTimes.set(blockNumber, new Date(Number(b!.timestamp) * 1000).toISOString());
    }
    return blockTimes.get(blockNumber)!;
  };
  const events = (contract: any, eventName: string) => contract.queryFilter(contract.filters[eventName](), dep.startBlock) as Promise<any[]>;

  async function readEvidence() {
    const submitted = await events(evidence, "EvidenceSubmitted");
    const required = Number(await attest.requiredAttestations());
    return Promise.all(
      submitted.map(async (ev, i) => {
        const id = BigInt(i + 1); // ids are sequential from 1 within this deployment
        const e = await evidence.getEvidence(id);
        const state = Number(await attest.getEvidenceState(id));
        const vendor = await evidence.getEvidenceVendor(id);
        return {
          id: String(id),
          campaignId: Number(e.campaignId),
          vendor: name(vendor),
          vendorAddress: vendor,
          category: ethers.decodeBytes32String(e.category),
          amount: fmt(e.amount),
          commitment: e.commitment,
          nullifier: e.nullifier,
          state: EVIDENCE_STATE[state],
          rawState: state,
          approvals: Number(await attest.getAttestationCount(id)),
          challenges: Number(await attest.getChallengeCount(id)),
          quorum: required,
          // Heuristic, not a proof: rises with challenges and a missing vendor signature.
          forgeryLikelihood: [0.35, 0.1, 0.05, 0.7, 0.95][state],
          submittedAt: await time(ev.blockNumber),
          txHash: ev.transactionHash,
        };
      }),
    );
  }

  async function readCampaigns(allEvidence: Awaited<ReturnType<typeof readEvidence>>) {
    const created = await events(escrow, "CampaignCreated");
    const released = await events(escrow, "TrancheReleased");
    const requiredUnfreeze = Number(await freeze.getRequiredUnfreezeVotes());
    return Promise.all(
      created.map(async (ev) => {
        const id = Number(ev.args.campaignId);
        // Tranche amounts are not exposed by a getter; read them from the creation transaction.
        const tx = await ethers.provider.getTransaction(ev.transactionHash);
        const tranches: bigint[] = escrow.interface.parseTransaction({ data: tx!.data, value: tx!.value })!.args.trancheAmounts;
        const c = await escrow.getCampaign(id);
        const raw = await escrow.campaigns(id);
        const verified = await attest.verifiedAmount(id);
        const root = await impact.getDeliveryRoot(id);
        const frozen = await freeze.isFrozen(id);
        const meta = dep.campaigns[String(id)] ?? { name: `Campaign #${id}`, org: name(c.ngo), region: "" };
        const ev4 = allEvidence.filter((e) => e.campaignId === id);
        const rejected = ev4.filter((e) => e.state === "rejected").length;
        const challenged = ev4.filter((e) => e.state === "challenged").length;
        const next = Number(c.nextTrancheIndex);
        let cumulative = c.totalReleased;
        const trancheView = await Promise.all(
          tranches.map(async (amount, i) => {
            const rel = released.find((r) => Number(r.args.campaignId) === id && Number(r.args.trancheIndex) === i);
            if (i < next) return { index: i + 1, amount: fmt(amount), status: "released", impactScore: 1, requiredScore: 1, releasedAt: rel ? await time(rel.blockNumber) : undefined };
            // Readiness = share of (released so far + this tranche) covered by quorum-verified evidence,
            // 0 until a delivery root exists. 1.00 is exactly the escrow's on-chain release condition.
            const need = cumulative + amount;
            cumulative = need;
            const coverage = root === ethers.ZeroHash ? 0 : Math.min(1, fmt(verified) / fmt(need));
            const status = i === next ? (frozen ? "blocked" : "pending") : "locked";
            return { index: i + 1, amount: fmt(amount), status, impactScore: Math.round(coverage * 100) / 100, requiredScore: 1 };
          }),
        );
        // Risk score 0–100: transparent heuristic, listed in the README.
        const riskScore = Math.min(100, Math.round(10 + (frozen ? 45 : 0) + (ev4.length ? (rejected / ev4.length) * 35 : 0) + challenged * 10 + (root === ethers.ZeroHash ? 10 : 0)));
        return {
          id,
          name: meta.name,
          ngo: meta.org,
          ngoAddress: c.ngo,
          region: meta.region,
          goal: fmt(c.target),
          raised: fmt(c.totalDeposited),
          released: fmt(c.totalReleased),
          locked: fmt(raw.balance),
          verified: fmt(verified),
          deliveryRoot: root,
          frozen,
          freezeReason: Number(await freeze.getFreezeReason(id)),
          unfreezeVotes: Number(await freeze.getUnfreezeVotes(id)),
          requiredUnfreezeVotes: requiredUnfreeze,
          riskScore,
          categories: [{ name: ethers.decodeBytes32String(c.category), cap: fmt(raw.categoryCap), spent: fmt(verified) }],
          tranches: trancheView,
        };
      }),
    );
  }

  async function readTransactions() {
    const rows: any[] = [];
    const push = async (ev: any, kind: string, campaignId: number, from: string, to: string, amount: bigint) =>
      rows.push({ hash: ev.transactionHash, campaignId, kind, from, to, amount: fmt(amount), chainId, at: await time(ev.blockNumber) });
    const hopCampaign = (hash: string) => dep.hops.find((h) => [h.swapTx, h.lockTx, h.mintTx, h.fiatTx].includes(hash))?.campaignId ?? 0;

    for (const ev of await events(escrow, "DepositReceived")) await push(ev, "donation", Number(ev.args.campaignId), name(ev.args.donor), "CampaignEscrow", ev.args.amount);
    for (const ev of await events(escrow, "TrancheReleased")) {
      const c = await escrow.getCampaign(ev.args.campaignId);
      await push(ev, "release", Number(ev.args.campaignId), "CampaignEscrow", name(c.ngo), ev.args.amount);
    }
    for (const ev of await events(escrow, "Refunded")) await push(ev, "refund", Number(ev.args.campaignId), "CampaignEscrow", name(ev.args.donor), ev.args.amount);
    for (const ev of await events(freeze, "CampaignFrozen")) await push(ev, "freeze", Number(ev.args.campaignId), "Verifier quorum", "FreezeController", 0n);
    for (const ev of await events(attest, "QuorumVerified")) {
      const e = await evidence.getEvidence(ev.args.evidenceId);
      await push(ev, "attestation", Number(e.campaignId), "Verifier quorum", "AttestationVerifier", 0n);
    }
    for (const ev of await events(swap, "SwapExecuted")) await push(ev, "swap", hopCampaign(ev.transactionHash), name(ev.args.user), "MockSwap", ev.args.amountIn);
    for (const ev of await events(bridge, "AssetLocked")) await push(ev, "bridge", hopCampaign(ev.transactionHash), name(ev.args.user), "BridgeGateway", ev.args.amount);
    for (const ev of await events(bridge, "AssetMinted")) await push(ev, "bridge", hopCampaign(ev.transactionHash), "BridgeGateway", name(ev.args.recipient), ev.args.amount);
    for (const ev of await events(fiat, "FiatSettlementAttested")) await push(ev, "offramp", hopCampaign(ev.transactionHash), name(ev.args.partner), "Fiat vendor", ev.args.amount);
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.hash) ? false : (seen.add(r.hash), true))).sort((a, b) => b.at.localeCompare(a.at));
  }

  async function readAlerts(campaigns: any[], allEvidence: any[]) {
    const alerts: any[] = [];
    for (const ev of await events(freeze, "CampaignFrozen")) {
      const id = Number(ev.args.campaignId);
      const reason = Number(ev.args.reason);
      alerts.push({
        id: `frz-${ev.transactionHash}`,
        campaignId: id,
        rule: reason === 1 ? "duplicate-evidence" : reason === 2 ? "forgery-ratio" : reason === 3 ? "category-breach" : "quorum-challenge",
        severity: "critical",
        title: "Campaign frozen by verifier quorum",
        detail: `Disbursements halted. Reason code ${reason} (${FREEZE_REASON_TEXT[reason]}).`,
        onChainReason: `CampaignFrozen(campaignId=${id}, reason=${reason} ${FREEZE_REASON_TEXT[reason]})`,
        at: await time(ev.blockNumber),
      });
    }
    for (const ev of await events(attest, "ChallengeResolved")) {
      const e = allEvidence.find((x) => x.id === String(ev.args.evidenceId));
      if (!e) continue;
      alerts.push({
        id: `res-${ev.transactionHash}`,
        campaignId: e.campaignId,
        rule: "forgery-ratio",
        severity: ev.args.upheld ? "high" : "low",
        title: ev.args.upheld ? `Receipt ${e.id} rejected as forged` : `Challenge on receipt ${e.id} dismissed`,
        detail: `${e.vendor} · ${e.amount} mUSD. ${ev.args.upheld ? "The challenge was upheld; the receipt no longer counts as evidence." : "The receipt was restored."}`,
        onChainReason: `ChallengeResolved(evidenceId=${e.id}, upheld=${ev.args.upheld})`,
        at: await time(ev.blockNumber),
      });
    }
    for (const e of allEvidence.filter((x) => x.state === "challenged")) {
      alerts.push({ id: `chl-${e.id}`, campaignId: e.campaignId, rule: "forgery-ratio", severity: "high", title: `Receipt ${e.id} is under challenge`, detail: `${e.vendor} · ${e.amount} mUSD is withheld from verified spend until the challenge is resolved.`, at: e.submittedAt });
    }
    for (const c of campaigns) {
      const own = allEvidence.filter((e) => e.campaignId === c.id && e.state !== "rejected");
      const total = own.reduce((s, e) => s + e.amount, 0);
      const byVendor = new Map<string, number>();
      own.forEach((e) => byVendor.set(e.vendor, (byVendor.get(e.vendor) ?? 0) + e.amount));
      for (const [vendor, amt] of byVendor) {
        if (own.length >= 2 && total > 0 && amt / total >= 0.9) {
          alerts.push({ id: `conc-${c.id}`, campaignId: c.id, rule: "vendor-concentration", severity: "medium", title: "Vendor concentration unusually high", detail: `${Math.round((amt / total) * 100)}% of receipted spend went to ${vendor}. Not proof of fraud; flagged for verifier review.`, at: own[own.length - 1].submittedAt });
        }
      }
      const pending = own.filter((e) => e.state === "pending").length;
      if (pending) alerts.push({ id: `pend-${c.id}`, campaignId: c.id, rule: "report-mismatch", severity: "low", title: `${pending} receipt(s) awaiting verifier quorum`, detail: "Spend reported by the NGO is not yet verified and cannot back a tranche release.", at: own[own.length - 1].submittedAt });
    }
    return alerts.sort((a, b) => b.at.localeCompare(a.at));
  }

  async function readTraces(campaigns: any[], allEvidence: any[]) {
    const deposits = await events(escrow, "DepositReceived");
    return Promise.all(
      deposits.map(async (ev, i) => {
        const id = Number(ev.args.campaignId);
        const c = campaigns.find((x) => x.id === id)!;
        const own = allEvidence.filter((e) => e.campaignId === id);
        const verified = own.filter((e) => e.state === "attested");
        const rejected = own.filter((e) => e.state === "rejected");
        const hop = dep.hops.find((h) => h.campaignId === id);
        const stages: any[] = [];
        const at = await time(ev.blockNumber);
        stages.push({ key: "donation", label: "Inbound donation", plain: `${fmt(ev.args.amount)} mUSD arrived and was earmarked for ${c.categories[0].name.toLowerCase()}.`, chainId, txHash: ev.transactionHash, amount: fmt(ev.args.amount), asset: "mUSD", at, status: "verified", confidence: 1, factors: ["Deposit event confirmed on-chain", "Within campaign target"] });
        // S2: active & not frozen (0.6) + tranches defined (0.2) + release rule enforced on-chain (0.2)
        stages.push({ key: "escrow", label: "Escrow condition", plain: c.frozen ? "Escrow is frozen — no further money can leave until a verifier quorum lifts the freeze." : "Funds are held in escrow and only release against verified evidence.", chainId, txHash: ev.transactionHash, amount: fmt(ev.args.amount), asset: "mUSD", at, status: c.frozen ? "failed" : "verified", confidence: c.frozen ? 0.4 : 1, factors: [c.frozen ? `Campaign frozen (reason ${c.freezeReason})` : "Campaign active, not frozen", `${c.tranches.length} tranches defined`, "Release requires quorum-verified evidence"] });
        if (hop) {
          const swapRc = await ethers.provider.getTransactionReceipt(hop.swapTx);
          const fiatRc = await ethers.provider.getTransactionReceipt(hop.fiatTx);
          stages.push({ key: "swap", label: "Swap", plain: "Released funds were converted to the settlement token at the published rate.", chainId, txHash: hop.swapTx, amount: c.released, asset: "mUSD→wUSD", at: await time(swapRc!.blockNumber), status: "verified", confidence: 1, factors: ["SwapExecuted event on-chain"] });
          stages.push({ key: "bridge", label: "Bridge to chain B", plain: "Moved to the partner chain (simulated on this node) where the vendor is paid.", chainId: 31338, txHash: hop.mintTx, amount: c.released, asset: "wUSD", at: await time((await ethers.provider.getTransactionReceipt(hop.mintTx))!.blockNumber), status: "verified", confidence: 1, factors: ["Lock matched by relayer mint", `Message ${hop.messageId.slice(0, 10)}…`] });
          stages.push({ key: "offramp", label: "Fiat off-ramp", plain: "A registered off-ramp partner signed the fiat settlement.", chainId, txHash: hop.fiatTx, amount: c.released, asset: "INR (fiat)", at: await time(fiatRc!.blockNumber), status: "verified", confidence: 1, factors: ["Partner EIP-191 signature valid", "One attestation per hop"] });
        }
        // S3: commitment submitted (0.3) + nullifier unique (0.3) + vendor signature (0.2) + quorum (0.2)
        const s3 = own.length === 0 ? 0 : 0.6 + (verified.length ? 0.4 : own.some((e) => e.rawState >= 1) ? 0.2 : 0) - (rejected.length ? 0.3 : 0);
        stages.push({ key: "invoice", label: "Off-chain invoice proof", plain: own.length ? `${own.length} receipt(s) filed; ${verified.length} reached the verifier quorum${rejected.length ? `, ${rejected.length} rejected as forged` : ""}.` : "No receipts filed yet.", chainId, txHash: own[0]?.txHash ?? ev.transactionHash, amount: verified.reduce((s, e) => s + e.amount, 0), asset: "mUSD", at: own[0]?.submittedAt ?? at, status: rejected.length ? "failed" : verified.length ? "verified" : "pending", confidence: Math.max(0, Math.round(s3 * 100) / 100), factors: [`${own.length} commitment(s) on-chain`, "Nullifiers derived on-chain and unique", `${verified.length} quorum-verified`, ...(rejected.length ? [`${rejected.length} rejected`] : [])] });
        // S4: delivery root published (0.5) + leaf inclusion verifiable (0.3) + tranche coverage > 0.5 (0.2)
        const hasRoot = c.deliveryRoot !== ethers.ZeroHash;
        const coverage = c.tranches.find((t: any) => t.status !== "released")?.impactScore ?? 1;
        const s4 = (hasRoot ? 0.8 : 0) + (coverage > 0.5 ? 0.2 : 0);
        stages.push({ key: "impact", label: "Cryptographic impact verification", plain: hasRoot ? "A delivery Merkle root is published — beneficiaries can prove inclusion without revealing who they are." : "No delivery root published yet.", chainId, txHash: ev.transactionHash, amount: c.released, asset: "—", at, status: hasRoot ? "verified" : "pending", confidence: s4, factors: [hasRoot ? `Root ${c.deliveryRoot.slice(0, 10)}…` : "No root", "Domain-separated Merkle proofs", "Commitment-based selective disclosure (not ZK)"] });
        const composite = Math.round((stages.filter((s) => ["donation", "escrow", "invoice", "impact"].includes(s.key)).reduce((s, x) => s + x.confidence, 0) / 4) * 100) / 100;
        return { donationId: `DON-${String(i + 1).padStart(4, "0")}`, campaignId: id, donor: name(ev.args.donor), amount: fmt(ev.args.amount), composite, stages };
      }),
    );
  }

  async function snapshot() {
    const ev = await readEvidence();
    const campaigns = await readCampaigns(ev);
    return { ev, campaigns };
  }

  // ---------- actions
  const nextVerifier = async (check: (v: any) => Promise<boolean>) => {
    for (const v of verifiers) if (await check(v)) return v;
    throw new Error("Every verifier account has already voted on this");
  };

  async function vendorAttest(vendor: any, id: bigint, amount: bigint, commitment: string) {
    const domain = { name: "BlackHoleLedger", version: "1", chainId, verifyingContract: await attest.getAddress() };
    const types = { VendorAttestation: [{ name: "evidenceId", type: "uint256" }, { name: "vendor", type: "address" }, { name: "amount", type: "uint256" }, { name: "commitment", type: "bytes32" }, { name: "nonce", type: "uint256" }] };
    const sig = ethers.Signature.from(await vendor.signTypedData(domain, types, { evidenceId: id, vendor: vendor.address, amount, commitment, nonce: 0 }));
    await (await attest.connect(vendor).vendorAttest(id, amount, commitment, sig.v, sig.r, sig.s, 0)).wait();
  }

  async function act(method: string, url: string, body: any): Promise<unknown> {
    let m: RegExpMatchArray | null;
    if (method === "POST" && url === "/donations") {
      const amount = ethers.parseEther(String(body.amount));
      await (await escrow.connect(role("donor")).deposit(body.campaignId, amount)).wait();
      return { ok: true };
    }
    if (method === "POST" && url === "/evidence") {
      const c = await escrow.getCampaign(body.campaignId);
      const ngo = signers.find((s) => s.address === c.ngo);
      if (!ngo) throw new Error("This campaign's NGO is not an account on this node");
      // Use the vendor account whose name matches, else the first vendor account.
      const vendors = ["vendorA", "vendorB", "vendorC"].map(role);
      const vendor = vendors.find((v) => name(v.address).toLowerCase() === String(body.vendor).trim().toLowerCase()) ?? vendors[0];
      const amount = ethers.parseEther(String(body.amount));
      const invoiceHash = ethers.keccak256(ethers.toUtf8Bytes(`${body.vendor}|${body.amount}|${Date.now()}`));
      const date = BigInt(Math.floor(Date.now() / 1000));
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const category = ethers.encodeBytes32String(String(body.category).slice(0, 31));
      const commitment = ethers.solidityPackedKeccak256(["bytes32", "bytes32", "address", "uint256", "bytes32", "uint256"], [salt, invoiceHash, vendor.address, amount, category, date]);
      const nullifier = ethers.solidityPackedKeccak256(["bytes32", "address", "uint256", "uint256"], [invoiceHash, vendor.address, amount, date]);
      const id = await evidence.nextEvidenceId();
      await (await evidence.connect(ngo).submitEvidence(body.campaignId, commitment, nullifier, invoiceHash, vendor.address, amount, category, date, salt)).wait();
      await vendorAttest(vendor, id, amount, commitment);
      return { ok: true, evidenceId: String(id) };
    }
    if (method === "POST" && (m = url.match(/^\/evidence\/(\d+)\/(approve|challenge)$/))) {
      const id = BigInt(m[1]);
      if (m[2] === "approve") {
        const v = await nextVerifier(async (x) => !(await attest.hasVerifierAttested(id, x.address)));
        await (await attest.connect(v).verifierAttest(id)).wait();
      } else {
        const v = await nextVerifier(async (x) => !(await attest.hasVerifierChallenged(id, x.address)));
        await (await attest.connect(v).verifierChallenge(id)).wait();
      }
      return { ok: true };
    }
    if (method === "POST" && (m = url.match(/^\/campaigns\/(\d+)\/unfreeze-vote$/))) {
      const id = BigInt(m[1]);
      const epoch = await freeze.freezeEpoch(id);
      const v = await nextVerifier(async (x) => !(await freeze.unfreezeVoted(id, epoch, x.address)));
      await (await freeze.connect(v).voteUnfreeze(id)).wait();
      return { ok: true };
    }
    if (method === "POST" && (m = url.match(/^\/campaigns\/(\d+)\/tranches\/(\d+)\/release$/))) {
      const id = BigInt(m[1]);
      const c = await escrow.getCampaign(id);
      const ngo = signers.find((s) => s.address === c.ngo);
      if (!ngo) throw new Error("This campaign's NGO is not an account on this node");
      await (await escrow.connect(ngo).requestTrancheRelease(id, Number(m[2]) - 1)).wait();
      return { ok: true };
    }
    if (method === "GET") {
      if (url === "/health") return { ok: true, chainId, block: await ethers.provider.getBlockNumber(), escrow: dep.contracts.CampaignEscrow };
      if (url === "/evidence") return (await readEvidence()).map(({ rawState, txHash, vendorAddress, ...rest }) => rest);
      if (url === "/transactions") return readTransactions();
      const { ev, campaigns } = await snapshot();
      if (url === "/campaigns") return campaigns;
      if (url === "/alerts") return readAlerts(campaigns, ev);
      if (url === "/traces") return readTraces(campaigns, ev);
    }
    const err: any = new Error(`No route ${method} ${url}`);
    err.status = 404;
    throw err;
  }

  /** Turns a contract revert into its reason string, e.g. "InsufficientVerifiedEvidence". */
  const reason = (e: any) => {
    const text = String(e?.message ?? e ?? "Unknown error");
    return e?.revert?.args?.[0] ?? text.match(/reverted with reason string '([^']+)'/)?.[1] ?? text.match(/reverted with custom error '([^']+)'/)?.[1] ?? text;
  };

  http
    .createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", async () => {
        const url = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
        try {
          const body = raw ? JSON.parse(raw) : {};
          const out = await act(req.method || "GET", url, body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out));
          if (req.method === "POST") console.log(`POST ${url} ok`);
        } catch (e: any) {
          const status = e?.status ?? 400;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: reason(e) }));
          console.log(`${req.method} ${url} -> ${status} ${reason(e)}`);
        }
      });
    })
    .listen(PORT, () => {
      console.log(`Ledger API on http://localhost:${PORT} (chain ${chainId}, escrow ${dep.contracts.CampaignEscrow})`);
    });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
