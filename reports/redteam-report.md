# Black Hole Ledger — red-team report

Network chainId 31337; generated 2026-10-25T19:00:19.734Z

## 0. Setup
- Contracts deployed: escrow 0x1f10F3Ba7ACB61b2F50B9d6DdCf91a6f787C0E82, freeze 0xab16A69A5a8c12C732e0DEFF4BE56A70bb64c926
- 3 verifiers admitted during bootstrap (now closed) and bonded at the 10 mUSD minimum; vendor registered with its own signing key
- Campaign #1 "water infrastructure" and campaign #2 "relief kits" created by the NGO

## 1. Donation
- Donor deposited 50 mUSD into campaign #1 (tx 0x84e82ae9c3e791570dfec0792bcd6b78eb6228ebb4c166249f7a9d588b1a9437)
- Second donor deposited 25 mUSD into campaign #2

## 2–3. Honest tranche
- Evidence #1 submitted (nullifier 0x318ef0dcb52ad3a0…), vendor EIP-712 signature valid
- Verifier quorum: 2/2 → state QuorumVerified
- Delivery root 0xaadb211a4ae15da6… published; beneficiary 3 inclusion proof verifies: true
- Tranche 0 (20 mUSD) released to NGO (tx 0x1f7da85042ed11404a285e3507096ffce1900a44be1987f9cac4b172bb6bb9e1)
- Hop trail: swap 20 mUSD→wUSD → bridge lock/mint (message 0xc09b46c04585befb…, simulated chain 31338) → fiat off-ramp settlement signed by the registered partner

## 4a. Attack: reuse one receipt across two campaigns
- Same invoice resubmitted to campaign #2 with a fresh salt → reverted DuplicateNullifier (nullifier ignores salt)
- Detector flagged it; verifiers 1 and 2 voted triggerFreeze(2, DUPLICATE_NULLIFIER) → CampaignFrozen event in tx 0x6192c90dbe7f577e3163d50749513a231c9996a076770a1e4f6dbce916c05c26

## 4b. Attack: batch of 10 receipts, 3 forged
- 7 receipts carry valid vendor signatures and reach quorum; 3 are signed by an unregistered key → vendorAttest reverts NotRegisteredVendor
- Verifier 3 (colluding) attests forged receipt #9 anyway
- Verifier 1 challenged all 3; challenges upheld → 3/10 rejected = 30% (threshold 20%)
- Verifier 3 slashed: bond 10.0 → 5.0 mUSD; below the minimum it can no longer vote (active=false)
- Forged ratio above threshold → verifiers 1 and 2 voted triggerFreeze(1, FORGED_RATIO), tx 0xdb1b2bbf05074e79e7d04b98d1e1628f03939dce627adcb5a4173155960e2fbc

## 5. Escrow frozen
- Tranche 1 release on campaign #1 → reverted CampaignFrozen
- New deposit into campaign #1 → reverted CampaignFrozen
- NGO tries to unfreeze → reverted NotVerifier (no single EOA can unfreeze)
- Donor of campaign #2 refunded 25.0 mUSD via the freeze refund path
- Campaign #1: deposited 50.0, released 20.0, frozen=true, reason=2

## Result
| Check | Outcome |
|---|---|
| Honest tranche released after vendor signature + 2/3 quorum + delivery root | PASS |
| Cross-campaign receipt reuse blocked by global nullifier | PASS |
| Forged receipts rejected (30% > 20%) and campaign frozen | PASS |
| Colluding verifier slashed | PASS |
| Frozen escrow blocks releases and deposits; refund path open | PASS |

Known limitations (see SECURITY.md and reports/test-report.md): the nullifier is now derived on-chain, so resubmitting the same invoice fields under any nullifier is blocked, but an altered invoice document still hashes to a fresh nullifier (oracle problem). Freezes need two verifier votes; the forged-ratio rule itself runs off-chain. Challenge resolution and slashing are still owner-gated; chain B is simulated on one network.
