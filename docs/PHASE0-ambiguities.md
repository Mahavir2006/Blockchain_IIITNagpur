# Phase 0 — Design: Ambiguity Resolutions

## 1. Cross-chain simulation

**Ambiguity:** The prompt requires multi-chain flows but says no real bridge needed and all local/free.

**Resolution:** Two local Hardhat nodes on different chain IDs (31337 = chain A, 31338 = chain B). `BridgeGateway` is deployed on both chains (lock on A, mint on B). A `relayer.ts` script reads events from chain A's JSON-RPC and submits corresponding messages to chain B's JSON-RPC. All mock, no real bridge, no real funds.

## 2. ZK vs selective disclosure

**Ambiguity:** The prompt mentions beneficiary privacy and says "Do NOT claim zero-knowledge unless you actually implement and test a ZK circuit."

**Resolution:** Use commitment-based selective disclosure with Merkle proofs. Publish a Merkle root of `keccak256(beneficiarySecret || deliveryRecord)` leaves. `verifyDelivery(leaf, proof)` checks inclusion. Document that a ZK upgrade path exists but is not implemented. Label honestly in code and README.

## 3. Mock modules

**Ambiguity:** Swap, bridge, fiat off-ramp need "real logic behind it and be labelled as a mock."

**Resolution:** All mocks live in `contracts/mocks/`. `MockSwap` executes a real ERC-20→ERC-20 swap at a configurable rate and emits `SwapExecuted`. `BridgeGateway` is a real lock/mint contract pair. `FiatOffRampAttestor` is a real contract where a registered partner signs a fiat-settlement statement. All clearly named as mocks in docs and code comments.

## 4. Network configuration

**Ambiguity:** Sepolia and Polygon Amoy entries must be in `hardhat.config.ts`, disabled unless env vars present.

**Resolution:** `hardhat.config.ts` defines `sepolia` and `amoy` networks gated on `SEPOLIA_RPC_URL`/`SEPOLIA_PRIVATE_KEY` and `AMOY_RPC_URL`/`AMOY_PRIVATE_KEY`. Default network is `localhost` (Hardhat). Local-only by default; zero real funds required.

## 5. Freeze authority

**Ambiguity:** "No single EOA can freeze or unfreeze" but someone must be able to unfreeze.

**Resolution:** Unfreeze requires verifier-quorum vote (M-of-N staked verifiers) in `FreezeController`. Campaign expiry and donor refund path also available. No admin `onlyOwner` switch.

## 6. Testing scope

**Ambiguity:** ">90% line coverage" plus integration tests for full lifecycle and red-team scenario.

**Resolution:** Unit tests for every contract (happy paths, access control, reverts, edge cases, reentrancy, duplicate-nullifier attack, forged-receipt attack, category-cap breach, freeze/unfreeze via quorum, refund path, slashing math). One integration test for full donation→release lifecycle. One integration test for the red-team scenario. `npx hardhat coverage` included in scripts.

## 7. Forgery detection signals

**Ambiguity:** "Statistical forgery signals" must not be overclaimed.

**Resolution:** Forgery likelihood score is documented as a probabilistic signal (0.0 to 1.0), not a proof. Contributing factors listed explicitly: vendor concentration, amount clustering, timestamp anomalies. README documents false positive/negative possibility.

## 8. Single-command UX

**Ambiguity:** Seven npm scripts must all work.

**Resolution:** Scripts defined in `package.json`: `setup`, `chain:up`, `deploy:local`, `services:up`, `dev`, `demo:redteam`, `test`. Each maps to a concrete script or tool command.

## 9. Repository structure

**Ambiguity:** "Use exactly this layout."

**Resolution:** Directory layout matches the prompt exactly: `black-hole-ledger/` root with `contracts/core/`, `contracts/interfaces/`, `contracts/libraries/`, `contracts/mocks/`, `test/unit/`, `test/integration/`, `scripts/`, `services/` (six subfolders), `dashboard/`, `reports/`, `docs/`. Since the current working directory is the project root, files are placed directly under it (not nested inside a `black-hole-ledger/` subfolder).

## 10. Problem statement paste location

**Ambiguity:** The build prompt says to paste `black-hole-ledger-problem-analysis.md` contents at the end of the prompt (lines 186-188) and produce a traceability table.

**Resolution:** The source file `black-hole-ledger-problem-analysis.md` is preserved unmodified. A traceability table mapping each stated requirement to a contract/service/test is included in `docs/PHASE0-traceability.md`.