# Black Hole Ledger — full-system test report

Date: 2026-10-25 (C1–C4, H1–H9 and M7, then M3–M6 fixes re-tested 2026-10-26) · Scope: smart contracts, red-team scenario, dashboard (demo mode, live-API mode, production build).

## Summary

| Area | Result |
|---|---|
| Contract test suite (`npm test`) | **96 / 96 passing** — 47 unit, 15 integration, 33 security probes (31 DEFENCE, 2 RESIDUAL, 0 EXPLOIT), 1 smoke test |
| Solidity line coverage | **97.5 %** (was 64.9 %); branches 86.4 %, functions 95.7 %; every core contract at 100 % of statements |
| Red-team (`npm run demo:redteam`) | 5 / 5 checks pass — in-process network and a live JSON-RPC node (run twice on the same chain state) |
| Dashboard build (`tsc -b && vite build`) | passes, 0 type errors |
| Dashboard browser E2E | 59 scripted functional checks pass in dev (after harness fixes); 16 re-run on the production bundle; live-API and failure paths checked by hand |
| Accessibility | WCAG AA contrast fixed; 16 route×role structural checks pass; keyboard skip link works |
| Responsive | no horizontal overflow on any route at 375 px and 768 px |
| Security findings | 20 exploits reproduced; **all 20 are fixed** (4 critical, 10 high, 6 medium), each now a DEFENCE test. 2 documented residual limits remain |
| Bugs fixed during testing | 1 environment, 13 dashboard, 3 dependency upgrades |

Funds are isolated per campaign and refunds are pro-rata. Releases need quorum-verified evidence. Only a verifier quorum can freeze or unfreeze. Verifiers are admitted by bootstrap or quorum vote, never self-appointed, and no core dependency can be swapped.

Remaining trust:
- the deployer during bootstrap;
- the owner for challenge resolution and slashing;
- the bridge relayer.

It is still an unaudited prototype; see SECURITY.md before presenting it as secure.

## 1. Contract findings

Every finding was first reproduced by an `EXPLOIT` test that passed because the attack succeeded. Each is now a `DEFENCE` test in `test/security/probes.test.ts` that asserts the attack fails.

| ID | Severity | Finding | Impact |
|---|---|---|---|
| C1 | Critical — **fixed** | Escrow pooled all campaigns; a campaign that raised 10 released 60 | Per-campaign `balance`; release above it reverts `InsufficientCampaignBalance` |
| C2 | Critical — **fixed** | Full refund after a partial release drained other campaigns | Pro-rata refund `deposit × balance / totalDeposited`, last donor takes the remainder |
| C3 | Critical — **fixed** | Tranche totals could exceed the target | `TranchesExceedTarget` |
| C4 | Critical — **fixed** | Caller-supplied nullifier let the same invoice be reused | On-chain derivation, `InvalidNullifier`; residual: an altered document hashes to a new nullifier (oracle problem, documented by a RESIDUAL test) |
| H1 | High — **fixed** | Release needed only a delivery root | Release requires quorum-verified evidence ≥ total released incl. this tranche (`InsufficientVerifiedEvidence`), per campaign |
| H2 | High — **fixed** | Anyone could publish/overwrite a root | Only the campaign's NGO (`NotCampaignNGO`); unknown campaigns revert |
| H3 | High — **fixed** | Anyone could freeze any campaign | Freeze needs a quorum of active verifiers; owner, NGOs and strangers rejected |
| H4 | High — **fixed** | Sybil verifiers at 1 wei unfroze the NGO's own campaign | Admission by bootstrap or 2-verifier vote; 10 mUSD minimum bond; NGO/vendor ⇄ verifier conflict checks |
| H5 | High — **fixed** | Owner lowered quorum to 1 and voted alone | Quorums ≥ 2 everywhere (`QuorumTooLow`); deployer holds no verifier role |
| H6 | High — **fixed** | Owner swapped the FreezeController | Immutable core references; `setContracts`/`setParticipantRegistry` removed; one-time, deployer-only wiring (`AlreadySet`, `NotDeployer`) |
| H7 | High — **fixed** | Quorum reached on non-existent evidence | Attestations read the evidence registry (`EvidenceNotFound`, `EvidenceMismatch`, `NotEvidenceVendor`) |
| H8 | High — **fixed** | Strangers burned an NGO's nullifier | Only the campaign NGO files evidence; residual: another NGO with the exact invoice data (RESIDUAL test) |
| H9 | High — **fixed** | Stranger drained bridge liquidity | Only the relayer mints/relays (`NotRelayer`) |
| M7 | High — **fixed** | Unfreeze votes carried over to the next freeze | Votes keyed by freeze epoch; earlier voters can vote again, stale counts don't count |
| M1 | Medium — **fixed** | Slashed-to-zero verifier still voted | Active only while bond ≥ minimum |
| M2 | Medium — **fixed** | Evidence for non-existent campaigns | `CampaignNotFound` |
| M3 | Medium — **fixed** | Off-ramp partners self-registered; signatures ignored | Owner registers partners; signature over attestor, chain, hop, amount, asset; one attestation per hop |
| M4 | Medium — **fixed** | `MockSwap.setRate` was public | Owner-only; zero denominator rejected at construction too |
| M5 | Medium — **fixed** | Verified evidence could not be challenged | Challenge allowed after verification; amount withdrawn from `verifiedAmount` until resolved, restored if dismissed |
| M6 | Medium — **fixed** | Leaves and internal nodes hashed identically | `0x00` leaf / `0x01` node prefixes in MerkleLib and the dashboard; root or node as "leaf" rejected |

