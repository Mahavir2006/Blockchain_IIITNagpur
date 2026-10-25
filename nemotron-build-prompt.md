# PROMPT FOR NEMOTRON — Build "The Black Hole Ledger"

> How to use: paste everything below into Nemotron. Then paste the full contents of `black-hole-ledger-problem-analysis.md` where indicated near the end. If the model stops mid-way, reply with: `Continue from where you stopped. Output the next file in full.`

---

## ROLE

You are a principal engineer who has shipped production blockchain systems (Solidity, TypeScript, Hardhat) and a security-minded architect. You are building a hackathon project that must nevertheless be engineered to the standard of a real industry product.

## GOAL

Build **one single, coherent product** that solves the problem in the attached specification (CASCADE '26, Theme 4, Problem 2: *The Black Hole Ledger — Verifiable NGO Fund Flows*).

The product is a **verifiable donation-accountability protocol**: donations are held in purpose-bound escrow; funds are released only against cryptographically committed proof of spending; beneficiary privacy is preserved; multi-hop, multi-chain and fiat off-ramp flows are reconstructed into a verifiable impact timeline; and duplicate or forged evidence is detected and escrow is frozen automatically, **without any centralized auditor**.

## NON-NEGOTIABLE PRODUCT PHILOSOPHY

1. **One complete product, not a pile of features.** Every component must exist because the core flow needs it. If a feature does not strengthen the chain *Inbound Donation → Escrow Condition → Off-Chain Invoice Proof → Cryptographic Impact Verification*, do not build it. No gimmicks, no decorative extras, no "AI-powered" labels, no token or NFT side-features.
2. **Depth over breadth.** A smaller set of components that genuinely work end to end beats a wide set of stubs.
3. **Everything shown must really work.** No placeholder functions, no `// TODO`, no mocked results presented as real, no hardcoded demo outputs, no fake ZK. Where something is simulated (bridge, swap, fiat off-ramp), it must be an explicit, clearly named mock *module* with real logic behind it and be labelled as a mock in the docs.
4. **Honesty about limits.** The oracle problem (cryptography proves a receipt was not altered, not that it was real) must be addressed explicitly in the design and README with the mechanism you chose (see Evidence Trust Model below) and its stated limitations.
5. **Consistent naming, single architecture, single visual identity.** It should read as if one team designed it in one sitting.

## HARD CONSTRAINTS

- **All smart contracts must be internally working and fully tested.** Every public function must be reachable and exercised by tests. The full test suite must pass with a single command.
- **I have no ETH or Amoy balance.** Therefore:
  - The project must run **100% for free on a local Hardhat network** (in-process and as a local JSON-RPC node) with zero real funds.
  - Provide scripts that deploy the entire system to the local node and seed it with demo data in one command.
  - Provide a **second local node on a different chain id** to simulate a second chain for the multi-chain flow (no real bridge needed).
  - Network configuration must be **environment-driven** (`.env`) so that I can later deploy to any EVM testnet by only adding an RPC URL and a private key. Include Sepolia and Polygon Amoy entries in `hardhat.config.ts`, disabled unless env vars are present.
  - Keep contracts **gas-conscious** (custom errors, packed storage, calldata, no unbounded loops) because I will deploy with a tiny faucet balance later. Print gas used per deployment in the deploy script.
  - Use no paid services, no paid APIs, no API keys required to run the demo.
- Solidity `^0.8.24`, Hardhat + TypeScript, OpenZeppelin Contracts (latest stable 5.x), ethers v6.
- Do not invent APIs or library functions. If unsure of an OpenZeppelin or ethers signature, use the simplest form you are certain about.
- Never use `tx.origin`, never use `block.timestamp` for randomness, use `ReentrancyGuard` and checks-effects-interactions, use `SafeERC20`.

## SYSTEM TO BUILD

### A. Smart contracts (Solidity) — the protocol core

Design these contracts so they compose into one system. You may merge or rename for cleanliness, but every responsibility below must be covered, with clear separation of concerns, events for every state change, and NatSpec on every external function.

1. **`ParticipantRegistry`** — registers NGOs, vendors, and verifiers with roles (OpenZeppelin AccessControl). Verifiers must stake a bond (ERC-20) to be active; stake is slashable. Vendors register a signing address.
2. **`CampaignEscrow`** — the purpose-bound escrow.
   - A campaign has: NGO, earmarked purpose/category, total target, categories with budget caps, milestone/tranche schedule, release conditions.
   - Donors deposit ERC-20; donation records are tied to a campaign.
   - Disbursement to the NGO happens **tranche by tranche**, and only when the `ImpactVerifier` confirms the prior tranche's evidence threshold is met.
   - Enforces category budget caps (spending outside declared categories is rejected on-chain).
   - Donor refund path if a campaign is frozen and not cleared, or expires.
3. **`EvidenceRegistry`** — the cryptographic heart.
   - An NGO submits, per expenditure, a **commitment** to the off-chain invoice/receipt: `commitment = keccak256(salt || invoiceHash || vendorId || amount || category || date)` plus a **nullifier** derived from the invoice content so the same underlying evidence cannot be reused.
   - The nullifier registry is **global across all campaigns and all donors**. Reuse of a nullifier (the double-counting attack) must revert at the contract level **and** emit a `DuplicateEvidenceDetected` event with the campaign ids involved, which triggers the freeze logic.
   - Stores commitments in a per-campaign Merkle tree (or append-only hash chain) so a Merkle root can be used for later selective disclosure proofs.
4. **`AttestationVerifier`** (evidence trust layer) — handles the oracle problem without a central auditor:
   - **Vendor attestations:** registered vendors sign (EIP-712) a statement "I received amount X for invoice commitment C". On-chain signature verification links a receipt to a real vendor key.
   - **Verifier quorum:** a configurable M-of-N set of staked verifiers can attest or challenge a piece of evidence. Challenges require a bond; a successful challenge slashes the NGO's/verifier's bond and rewards the challenger; a failed challenge slashes the challenger.
   - Each piece of evidence ends in one state: `Submitted`, `VendorAttested`, `QuorumVerified`, `Challenged`, `Rejected`.
5. **`FreezeController`** (or logic inside escrow) — **automatic freeze with no admin switch**:
   - Freeze triggers: (a) duplicate nullifier, (b) forged-evidence ratio for an NGO exceeding a configurable threshold (e.g. rejected / submitted > 20% over a window), (c) category cap breach attempt, (d) quorum-upheld challenge.
   - Frozen campaigns halt all disbursements; unfreeze only through a verifier-quorum vote or expiry/refund path. No single EOA can freeze or unfreeze.
6. **`ImpactVerifier`** — verifies proof of delivery **without revealing beneficiaries**:
   - NGO publishes a Merkle root of beneficiary-delivery commitments (hash of beneficiary secret + delivery record). Anyone with the beneficiary's secret can verify inclusion; the public chain only ever sees the root and leaf-level hashes.
   - Provides `verifyDelivery(campaignId, leaf, proof)` and computes a per-tranche **impact verification score** that feeds the escrow release condition.
   - **Do NOT claim zero-knowledge unless you actually implement and test a ZK circuit.** If you do not, call it what it is: *commitment-based selective disclosure with Merkle proofs*, and document that a ZK upgrade path exists. Honest labelling is required.
7. **Cross-chain and DeFi hop modules (explicit mocks with real logic):**
   - `MockSwap` (ERC-20 to ERC-20 at a configurable rate, emits swap events).
   - `BridgeGateway` pair (lock/mint style) deployed on chain A and chain B; a small relayer script moves messages between the two local nodes. Every hop emits a standardized `FlowHop` event carrying `flowId`, `hopIndex`, `hopType`, `amount`, `asset`, `chainId`, and `parentHop`.
   - A `FiatOffRampAttestor` modelled as an attestation: a registered off-ramp partner signs a fiat-settlement statement for a given hop; this links the on-chain money trail to the off-chain fiat vendors.
   - Mock stable token (`MockUSD`) and a mock wrapped asset for testing. All mocks live in a clearly named `contracts/mocks/` folder.

### B. Off-chain services (TypeScript / Node)

1. **Chain indexer** — subscribes to events from **both local chains**, persists to SQLite (no external DB), handles reorg-safe confirmations simply (confirmation depth parameter).
2. **Flow reconstruction engine** — consumes `FlowHop` and escrow events and **rebuilds a verifiable timeline** for any donation: Donation → Escrow → Swap → Bridge → Off-ramp → Vendor invoice → Delivery commitment. Each edge carries a verification status.
3. **Discrepancy detection engine** — implements the explicit spec rules:
   - unexplained transfers (funds leaving without a linked evidence commitment),
   - spending outside declared categories,
   - published-report vs recorded-transaction mismatches (NGO publishes a report JSON; engine compares it to on-chain totals),
   - duplicate evidence across donor reports,
   - statistical forgery signals (e.g. unusual vendor concentration, amount clustering, timestamp anomalies) producing a **forgery likelihood score**.
4. **Probabilistic evaluation chain** — for each donation, compute a confidence score for each stage: **Inbound Donation → Escrow Condition → Off-Chain Invoice Proof → Cryptographic Impact Verification**, plus a final composite score. Document the exact scoring formula in the README. No black boxes: every score must list its contributing factors.
5. **API server** (Express or Fastify) exposing the timeline, scores, discrepancies, campaign state and freeze status.
6. **Verifier-node script** — a runnable watcher that acts as an independent verifier: it independently checks evidence, signs attestations or raises challenges. Running 3 of them demonstrates the quorum working **without a central auditor**.

### C. Donor dashboard (frontend)

A single clean React (Vite + TypeScript) app that a donor would actually use:
- Campaign overview with escrow balance, released vs locked, category budget usage.
- **Donation trace view**: the multi-hop timeline with per-stage confidence scores and links to the transactions.
- Evidence view: each expenditure, its commitment, attestation state, quorum status.
- Alerts: discrepancies and freeze status with the exact on-chain reason.
- Beneficiary-privacy proof checker: paste a leaf + proof to verify delivery inclusion.
- Visual identity: restrained, professional, fintech/audit style. No clutter, no more than one accent color, consistent spacing and typography. Must look like a finished product.

### D. Adversarial simulation (the centrepiece demo)

One command (`npm run demo:redteam`) runs a scripted scenario against the local chains:
1. Donor deposits a 50-unit donation earmarked "water infrastructure".
2. It is swapped, bridged to chain B, and off-ramped to a local fiat vendor (mock).
3. An honest tranche passes: vendor attestation, quorum verification, delivery root published, tranche released.
4. The **adversarial NGO** then (a) reuses a single receipt across two donor campaigns, and (b) submits a batch where 30% of receipts are forged (invalid vendor signatures or challenged successfully).
5. The system detects the duplicate nullifier, the quorum challenges the forged receipts, and the **escrow freezes automatically**. Show the on-chain freeze event, slashing, and the dashboard flipping to a frozen state.
6. Print a final audit report to the console and write it to `reports/redteam-report.md`.

## EVIDENCE TRUST MODEL (must be written into the README)

State clearly:
- What cryptography guarantees (integrity, non-reuse, ordering, binding of spend to evidence).
- What it cannot guarantee (that the real-world receipt is genuine).
- How the system closes that gap without a central auditor: **vendor-signed attestations + staked verifier quorum + economic slashing + statistical anomaly signals + cross-campaign nullifier uniqueness**.
- Residual risks (collusion between vendor and NGO, verifier collusion) and mitigations.

## QUALITY BAR (all must be met)

- **Tests:** Hardhat tests for every contract: happy paths, access control, reverts, edge cases, reentrancy, the duplicate-nullifier attack, the forged-receipt attack, category-cap breach, freeze/unfreeze via quorum, refund path, and slashing math. Aim for >90% line coverage and include `npx hardhat coverage` in the scripts. Also include at least one full integration test that runs the entire donation → release lifecycle, and one that runs the red-team scenario.
- **Security notes:** a short `SECURITY.md` listing the threat model, attacks considered, and what is out of scope.
- **Docs:** a root `README.md` containing: problem summary, architecture diagram (Mermaid), contract responsibility table, the evaluation-chain scoring formula, the Evidence Trust Model, setup steps, and the exact commands to run everything.
- **Single-command UX:**
  - `npm run setup` installs everything,
  - `npm run chain:up` starts both local nodes,
  - `npm run deploy:local` deploys + seeds,
  - `npm run services:up` starts indexer, API and verifier nodes,
  - `npm run dev` starts the dashboard,
  - `npm run demo:redteam` runs the adversarial scenario,
  - `npm test` runs all contract tests.
- **Code quality:** typed, linted (ESLint + Solhint), formatted (Prettier), no dead code, no unused dependencies, meaningful commit-style structure.

## REPOSITORY STRUCTURE (use exactly this layout)

```
black-hole-ledger/
├── README.md
├── SECURITY.md
├── package.json
├── hardhat.config.ts
├── .env.example
├── contracts/
│   ├── core/            # ParticipantRegistry, CampaignEscrow, EvidenceRegistry,
│   │                    # AttestationVerifier, FreezeController, ImpactVerifier
│   ├── interfaces/
│   ├── libraries/       # MerkleLib, commitment/nullifier helpers
│   └── mocks/           # MockUSD, MockSwap, BridgeGateway, FiatOffRampAttestor
├── test/
│   ├── unit/
│   └── integration/
├── scripts/
│   ├── deploy-local.ts
│   ├── seed.ts
│   ├── relayer.ts
│   └── redteam.ts
├── services/
│   ├── indexer/
│   ├── reconstruction/
│   ├── detection/
│   ├── scoring/
│   ├── api/
│   └── verifier-node/
├── dashboard/           # Vite + React + TypeScript
├── reports/
└── docs/
```

## HOW TO RESPOND (important, to avoid truncated output)

Work in **phases**. Do not try to output everything in one reply.

1. **Phase 0 — Design (this reply):** output only (a) a concise architecture overview, (b) the contract interaction map as a Mermaid diagram, (c) the full list of contracts with their external functions, events and custom errors, (d) the evidence commitment and nullifier formulas, (e) the scoring formula for the probabilistic evaluation chain, (f) any ambiguity you resolved and how. Then stop and wait for me to say `go`.
2. **Phase 1 — Contracts:** output every Solidity file **in full**, one file per code block, with its path as a heading. Then stop.
3. **Phase 2 — Contract tests and deploy/seed scripts:** full files. Then stop.
4. **Phase 3 — Off-chain services:** full files. Then stop.
5. **Phase 4 — Dashboard:** full files. Then stop.
6. **Phase 5 — Red-team script, README, SECURITY.md, final checklist.**

Rules for every phase:
- Output **complete files only**. Never write `...`, "rest of the code", or "similar to above".
- After each phase, list any assumptions you made and any dependency versions you pinned.
- If a later phase requires a change to an earlier file, output the **entire corrected file** again.
- Before finishing Phase 1, perform a self-review pass: check for compile errors, missing imports, wrong OpenZeppelin v5 signatures (e.g. `Ownable(msg.sender)` constructor, `AccessControl` usage, custom errors), and mismatched function names between contracts and tests. Fix them in the output.

## SPECIFICATION (the problem statement)

Paste the full contents of `black-hole-ledger-problem-analysis.md` below this line. Treat it as the source of truth. Every explicitly stated requirement in it must map to a concrete component above; at the end of Phase 5, output a **traceability table** mapping each stated requirement to the contract, service or test that satisfies it.

```
[PASTE black-hole-ledger-problem-analysis.md HERE]
```

Begin with **Phase 0** now.
