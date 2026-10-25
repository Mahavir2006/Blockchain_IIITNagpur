# Phase 0 — Design: Evidence Formulas and Scoring

## 1. Evidence Commitment Formula

For each expenditure, the NGO submits a commitment to the off-chain invoice/receipt:

```
commitment = keccak256(salt || invoiceHash || vendorId || amount || category || date)
```

Where:
- `salt`: random 32-byte value chosen by the NGO (prevents preimage / rainbow-table attacks on the commitment)
- `invoiceHash = keccak256(off-chain invoice document bytes)`: hash of the actual invoice/receipt file
- `vendorId`: the registered vendor's on-chain identifier (address)
- `amount`: expenditure amount in the campaign's ERC-20 unit (uint256)
- `category`: declared spending category (bytes32, must match a campaign-declared category)
- `date`: invoice date (uint256, Unix timestamp)

The commitment is stored on-chain in `EvidenceRegistry`. The off-chain invoice itself is never posted to the chain. The salt is revealed only when the donor or verifier asks to open the commitment.

## 2. Nullifier Formula (Global Dedup)

```
nullifier = keccak256(invoiceHash || vendorId || amount || date)
```

The nullifier is derived from the invoice content (not the salt) so that the **same underlying evidence cannot be reused** across campaigns or donors.

- The nullifier registry is **global across all campaigns and all donors**
- A submitted nullifier is checked against a mapping `bytes32 => bool usedNullifiers`
- If already used, the transaction reverts with `DuplicateNullifier` and emits `DuplicateEvidenceDetected` carrying the campaign ids involved
- This triggers `FreezeController` freeze logic automatically

## 3. Selective Disclosure / Beneficiary Privacy

- NGO publishes a Merkle root of beneficiary-delivery commitments to `ImpactVerifier`
- Each leaf = `keccak256(beneficiarySecret || deliveryRecord)`
- `verifyDelivery(campaignId, leaf, proof)` recomputes the root and checks inclusion
- Anyone with the `beneficiarySecret` can verify inclusion; the public chain only ever sees the root and leaf-level hashes
- Labelled honestly: *commitment-based selective disclosure with Merkle proofs*; ZK upgrade path documented but not implemented
- No claim of zero-knowledge unless a ZK circuit is actually implemented and tested

## 4. Probabilistic Evaluation Chain Scoring Formula

For each donation, compute a confidence score for each stage plus a composite score:

### Stage scores (each 0.0 to 1.0)

**S1 = Inbound Donation confidence**
- Factors: deposit confirmed on-chain (1.0), donor KYC/status unknown (no penalty, no bonus), funds within campaign target cap
- Formula: `S1 = 1.0` if deposit event confirmed and within cap, else `0.0`

**S2 = Escrow Condition confidence**
- Factors: campaign active and not frozen (0.6), tranche conditions defined (0.2), release conditions verifiable on-chain (0.2)
- Formula: `S2 = 0.6 + 0.2 + 0.2` if all met; deducted proportionally for each missing factor

**S3 = Off-Chain Invoice Proof confidence**
- Factors: commitment submitted (0.3), nullifier unique (0.3), vendor attestation valid (0.2), verifier quorum reached (0.2)
- Formula: sum of present factors; missing factor = 0 for that component

**S4 = Cryptographic Impact Verification confidence**
- Factors: delivery root published (0.5), leaf inclusion verifiable with secret (0.3), per-tranche impact score > 0.5 (0.2)
- Formula: sum of present factors

### Composite score

```
Composite = (S1 * w1) + (S2 * w2) + (S3 * w3) + (S4 * w4)
```

Default weights: `w1 = 0.25, w2 = 0.25, w3 = 0.25, w4 = 0.25` (equal weighting; configurable via env)

### Discrepancy / forgery signals (separate from confidence, additive risk flags)

- `unexplainedTransfer`: funds leaving escrow without a linked evidence commitment → risk flag
- `categoryBreach`: spending outside declared categories → risk flag
- `reportMismatch`: NGO published report JSON vs on-chain totals mismatch → risk flag
- `duplicateEvidence`: duplicate nullifier across donor reports → risk flag + auto-freeze
- `forgeryLikelihood`: statistical signals (vendor concentration, amount clustering, timestamp anomalies) → 0.0 to 1.0 score

**Honest labelling:** Hashes prove integrity (the receipt was not altered after commitment), not authenticity (the receipt is genuine). Statistical forgery signals are probabilistic and may produce false positives/negatives. The system documents this limitation explicitly.

## 5. Cryptographic Guarantees vs Probabilistic Signals

| Guarantee | Mechanism | What it proves | What it does NOT prove |
|---|---|---|---|
| Integrity | `keccak256` commitment | Invoice not altered after commitment | That the invoice was genuine to begin with |
| Non-reuse | Global nullifier | Same evidence not submitted twice | That two different invoices aren't collusively similar |
| Binding | Commitment includes vendorId, amount, category, date | Spend is bound to specific evidence | That the spend actually occurred in the real world |
| Vendor linkage | EIP-712 vendor signature | Real vendor key signed the statement | That the vendor wasn't colluding with the NGO |
| Quorum | M-of-N staked verifiers | Independent review occurred | That all verifiers are honest |
| Selective disclosure | Merkle root + leaf proof | Delivery inclusion provable with secret | Beneficiary identity (hidden) |

The oracle problem is addressed explicitly: cryptography proves a receipt was not altered, not that it was real. The system closes the gap with vendor-signed attestations + staked verifier quorum + economic slashing + statistical anomaly signals + cross-campaign nullifier uniqueness. Residual risks: vendor-NGO collusion, verifier collusion.