Also noted:
- category caps are stored but never enforced (freeze reason 3 can never fire on-chain);
- no `FlowHop` event exists;
- challenge resolution and slashing are owner-gated;
- `trancheReleaseConditions` are not stored;
- verifier attestations don't require a vendor signature first.

### How the H/M fixes changed existing tests

- **Fixture:** now wires the contracts, admits the verifiers and closes the bootstrap. It also adds `freezeNow` (two verifier votes) and `verifyEvidence` (submit, vendor-sign, quorum).
- **Unit tests:** rebuilt on the fixture, because the contracts now depend on each other. Every original assertion is kept except two:
  - "owner has every role" is replaced by "owner has only admin";
  - "registering grants the verifier role" is replaced by "registering is an application".

  The AttestationVerifier unit test now attests submitted evidence instead of an id that was never filed.
- **Integration tests:** releases now back each tranche with verified evidence. Tampered vendor attestations now revert `EvidenceMismatch`, which happens before the signature check.

### Defences that hold

- **Randomised accounting invariant (new):** 3 seeds × 80 mixed operations (deposit, release, freeze, refund) across 3 campaigns. After every step, the escrow's token balance equals the sum of per-campaign balances. No donor is ever refunded more than they deposited. The test also asserts that every operation type actually ran.
- **Pro-rata rounding (new):** deposits of 10/11/12 wei with 26 wei left refund exactly 26 wei in total, with 0 stranded.

| Check | Evidence |
|---|---|
| Reentrancy on `refundDonor` and `requestTrancheRelease` via a malicious ERC-20 (`contracts/test/ReentrantToken.sol`) | re-entry attempted and blocked; balances correct |
| Owner-only admin setters, minting | non-owner calls revert |
| Unbonded verifiers cannot attest, challenge or vote; full withdrawal deactivates | reverts `VerifierNotActive` |
| Ordered tranches, no double release, expiry blocks release, refund only when frozen/expired, no double refund | integration tests |
| Vendor EIP-712 signature: forged signer, replay on another evidence id, and tampered amount all rejected | integration tests |
| Commit–reveal: wrong salt, non-owner, double reveal rejected | integration tests |
| Bridge message cannot be minted twice | probe |
| Dashboard Merkle verifier matches `ImpactVerifier.verifyDelivery` for every leaf of trees sized 1–17, plus outsider and tampered proofs | integration test runs the dashboard's own `merkle.ts` |

