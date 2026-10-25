# Phase 0 — Design: Contract Interaction Diagram

```mermaid
flowchart TD
    %% Actors
    Donor[Donor]:::actor
    NGO[NGO]:::actor
    Vendor[Vendor]:::actor
    Verifier[Staked Verifier xN]:::actor
    Relayer[Relayer script]:::actor

    %% Core contracts
    PR[ParticipantRegistry]:::contract
    CE[CampaignEscrow]:::contract
    ER[EvidenceRegistry]:::contract
    AV[AttestationVerifier]:::contract
    FC[FreezeController]:::contract
    IV[ImpactVerifier]:::contract

    %% Mocks
    USD[MockUSD]:::mock
    SW[MockSwap]:::mock
    BG[BridgeGateway A+B]:::mock
    FOR[FiatOffRampAttestor]:::mock

    %% Off-chain
    Indexer[Chain Indexer SQLite]:::service
    RE[Flow Reconstruction]:::service
    DE[Discrepancy Detection]:::service
    SC[Probabilistic Scoring]:::service
    API[Express API]:::service
    VN[Verifier-Node watcher]:::service
    Dash[Donor Dashboard React]:::service

    %% Donation flow
    Donor -->|deposit ERC-20| CE
    CE -->|event| Indexer
    CE -->|lock funds| USD

    %% NGO/vendor registration
    NGO -->|register role| PR
    Vendor -->|register signing addr| PR
    Verifier -->|stake bond ERC-20| PR
    PR -->|bond transfer| USD

    %% Evidence flow
    NGO -->|commitment + nullifier| ER
    ER -->|nullifier check global| ER
    Vendor -->|EIP-712 signature| AV
    Verifier -->|attest / challenge M-of-N| AV
    AV -->|state change| ER
    AV -->|challenge bond slash/reward| PR

    %% Impact / privacy
    NGO -->|Merkle root of delivery commitments| IV
    IV -->|verifyDelivery leaf+proof| IV

    %% Freeze
    ER -->|DuplicateEvidenceDetected| FC
    AV -->|quorum-upheld challenge| FC
    CE -->|category cap breach attempt| FC
    PR -->|forged-evidence ratio > threshold| FC
    FC -->|halt disbursements| CE
    FC -->|unfreeze only via quorum vote or expiry/refund| CE

    %% Release
    CE -->|tranche release| USD
    IV -->|impact score feeds release condition| CE

    %% Cross-chain mocks
    CE -->|swap ERC-20| SW
    SW -->|lock on chain A| BG
    BG -->|relayer message| Relayer
    Relayer -->|mint on chain B| BG
    BG -->|off-ramp attestation| FOR
    FOR -->|EIP-712 signature| AV

    %% Off-chain services
    Indexer -->|persist events| RE
    RE -->|timeline edges| DE
    DE -->|discrepancies + forgery score| SC
    SC -->|composite confidence| API
    API -->|timeline/scores/state| Dash
    VN -->|independent check + attest/challenge| AV
    VN -->|independent check + attest/challenge| CE

    classDef actor fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef contract fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef mock fill:#f3e5f5,stroke:#4a148c,stroke-width:2px,stroke-dasharray: 5 5;
    classDef service fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px;
```

## 3. Contract Responsibility Table

| Contract | Responsibility | Key external functions | Key events | Key custom errors |
|---|---|---|---|---|
| ParticipantRegistry | Roles + staked verifier bonds | `registerNGO`, `registerVendor`, `registerVerifier`, `stakeBond`, `slashBond` | `RoleGranted`, `RoleRevoked`, `BondStaked`, `BondSlashed` | `NotAuthorized`, `InsufficientBond`, `AlreadyRegistered` |
| CampaignEscrow | Purpose-bound escrow, tranche release, refunds | `deposit`, `createCampaign`, `requestTrancheRelease`, `refundDonor` | `DepositReceived`, `CampaignCreated`, `TrancheReleased`, `CampaignFrozen`, `Refunded` | `CampaignFrozen`, `InsufficientFunds`, `TrancheNotReady` |
| EvidenceRegistry | Commitments + global nullifier dedup | `submitEvidence`, `revealEvidence` | `EvidenceSubmitted`, `DuplicateEvidenceDetected` | `DuplicateNullifier`, `InvalidCommitment` |
| AttestationVerifier | Vendor EIP-712 attestations + verifier quorum | `vendorAttest`, `verifierAttest`, `verifierChallenge` | `VendorAttested`, `QuorumVerified`, `ChallengeRaised`, `ChallengeResolved` | `InvalidSignature`, `QuorumNotReached`, `AlreadyChallenged` |
| FreezeController | Auto-freeze, no admin switch | `triggerFreeze`, `voteUnfreeze`, `isFrozen` | `CampaignFrozen`, `CampaignUnfrozen` | `NotFrozen`, `AlreadyFrozen`, `InsufficientVotes` |
| ImpactVerifier | Merkle root of delivery commitments, selective disclosure | `publishDeliveryRoot`, `verifyDelivery` | `DeliveryRootPublished`, `DeliveryVerified` | `InvalidProof`, `RootNotFound` |
| MockUSD | Mock stable ERC-20 | `mint`, `transfer`, `approve` | `Transfer`, `Approval` | (ERC-20 standard) |
| MockSwap | Mock ERC-20↔ERC-20 swap | `swap` | `SwapExecuted` | `InsufficientLiquidity` |
| BridgeGateway | Lock/mint bridge pair on two chains | `lock`, `mint`, `relayMessage` | `AssetLocked`, `AssetMinted`, `MessageRelayed` | `NotLocked`, `InvalidMessage` |
| FiatOffRampAttestor | Mock fiat settlement attestation | `attestFiatSettlement` | `FiatSettlementAttested` | `NotAuthorizedPartner` |

## 4. Access Control

- `ParticipantRegistry` uses OpenZeppelin `AccessControl` with roles: `NGO_ROLE`, `VENDOR_ROLE`, `VERIFIER_ROLE`, `DONOR_ROLE`
- Verifiers must stake an ERC-20 bond (`MockUSD`) to be active; stake is slashable on failed challenge
- Vendors register a signing address used for EIP-712 signature verification
- No single EOA can freeze or unfreeze; unfreeze requires verifier-quorum vote or expiry/refund path
- `ReentrancyGuard` on all state-changing external functions; checks-effects-interactions pattern throughout
- `SafeERC20` for all ERC-20 interactions
- `tx.origin` never used; `block.timestamp` never used for randomness