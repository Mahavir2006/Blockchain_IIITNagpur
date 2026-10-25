# CASCADE '26 — Theme 4 · Problem 2
# THE BLACK HOLE LEDGER: VERIFIABLE NGO FUND FLOWS

**Event:** CASCADE '26 (Elevate × CRISPR) · 24-Hour Offline Hackathon · IIIT Nagpur · TantraFiesta 2026
**Dates:** 25–26 October 2026
**Theme:** 4 — Information Asymmetry
**Theme core idea:** Give ordinary people the information that institutions already have, and make it impossible for that information to be hidden again.
**Prize pool (event):** 2,00,000 INR

---

## 1. Context (as stated in the problem)

- Donors send millions to NGOs but have **no independently verifiable way** to track whether contributions reached their intended destination.
- Current systems assume financial reports and self-published impact metrics are truthful, leaving donors dependent on the organization's own claims.
- Transactions, expense records, and impact reports are **completely disconnected**.

---

## 2. Challenge (as stated in the problem)

Design a **decentralized donation-tracking system** that establishes an **auditable connection between donated funds, authorized spending, and supporting evidence**, **without exposing beneficiaries' sensitive information**.

The system must **passively accept complex, multi-hop financial flows**, such as:

> "A 50 ETH donation earmarked for 'water infrastructure' is swapped, bridged, and supposedly spent off-chain via local fiat vendors,"

and **reconstruct a traceable, verifiable timeline of impact**.

---

## 3. What the system must autonomously handle

| # | Requirement | Explicit description from the problem |
|---|-------------|----------------------------------------|
| 1 | **Purpose-bound allocation** | Using smart contracts to manage earmarked funds and enforce agreed disbursement conditions. |
| 2 | **Verifiable expenditure records** | Linking outgoing on-chain transactions to off-chain invoices/receipts using cryptographic commitments. |
| 3 | **Privacy protection** | Shielding beneficiaries' identities and sensitive documents from the public blockchain while maintaining mathematical proof of delivery. |
| 4 | **Discrepancy detection** | Flagging unexplained transfers, spending outside declared categories, or inconsistencies between published reports and recorded transactions. |

---

## 4. Adversarial scenario (must also survive)

The system must also **track funds across multiple chains and off-chain fiat off-ramps** while an **adversarial NGO**:

1. Tries to **double-count a single piece of off-chain expenditure evidence** across multiple donor reports, and
2. **Deliberately forges 30% of its receipts**.

The system must:
- **Detect the cryptographic duplication**, and
- **Freeze escrow disbursements**
- **Without relying on a centralized auditor.**

---

## 5. Probabilistic evaluation chain

```
Inbound Donation  →  Escrow Condition  →  Off-Chain Invoice Proof
                                                   │
                                                   ▼
                                   Cryptographic Impact Verification
```

---

## 6. Plain-language summary

Build a system where:
- Donations sit in **smart-contract escrow**, earmarked for a purpose.
- Funds are released only against **cryptographically committed proof of spending**.
- **Beneficiary privacy** is preserved while delivery remains provable.
- **Multi-hop, multi-chain, fiat off-ramp flows** are reconstructed into a verifiable impact timeline.
- **Duplicate evidence and forged receipts are detected**, and escrow is **frozen automatically**, with **no central auditor**.

---

## 7. Implied requirements (my analysis, not explicitly stated)

- An **ingestion and reconciliation backend**: "passively accept" multi-hop flows implies indexing multiple chains, normalizing data, and rebuilding timelines.
- A **global evidence-uniqueness registry** (commitment/nullifier-based) to stop one receipt being claimed in multiple donor reports.
- A **forgery-detection mechanism that does not need a central auditor** (e.g. vendor-signed attestations, independent verifier nodes, statistical/anomaly checks, cross-donor consistency).
- **Decentralized freeze logic** (contract rule or watcher quorum), not an admin switch.
- **Each stage of the evaluation chain should output a confidence/verification status**, not just pass/fail, since the chain is labeled "probabilistic".
- The **oracle problem** needs an explicit answer: cryptography proves a receipt wasn't altered, not that it was real.
- A **demo-able red-team scenario**: duplicate receipt + forged batch → detection → escrow freeze.

## 8. Likely deliverables (my analysis)

1. Escrow and disbursement smart contracts
2. Evidence commitment and dedup registry
3. Multi-chain indexer and flow-reconstruction backend
4. Beneficiary privacy layer
5. Discrepancy/fraud detection engine with auto-freeze
6. Donor-facing dashboard showing the verifiable timeline
7. Adversarial simulation demo

## 9. Out of scope / safe to mock (my analysis)

- Production-grade bridge or swap implementation (simulate multi-chain)
- Real fiat integration (mock off-ramps and vendor invoices)
- Full ZK coverage everywhere (a focused, working slice beats a broad, fake one in 24 hours)

---

## 10. Relevant event rules

- Teams must consist of **3–4 members** with accurate registration details.
- All submissions must be **original or appropriately credited**; plagiarism is prohibited.
- Multiple theme participation and prize stacking are permitted, subject to eligibility.
- Self-voting in the Stars system is prohibited.
- Participants must follow organiser instructions and maintain respectful conduct.
- Judges' decisions are final, subject to the official event rules.

## 11. Contacts (from the brief)

| Role | Name | Phone | Email |
|------|------|-------|-------|
| Event Lead | Arnav Bansal | +91 8595537494 | bt25cse001@iiitn.ac.in |
| Event Lead | Rakshit Jain | +91 7877778284 | bt25csa047@iiitn.ac.in |
| Co-Lead | Aviral Joshi | +91 8858654321 | bt25cse015@iiitn.ac.in |
| Club Lead | Krushna Mali | +91 8530296969 | bt25csd037@iiitn.ac.in |
| Club Lead | Yash Gaikwad | +91 9892198168 | bt25cse047@iiitn.ac.in |
