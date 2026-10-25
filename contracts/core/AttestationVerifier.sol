// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAttestationVerifier.sol";
import "../interfaces/IParticipantRegistry.sol";
import "../interfaces/IEvidenceRegistry.sol";

contract AttestationVerifier is IAttestationVerifier, ReentrancyGuard, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public domainSeparator;

    uint8 public constant STATE_SUBMITTED = 0;
    uint8 public constant STATE_VENDOR_ATTESTED = 1;
    uint8 public constant STATE_QUORUM_VERIFIED = 2;
    uint8 public constant STATE_CHALLENGED = 3;
    uint8 public constant STATE_REJECTED = 4;

    mapping(uint256 => uint8) public evidenceState;
    mapping(uint256 => uint256) public attestationCount;
    mapping(uint256 => uint256) public challengeCount;
    mapping(uint256 => mapping(address => bool)) public hasVerifierAttested;
    mapping(uint256 => mapping(address => bool)) public hasVerifierChallenged;
    mapping(uint256 => address) public challengingVerifier;
    // Evidence that was already quorum-verified when it was challenged.
    mapping(uint256 => bool) public challengedAfterVerification;

    uint256 public constant MIN_QUORUM = 2;

    address public immutable participantRegistry;
    IEvidenceRegistry public evidenceRegistry;
    uint256 public requiredAttestations;
    uint256 public requiredChallenges;
    // Sum of quorum-verified evidence amounts per campaign; the escrow releases against it.
    mapping(uint256 => uint256) public override verifiedAmount;

    constructor(address _participantRegistry, uint256 _requiredAttestations, uint256 _requiredChallenges)
        Ownable(msg.sender)
    {
        require(_participantRegistry != address(0), "InvalidRegistry");
        require(_requiredAttestations >= MIN_QUORUM, "QuorumTooLow");
        participantRegistry = _participantRegistry;
        requiredAttestations = _requiredAttestations;
        requiredChallenges = _requiredChallenges;
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BlackHoleLedger"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice One-time wiring to the evidence registry.
    function setEvidenceRegistry(address _registry) public onlyOwner {
        require(address(evidenceRegistry) == address(0), "AlreadySet");
        require(_registry != address(0), "InvalidRegistry");
        evidenceRegistry = IEvidenceRegistry(_registry);
    }

    function setRequiredAttestations(uint256 count) public onlyOwner {
        require(count >= MIN_QUORUM, "QuorumTooLow");
        requiredAttestations = count;
    }

    function setRequiredChallenges(uint256 count) public onlyOwner {
        requiredChallenges = count;
    }

    function vendorAttest(
        uint256 evidenceId,
        uint256 amount,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 nonce
    ) public nonReentrant {
        require(evidenceState[evidenceId] == STATE_SUBMITTED, "InvalidState");
        (, bytes32 recordedCommitment, , , uint256 recordedAmount, , , ) = _evidence(evidenceId);
        require(amount == recordedAmount && commitment == recordedCommitment, "EvidenceMismatch");
        require(msg.sender == evidenceRegistry.getEvidenceVendor(evidenceId), "NotEvidenceVendor");

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("VendorAttestation(uint256 evidenceId,address vendor,uint256 amount,bytes32 commitment,uint256 nonce)"),
                evidenceId,
                msg.sender,
                amount,
                commitment,
                nonce
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        address signer = digest.recover(v, r, s);
        require(signer != address(0), "InvalidSignature");

        // The signature must come from the signing key registered by this evidence's vendor.
        IParticipantRegistry registry = IParticipantRegistry(participantRegistry);
        require(registry.getVendorSigningAddress(msg.sender) == signer, "NotRegisteredVendor");

        evidenceState[evidenceId] = STATE_VENDOR_ATTESTED;
        emit VendorAttested(evidenceId, signer);
    }

    function verifierAttest(uint256 evidenceId) public nonReentrant {
        require(
            evidenceState[evidenceId] == STATE_VENDOR_ATTESTED ||
            evidenceState[evidenceId] == STATE_SUBMITTED,
            "InvalidState"
        );
        (uint256 campaignId, , , , uint256 amount, , , ) = _evidence(evidenceId);
        IParticipantRegistry registry = IParticipantRegistry(participantRegistry);
        require(registry.hasRole(VERIFIER_ROLE, msg.sender), "NotVerifier");
        require(!hasVerifierAttested[evidenceId][msg.sender], "AlreadyAttested");
        require(registry.isVerifierActive(msg.sender), "VerifierNotActive");

        hasVerifierAttested[evidenceId][msg.sender] = true;
        attestationCount[evidenceId] += 1;

        if (attestationCount[evidenceId] >= requiredAttestations) {
            evidenceState[evidenceId] = STATE_QUORUM_VERIFIED;
            verifiedAmount[campaignId] += amount;
            emit QuorumVerified(evidenceId);
        }
    }

    function verifierChallenge(uint256 evidenceId) public nonReentrant {
        uint8 state = evidenceState[evidenceId];
        require(
            state == STATE_VENDOR_ATTESTED || state == STATE_SUBMITTED || state == STATE_QUORUM_VERIFIED,
            "InvalidState"
        );
        (uint256 campaignId, , , , uint256 amount, , , ) = _evidence(evidenceId);
        IParticipantRegistry registry = IParticipantRegistry(participantRegistry);
        require(registry.hasRole(VERIFIER_ROLE, msg.sender), "NotVerifier");
        require(!hasVerifierChallenged[evidenceId][msg.sender], "AlreadyChallenged");
        require(registry.isVerifierActive(msg.sender), "VerifierNotActive");

        hasVerifierChallenged[evidenceId][msg.sender] = true;
        challengeCount[evidenceId] += 1;
        challengingVerifier[evidenceId] = msg.sender;

        // Late-discovered fraud: withdraw the evidence from the campaign's verified total
        // until the challenge is resolved, so it cannot back any further release.
        if (state == STATE_QUORUM_VERIFIED) {
            challengedAfterVerification[evidenceId] = true;
            verifiedAmount[campaignId] -= amount;
        }

        evidenceState[evidenceId] = STATE_CHALLENGED;
        emit ChallengeRaised(evidenceId, msg.sender);
    }

    function resolveChallenge(uint256 evidenceId, bool upheld) public onlyOwner {
        require(evidenceState[evidenceId] == STATE_CHALLENGED, "NotChallenged");

        if (upheld) {
            evidenceState[evidenceId] = STATE_REJECTED;
        } else if (challengedAfterVerification[evidenceId]) {
            // Dismissed challenge on verified evidence: restore it and its verified amount.
            (uint256 campaignId, , , , uint256 amount, , , ) = _evidence(evidenceId);
            evidenceState[evidenceId] = STATE_QUORUM_VERIFIED;
            verifiedAmount[campaignId] += amount;
        } else {
            evidenceState[evidenceId] = STATE_VENDOR_ATTESTED;
        }
        challengedAfterVerification[evidenceId] = false;

        emit ChallengeResolved(evidenceId, upheld, challengingVerifier[evidenceId]);
    }

    /// @dev Reverts EvidenceNotFound for ids that were never submitted.
    function _evidence(uint256 evidenceId) internal view returns (
        uint256, bytes32, bytes32, address, uint256, bytes32, uint256, bool
    ) {
        require(address(evidenceRegistry) != address(0), "EvidenceRegistryNotSet");
        return evidenceRegistry.getEvidence(evidenceId);
    }

    function getEvidenceState(uint256 evidenceId) public view override returns (uint8) {
        return evidenceState[evidenceId];
    }

    function getAttestationCount(uint256 evidenceId) public view override returns (uint256) {
        return attestationCount[evidenceId];
    }

    function getChallengeCount(uint256 evidenceId) public view override returns (uint256) {
        return challengeCount[evidenceId];
    }
}
