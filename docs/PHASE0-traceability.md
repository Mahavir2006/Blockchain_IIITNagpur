# Phase 0 — Design: Requirements Traceability

Source: `black-hole-ledger-problem-analysis.md`, Section 3 (explicit requirements table), Section 4 (adversarial scenario), Section 5 (probabilistic evaluation chain), Sections 7-9 (implied requirements and likely deliverables).

## Requirement → Component Mapping

| # | Requirement (source) | Satisfied by |
|---|---|---|
| 1 | Purpose-bound allocation — smart contracts manage earmarked funds and enforce disbursement conditions | `CampaignEscrow` (deposit, createCampaign, tranche release conditions, category budget caps) |
| 2 | Verifiable expenditure records — link outgoing on-chain transactions to off-chain invoices/receipts using cryptographic commitments | `EvidenceRegistry` (commitment + nullifier), `AttestationVerifier` (vendor EIP-712 signature, verifier quorum) |
| 3 | Privacy protection — shield beneficiaries' identities and sensitive documents from public blockchain while maintaining mathematical proof of delivery | `ImpactVerifier` (Merkle root of `keccak256(beneficiarySecret || deliveryRecord)`, `verifyDelivery`), beneficiary privacy proof checker in dashboard |
| 4 | Discrepancy detection — flag unexplained transfers, spending outside declared categories, inconsistencies between published reports and recorded transactions | Off-chain `services/detection/` (discrepancy detection engine), `FreezeController` (auto-freeze on category cap breach) |
| 4a | Detect cryptographic duplication of evidence across donor reports | `EvidenceRegistry` (global nullifier, `DuplicateNullifier` revert + `DuplicateEvidenceDetected` event) |
| 4b | Detect forged receipts (30% of batch) | `AttestationVerifier` (vendor signature + verifier quorum challenge), `services/detection/` (forgery likelihood score) |
| 4c | Freeze escrow disbursements automatically | `FreezeController` (automatic freeze on duplicate nullifier, forged ratio > threshold, category cap breach, quorum-upheld challenge) |
| 4d | No centralized auditor | Verifier-quorum M-of-N with staked bonds and slashing; no `onlyOwner` admin switch |
| 5 | Probabilistic evaluation chain: Inbound Donation → Escrow Condition → Off-Chain Invoice Proof → Cryptographic Impact Verification | Off-chain `services/scoring/` (per-stage confidence scores + composite score, documented formula) |
| 7 | Multi-chain flows (swap, bridge, fiat off-ramp) | `contracts/mocks/MockSwap`, `contracts/mocks/BridgeGateway` (two local chains), `contracts/mocks/FiatOffRampAttestor`, `scripts/relayer.ts` |
| 8 | Global evidence-uniqueness registry | `EvidenceRegistry` (global nullifier mapping across all campaigns and donors) |
| 9 | Decentralized freeze logic (not admin switch) | `FreezeController` (unfreeze only via verifier-quorum vote or expiry/refund) |
| 10 | Per-stage confidence/verification status (probabilistic, not pass/fail) | `services/scoring/` (S1-S4 stage scores + composite, each with listed contributing factors) |
| 11 | Oracle problem addressed explicitly | `docs/PHASE0-security-model.md` (guarantees vs limitations table), README Evidence Trust Model section |
| 12 | Red-team demo scenario (duplicate receipt + forged batch → detection → freeze) | `scripts/redteam.ts` (`npm run demo:redteam`), writes `reports/redteam-report.md` |

## Implied Requirements → Component Mapping

| # | Implied requirement | Satisfied by |
|---|---|---|
| 1 | Ingestion and reconciliation backend (passively accept multi-hop flows) | `services/indexer/` (subscribes to both local chains, SQLite) |
| 2 | Flow reconstruction (rebuild verifiable timeline) | `services/reconstruction/` (consumes `FlowHop` + escrow events) |
| 3 | API server exposing timeline, scores, discrepancies, campaign state, freeze status | `services/api/` (Express) |
| 4 | Verifier-node script (independent watcher, 3 nodes demonstrate quorum) | `services/verifier-node/` |
| 5 | Donor dashboard | `dashboard/` (Vite + React + TypeScript) |
| 6 | Single-command UX | `package.json` scripts |
| 7 | Hardhat tests for every contract, >90% coverage | `test/unit/`, `test/integration/`, `npx hardhat coverage` |
| 8 | SECURITY.md | `SECURITY.md` (to be written in Phase 5) |
| 9 | README with architecture diagram (Mermaid), scoring formula, Evidence Trust Model, setup steps, commands | `README.md` (to be written in Phase 5) |
| 10 | Sepolia + Polygon Amoy entries in `hardhat.config.ts`, disabled unless env vars | `hardhat.config.ts` (to be written in Phase 2) |

## Out-of-Scope / Mocked Items

| Item | Handling |
|---|---|
| Production-grade bridge | Mocked: `BridgeGateway` lock/mint on two local chains, relayer script between local JSON-RPC nodes |
| Real fiat integration | Mocked: `FiatOffRampAttestor` as signed attestation |
| Full ZK coverage | Not implemented; Merkle selective disclosure with documented ZK upgrade path |
| Real funds / testnet deployment | Not used; local Hardhat only, env-gated Sepolia/Amoy config |
| Paid services / API keys | None required |