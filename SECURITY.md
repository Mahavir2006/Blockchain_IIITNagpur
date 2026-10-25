# Security

Hackathon prototype. Local networks and mock tokens only; not audited; do not deploy with real funds.

## Threat model

| Actor | Can | Wants |
|---|---|---|
| Dishonest NGO | Submit evidence and request tranches for its own campaigns; publish its delivery roots | Release funds without real spending |
| Colluding vendor | Sign attestations with its registered key | Back fake invoices |
| Dishonest verifier | Attest or challenge evidence, vote to freeze, unfreeze or admit verifiers | Approve forged evidence for a bribe |
| Owner / deployer | Seed verifiers during bootstrap, tune quorums (never below 2), resolve challenges, slash | Bypass a freeze or release funds |
| Outside attacker | Call any public function | Steal escrow funds, grief campaigns |
| Donor | Deposit, claim refunds | Get a refund they are not owed |

## Trust model

- **Verifier set.** The deployer admits the initial verifiers during a bootstrap phase, then calls `closeBootstrap()`. After that, a newcomer needs votes from 2 active verifiers. A verifier is active only while its bond is at least 10 mUSD (`MIN_VERIFIER_BOND`). NGOs and vendors cannot be verifiers, and verifiers cannot become NGOs or vendors.
- **Freezes.** Both freezing and unfreezing need a quorum of active verifiers (at least 2). Votes are counted per freeze episode, so they never carry over to the next one. The owner holds no verifier role and cannot lower a quorum below 2.
- **Releases.** A tranche is released only if all of these hold:
  - the campaign is not frozen;
  - the campaign's own balance covers the tranche;
  - the campaign's NGO has published a delivery root;
  - quorum-verified evidence for this campaign totals at least everything released so far plus this tranche.
- **Wiring.** Token, freeze controller and impact verifier are immutable in the escrow. The cross-links (escrow ↔ evidence registry ↔ attestation verifier ↔ impact verifier) are set once at deployment and cannot be changed afterwards.

## Attacks considered and where they are handled

Every row has a `DEFENCE` test in `test/security/probes.test.ts` unless noted.

| Attack | Defence |
|---|---|
| One campaign spending another's donations (C1) | Per-campaign `balance`; `InsufficientCampaignBalance` |
| Refund overdraw after a release (C2) | Pro-rata refund of what the campaign still holds; randomised balance invariant (3 seeds × 80 steps) |
| Tranches above target (C3) | `TranchesExceedTarget` |
| Receipt reuse with a made-up nullifier (C4) | Nullifier derived on-chain; `InvalidNullifier`, `DuplicateNullifier` |
| Release with no evidence (H1) | `InsufficientVerifiedEvidence` unless quorum-verified evidence covers total releases |
| Fake delivery root (H2) | Only the campaign's NGO publishes; `NotCampaignNGO`, `CampaignNotFound` |
| Griefing freeze (H3) | Freeze needs a verifier quorum; `NotVerifier`, `InvalidReason` |
| Sybil verifiers (H4) | Admission by bootstrap or quorum vote, minimum bond, conflict-of-interest checks |
| Single-account unfreeze (H5) | Quorums ≥ 2 (`QuorumTooLow`); deployer holds no verifier role |
| Swapping a dependency to dodge a freeze (H6) | Immutable core references; one-time `AlreadySet` wiring, deployer-only |
| Attesting evidence that does not exist (H7) | Attestations read the registry; `EvidenceNotFound`, `EvidenceMismatch`, `NotEvidenceVendor` |
| Strangers burning an NGO's nullifier (H8) | Only the campaign's NGO can file evidence |
| Draining bridge liquidity (H9) | Only the relayer mints or relays; `NotRelayer` |
| Stale unfreeze votes (M7) | Votes keyed by freeze epoch |
| Fake fiat settlements (M3) | Owner-registered partners only; settlement signature binds attestor, chain, hop, amount and asset; one attestation per hop (`AlreadyAttested`) |
| Swap rate manipulation (M4) | `setRate` is owner-only (mock) |
| Fraud found after verification (M5) | Verified evidence stays challengeable; a challenge withdraws its amount from the verified total until resolved, and a dismissed challenge restores it |
| Internal Merkle node passed off as a delivery (M6) | Leaves hashed with prefix `0x00`, nodes with `0x01` (contract and dashboard) |
| Slashed verifier still voting (M1) | Active only while bond ≥ minimum |
| Evidence for non-existent campaigns (M2) | `CampaignNotFound` |
| Reentrancy on escrow | `ReentrancyGuard`, checks-effects-interactions, `SafeERC20`; malicious-token tests |
| Forged vendor signatures | EIP-712 signature must come from the evidence vendor's registered key |
| Over-deposit | `ExceedsTarget` (contract check) |
| Frozen funds stuck | `refundDonor` open when frozen or expired |

## Known gaps (not fixed)

All 20 reproduced exploits are fixed; no `EXPLOIT` tests remain. The `RESIDUAL` tests in `test/security/probes.test.ts` reproduce the limits below. Severities are in [reports/test-report.md](reports/test-report.md).

**Residuals of fixes**

- **C4** — An altered invoice document (one changed byte) hashes to a fresh nullifier. This is the oracle problem.
- **H8** — Another NGO that holds the exact invoice data can file it to its own campaign first and claim the nullifier. Campaign creation is open to anyone.

**Other gaps**

1. **Challenge resolution and slashing are owner-gated** (`resolveChallenge`, `slashBond`). Fix: quorum-based resolution with automatic slashing of the losing side.
2. **Bootstrap trust.** Until `closeBootstrap()` is called, the deployer can admit any applicant as a verifier. Deployment must close it.
3. **Mock operator trust.** `BridgeGateway` trusts its relayer (the deployer) to mint only for real locks on the source chain. The off-ramp and swap owners choose partners and rates.
4. **No `FlowHop` event.** The hop contracts don't emit it, so flow reconstruction must correlate `SwapExecuted`, `AssetLocked`/`AssetMinted` and `FiatSettlementAttested` events instead.
5. **Category caps are not enforced.** `categoryCap` and `categorySpent` are stored but never checked, so freeze reason 3 is never raised on-chain.
6. **`trancheReleaseConditions` are accepted but not stored.** Releases use verified evidence instead.
7. **Forged-ratio detection runs off-chain.** Verifiers vote the freeze; it isn't triggered automatically.
8. **Verifier attestations do not require a vendor signature first** (state `SUBMITTED` is accepted).
9. **Late challenges can't claw back paid tranches.** A challenge on verified evidence only blocks future releases; funds already paid out stay with the NGO. A verifier quorum can still freeze the campaign.

## Fixed during testing

- **All findings:** C1–C4 (critical), H1–H9 and M7 (high), and M1–M6 (medium). See the table above.
- **Phase 5:** `requestTrancheRelease` could never succeed (it verified an empty proof), and `slashBond` returned the stake to the slashed verifier.

## Out of scope

Real-world receipt authenticity (oracle problem), KYC, front-running/MEV, key management, production bridge security, zero-knowledge privacy (beneficiary privacy is Merkle-commitment selective disclosure, not ZK).
