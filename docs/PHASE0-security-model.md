# Phase 0 — Design: Security Model

## 1. Access Control

- `ParticipantRegistry` uses OpenZeppelin `AccessControl` v5 with roles: `NGO_ROLE`, `VENDOR_ROLE`, `VERIFIER_ROLE`, `DONOR_ROLE`
- Role grants are made by the deployer (initial admin) at setup; no runtime admin role beyond that
- Verifiers must stake an ERC-20 bond (`MockUSD`) to be active; inactive verifiers cannot vote in quorum
- Vendors register a signing address; only that address's EIP-712 signature is accepted for vendor attestations
- Donors have `DONOR_ROLE` to deposit; anyone can read campaign/evidence state

## 2. Replay Protection

- All state-changing functions use `ReentrancyGuard` (OpenZeppelin v5)
- EIP-712 vendor attestations include a `chainId` domain separator and a `nonce` per vendor to prevent cross-chain and replay attacks
- Nullifier check is atomic: `usedNullifiers[nullifier]` is set within the same transaction as the commitment, preventing concurrent double-submission
- Bridge `relayMessage` includes a message nonce per source chain to prevent replay of bridge messages

## 3. Evidence Duplication

- Nullifier `keccak256(invoiceHash || vendorId || amount || date)` is global across all campaigns and donors
- On `submitEvidence`, contract checks `usedNullifiers[nullifier]`; if true, reverts with `DuplicateNullifier` and emits `DuplicateEvidenceDetected(campaignIdA, campaignIdB, nullifier)`
- `DuplicateEvidenceDetected` triggers `FreezeController.triggerFreeze` for both campaigns involved
- The same receipt cannot be claimed in two donor campaigns

## 4. Escrow Freeze Authority

**Freeze triggers (automatic, no admin switch):**
- (a) Duplicate nullifier detected
- (b) Forged-evidence ratio for an NGO exceeding configurable threshold (e.g. rejected/submitted > 20% over a window)
- (c) Category cap breach attempt (spending outside declared categories rejected on-chain)
- (d) Quorum-upheld challenge (verifier quorum votes that evidence is forged)

**Unfreeze authority:**
- Only a verifier-quorum vote (M-of-N staked verifiers) can unfreeze
- Or campaign expiry / donor refund path
- **No single EOA can freeze or unfreeze** — this is enforced in `FreezeController` with no `onlyOwner` or admin switch

## 5. Beneficiary Privacy

- Beneficiary identities are never stored on-chain
- NGO publishes a Merkle root of `keccak256(beneficiarySecret || deliveryRecord)` leaves to `ImpactVerifier`
- `verifyDelivery(campaignId, leaf, proof)` allows anyone with the `beneficiarySecret` to verify inclusion
- Public chain sees only the root and leaf-level hashes
- Dashboard includes a "Beneficiary-privacy proof checker" where a donor pastes a leaf + proof to verify delivery inclusion

## 6. Forged Off-Chain Receipt Detection — Limitations (Honest)

**What cryptography guarantees:**
- Integrity: receipt not altered after commitment (`keccak256`)
- Non-reuse: same receipt not submitted twice (global nullifier)
- Binding: spend bound to specific vendor, amount, category, date

**What cryptography CANNOT guarantee:**
- That the real-world receipt is genuine (the oracle problem)
- That the vendor actually delivered goods/services
- That the invoice wasn't fabricated off-chain before hashing

**How the system closes the gap without a central auditor:**
- Vendor-signed EIP-712 attestations (links receipt to a real vendor key)
- Staked verifier quorum M-of-N (independent review, economic slashing)
- Statistical anomaly signals (vendor concentration, amount clustering, timestamp anomalies → forgery likelihood score)
- Cross-campaign nullifier uniqueness (prevents double-counting)

**Residual risks and mitigations:**
- Vendor-NGO collusion: mitigated by vendor economic bond (slashable) and statistical anomaly detection; not eliminated
- Verifier collusion: mitigated by economic slashing on failed challenges and rotating verifier sets; not eliminated
- Forgery likelihood score is probabilistic: documented as a signal, not a proof; may produce false positives/negatives

**Honest labelling rule:** The system never claims hashes prove a receipt is genuine. It never claims a model can reliably detect every forgery. All probabilistic signals are labelled as signals.