## 2. Red-team scenario

`scripts/redteam.ts` passes all five checks on the in-process network and twice against a live node on `127.0.0.1:8545`.

Note: that node is a pre-existing process (a WSL/VM port relay started at 14:30), not one started by these tests. The report now states that the reuse attacker is cooperative (see C4).

## 3. Dashboard

### Live-API mode (mock Phase 3 server)

- Live data replaces demo data, and the banner disappears.
- POSTs reach the expected endpoints: `/campaigns/:id/unfreeze-vote`, `/evidence/:id/approve`, `/evidence`.
- API down at load: falls back to demo data, labelled as "API at … could not be reached".
- API lost mid-session: shows a "Connection lost" banner, an error alert on the action, and the vote is not recorded, so the user can retry.

### Bugs found and fixed

| # | Bug | Fix |
|---|---|---|
| D1 | Demo figures shown **unlabelled** while connecting to a live API | Loading state; demo data only after a failed connection, always labelled |
| D2 | Failed actions gave no feedback and showed success messages | Actions return success/failure; error alert; buttons disabled while busy |
| D3 | Lost connection relabelled live data as "Demo data" | New "stale" state with its own banner |
| D4 | One viewer could cast both votes and single-handedly reach quorum / unfreeze | One vote per viewer per receipt/campaign, recorded only after success |
| D5 | **Page headings stayed invisible** (GSAP `from` run twice left opacity 0) | `fromTo` with explicit end values, scoped `matchMedia` |
| D6 | Throttled tabs left content invisible for ~13 s (GSAP lag smoothing) | `lagSmoothing(0)` |
| D7 | WebGL canvas reallocated every frame at fractional zoom (1.25×) | Integer canvas sizes |
| D8 | Reduced-motion shader never redrew on resize; visibility handler could double-loop | Shared restart handler, resize listener |
| D9 | First Tab skipped the skip link (focus forced into `<main>` on load) | Focus moves only on real route changes |
| D10 | 5 colour pairs failed WCAG AA (hint text 3.5:1, white on Orange Pepper 3.7:1) | `ink-50` → `#67605B`, `pepper-600` → `#A3460F`; all pairs ≥ 4.5:1 |
| D11 | Demo accepted donations above the goal (contract reverts `ExceedsTarget`) | Same rule in the UI |
| D12 | Hero copy claimed freezes are automatic (they are not on-chain) | Copy corrected |
| D13 | Role reset on reload; NaN risk at zero raised; no empty states; GSAP console warnings; stale success messages | Session-persisted role, guards, empty states, clean console |

### Dependencies

| Upgrade | Why |
|---|---|
| `react-router-dom` 6.26.2 → 6.30.6 | High-severity XSS/open-redirect advisories |
| `ethers` 6.13.4 → 6.17.0 | High-severity `ws` advisory |
| `postcss` → 8.5.29, `vite` → 5.4.21 | Patched builds |

Remaining advisories:

- **Vite/esbuild (dev server only):** fixing them needs Vite 6.4.4+, a major upgrade.
- **Tailwind's PostCSS plugins (build-time only).**
- **Two moderate React Router issues:** these need v7. They aren't reachable here — no user-controlled `<Link>`/`navigate` targets and no SSR.

## 4. Not covered

- **Missing Phase 2/3 pieces:** `deploy-local.ts`, `seed.ts`, `relayer.ts` and all `services/*` don't exist, so `chain:up`, `deploy:local` and `services:up` have nothing to run.
- **Two-chain flow:** the bridge is tested on one network only.
- **Lint:** `npm run lint` is broken (ESLint not installed/configured, no `.solhint.json`).
- **Cross-browser:** screen readers and real touch devices were not tested; only the Chromium-based built-in browser was used.
- **Reduced motion:** checked by code inspection (`gsap.matchMedia` guard, shader single frame, CSS fallback), not by OS-level emulation.
