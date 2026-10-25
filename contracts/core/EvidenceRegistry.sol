// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IEvidenceRegistry.sol";
import "../interfaces/ICampaignEscrow.sol";
import "../libraries/CommitmentLib.sol";

contract EvidenceRegistry is IEvidenceRegistry, ReentrancyGuard {
    mapping(bytes32 => uint256) public nullifierToEvidenceId;
    mapping(bytes32 => bool) public usedNullifiers;
    mapping(uint256 => bool) public evidenceExists;

    struct Evidence {
        uint256 campaignId;
        bytes32 commitment;
        bytes32 nullifier;
        address ngo;
        bytes32 invoiceHash;
        address vendorId;
        uint256 amount;
        bytes32 category;
        uint256 date;
        bytes32 salt;
        bool revealed;
        uint256 submittedAt;
    }

    mapping(uint256 => Evidence) public evidenceById;
    mapping(uint256 => uint256[]) public campaignEvidenceIds;
    uint256 public nextEvidenceId;

    address public immutable deployer;
    ICampaignEscrow public escrow;

    constructor() {
        nextEvidenceId = 1;
        deployer = msg.sender;
    }

    /// @notice One-time wiring to the escrow that owns campaign NGO assignments.
    function setEscrow(address _escrow) public {
        require(msg.sender == deployer, "NotDeployer");
        require(address(escrow) == address(0), "AlreadySet");
        require(_escrow != address(0), "InvalidEscrow");
        escrow = ICampaignEscrow(_escrow);
    }

    function submitEvidence(
        uint256 campaignId,
        bytes32 commitment,
        bytes32 nullifier,
        bytes32 invoiceHash,
        address vendorId,
        uint256 amount,
        bytes32 category,
        uint256 date,
        bytes32 salt
    ) public nonReentrant returns (uint256 evidenceId) {
        require(address(escrow) != address(0), "EscrowNotSet");
        (address ngo, , , , , , , ) = escrow.getCampaign(campaignId); // reverts CampaignNotFound
        require(msg.sender == ngo, "NotCampaignNGO");
        // The nullifier must be derived from the invoice fields, so the same invoice can never
        // be resubmitted under a different nullifier (salt and category are deliberately excluded).
        require(nullifier == CommitmentLib.computeNullifier(invoiceHash, vendorId, amount, date), "InvalidNullifier");
        require(usedNullifiers[nullifier] == false, "DuplicateNullifier");

        usedNullifiers[nullifier] = true;
        nullifierToEvidenceId[nullifier] = nextEvidenceId;

        evidenceId = nextEvidenceId;
        nextEvidenceId += 1;

        Evidence storage e = evidenceById[evidenceId];
        e.campaignId = campaignId;
        e.commitment = commitment;
        e.nullifier = nullifier;
        e.ngo = msg.sender;
        e.invoiceHash = invoiceHash;
        e.vendorId = vendorId;
        e.amount = amount;
        e.category = category;
        e.date = date;
        e.salt = salt;
        e.revealed = false;
        e.submittedAt = block.timestamp;

        evidenceExists[evidenceId] = true;
        campaignEvidenceIds[campaignId].push(evidenceId);

        emit EvidenceSubmitted(campaignId, commitment, nullifier, msg.sender);
        return evidenceId;
    }

    function revealEvidence(uint256 evidenceId, bytes32 salt) public nonReentrant {
        require(evidenceExists[evidenceId], "EvidenceNotFound");
        require(!evidenceById[evidenceId].revealed, "AlreadyRevealed");
        require(evidenceById[evidenceId].ngo == msg.sender, "NotOwner");

        bytes32 computedCommitment = CommitmentLib.computeCommitment(
            salt,
            evidenceById[evidenceId].invoiceHash,
            evidenceById[evidenceId].vendorId,
            evidenceById[evidenceId].amount,
            evidenceById[evidenceId].category,
            evidenceById[evidenceId].date
        );

        require(computedCommitment == evidenceById[evidenceId].commitment, "InvalidCommitment");

        evidenceById[evidenceId].revealed = true;
    }

    function getEvidenceVendor(uint256 evidenceId) public view override returns (address) {
        require(evidenceExists[evidenceId], "EvidenceNotFound");
        return evidenceById[evidenceId].vendorId;
    }

    function isNullifierUsed(bytes32 nullifier) public view override returns (bool) {
        return usedNullifiers[nullifier];
    }

    function getEvidence(uint256 evidenceId) public view override returns (
        uint256 campaignId,
        bytes32 commitment,
        bytes32 nullifier,
        address ngo,
        uint256 amount,
        bytes32 category,
        uint256 date,
        bool revealed
    ) {
        require(evidenceExists[evidenceId], "EvidenceNotFound");
        Evidence storage e = evidenceById[evidenceId];
        return (
            e.campaignId,
            e.commitment,
            e.nullifier,
            e.ngo,
            e.amount,
            e.category,
            e.date,
            e.revealed
        );
    }
}
