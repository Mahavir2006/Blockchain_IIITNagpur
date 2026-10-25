# Phase 0 — Design: The Black Hole Ledger

Source of truth: `black-hole-ledger-problem-analysis.md` (requirements) and `nemotron-build-prompt.md` (engineering instructions).

## 1. Architecture Overview

A single coherent product: donations sit in purpose-bound escrow; funds release tranche-by-tranche only when cryptographic evidence of spending passes verification; beneficiary identities are hidden behind Merkle commitments; multi-hop flows are reconstructed off-chain into a verifiable timeline; duplicate evidence and forged receipts trigger automatic escrow freeze without a central auditor.

### Layered stack

| Layer | Responsibility | Technology |
|---|---|---|
| Smart contracts (core) | Escrow, commitments, attestations, freeze, impact verification | Solidity ^0.8.24, Hardhat, OpenZeppelin 5.x |
| Smart contracts (mocks) | Stable token, swap, bridge pair, fiat off-ramp attestor | Solidity, `contracts/mocks/` |
| Off-chain services | Indexer (SQLite), flow reconstruction, discrepancy detection, scoring, API, verifier-node | TypeScript/Node, Express |
| Frontend | Donor dashboard with trace view, evidence view, alerts, privacy proof checker | React + Vite + TypeScript |
| Demo | Red-team scenario scripted against two local chains | Hardhat script, `npm run demo:redteam` |

### Two local chains

- Chain A: Hardhat node, chain ID 31337 (default)
- Chain B: Hardhat node, chain ID 31338 (simulated second chain)
- A small relayer script moves `FlowHop` messages between the two local JSON-RPC nodes
- Both run in-process; zero real funds; all network config is env-driven via `.env`

### Sepolia / Polygon Amoy

- Entries present in `hardhat.config.ts`, disabled unless `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY`, `AMOY_RPC_URL`, `AMOY_PRIVATE_KEY` are set in `.env`
- Never enabled by default; local-only by default

## 2. High-End Data Flow

1. Donor deposits ERC-20 into `CampaignEscrow` earmarked for a campaign/purpose
2. NGO registers vendors; verifiers stake bonds
3. NGO submits evidence commitment (`keccak256(salt || invoiceHash || vendorId || amount || category || date)`) + nullifier to `EvidenceRegistry`
4. Vendor signs EIP-712 attestation; staked verifiers vote quorum M-of-N
5. NGO publishes Merkle root of beneficiary delivery commitments to `ImpactVerifier`
6. `FreezeController` auto-freezes on duplicate nullifier, forged-receipt ratio > threshold, category cap breach attempt, or quorum-upheld challenge
7. Off-chain indexer watches both chains; reconstruction engine rebuilds the timeline; scoring engine computes per-stage confidence; API serves the dashboard
8. Dashboard shows trace view, evidence view, alerts, and beneficiary privacy proof checker