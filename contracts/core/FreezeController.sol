// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IFreezeController.sol";
import "../interfaces/IParticipantRegistry.sol";

/**
 * @dev Freezing and unfreezing both need a quorum of active verifiers; no single account,
 * including the owner, can do either. Votes are counted per "freeze epoch": the epoch
 * advances every time a campaign is frozen or unfrozen, so votes from an earlier episode
 * never carry over to the next one.
 */
contract FreezeController is IFreezeController, ReentrancyGuard, Ownable {
    uint8 public constant FREEZE_REASON_DUPLICATE_NULLIFIER = 1;
    uint8 public constant FREEZE_REASON_FORGED_RATIO = 2;
    uint8 public constant FREEZE_REASON_CATEGORY_BREACH = 3;
    uint8 public constant FREEZE_REASON_QUORUM_CHALLENGE = 4;
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    uint256 public constant MIN_QUORUM = 2;

    mapping(uint256 => bool) public frozen;
    mapping(uint256 => uint8) public freezeReason;
    mapping(uint256 => uint256) public freezeEpoch;
    // campaignId => epoch => voter => voted
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public freezeVoted;
    mapping(uint256 => mapping(uint256 => uint256)) public freezeVoteCount;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public unfreezeVoted;
    mapping(uint256 => mapping(uint256 => uint256)) public unfreezeVoteCount;

    address public immutable participantRegistry;
    uint256 public requiredUnfreezeVotes;
    uint256 public requiredFreezeVotes;
    uint256 public forgedEvidenceThreshold; // e.g. 20 means 20%

    constructor(address _participantRegistry)
        Ownable(msg.sender)
    {
        require(_participantRegistry != address(0), "InvalidRegistry");
        participantRegistry = _participantRegistry;
        requiredUnfreezeVotes = 3;
        requiredFreezeVotes = MIN_QUORUM;
        forgedEvidenceThreshold = 20;
    }

    function setRequiredUnfreezeVotes(uint256 votes) public onlyOwner {
        require(votes >= MIN_QUORUM, "QuorumTooLow");
        requiredUnfreezeVotes = votes;
    }

    function setRequiredFreezeVotes(uint256 votes) public onlyOwner {
        require(votes >= MIN_QUORUM, "QuorumTooLow");
        requiredFreezeVotes = votes;
    }

    function setFreezeThreshold(uint256 threshold) public onlyOwner {
        forgedEvidenceThreshold = threshold;
    }

    /// @notice An active verifier votes to freeze; the campaign freezes when the quorum is reached.
    function triggerFreeze(uint256 campaignId, uint8 reason) public nonReentrant {
        require(reason >= FREEZE_REASON_DUPLICATE_NULLIFIER && reason <= FREEZE_REASON_QUORUM_CHALLENGE, "InvalidReason");
        require(!frozen[campaignId], "AlreadyFrozen");
        _requireActiveVerifier();

        uint256 epoch = freezeEpoch[campaignId];
        require(!freezeVoted[campaignId][epoch][msg.sender], "AlreadyVoted");
        freezeVoted[campaignId][epoch][msg.sender] = true;
        freezeVoteCount[campaignId][epoch] += 1;
        emit FreezeVoteCast(campaignId, msg.sender, false);

        if (freezeVoteCount[campaignId][epoch] >= requiredFreezeVotes) {
            frozen[campaignId] = true;
            freezeReason[campaignId] = reason;
            freezeEpoch[campaignId] = epoch + 1;
            emit CampaignFrozen(campaignId, reason);
        }
    }

    function voteUnfreeze(uint256 campaignId) public nonReentrant {
        require(frozen[campaignId], "NotFrozen");
        _requireActiveVerifier();

        uint256 epoch = freezeEpoch[campaignId];
        require(!unfreezeVoted[campaignId][epoch][msg.sender], "AlreadyVoted");
        unfreezeVoted[campaignId][epoch][msg.sender] = true;
        unfreezeVoteCount[campaignId][epoch] += 1;
        emit FreezeVoteCast(campaignId, msg.sender, true);

        if (unfreezeVoteCount[campaignId][epoch] >= requiredUnfreezeVotes) {
            frozen[campaignId] = false;
            freezeReason[campaignId] = 0;
            freezeEpoch[campaignId] = epoch + 1;
            emit CampaignUnfrozen(campaignId);
        }
    }

    function isFrozen(uint256 campaignId) public view override returns (bool) {
        return frozen[campaignId];
    }

    function getFreezeReason(uint256 campaignId) public view override returns (uint8) {
        return freezeReason[campaignId];
    }

    /// @notice Unfreeze votes cast in the current freeze episode (0 when not frozen).
    function getUnfreezeVotes(uint256 campaignId) public view override returns (uint256) {
        return frozen[campaignId] ? unfreezeVoteCount[campaignId][freezeEpoch[campaignId]] : 0;
    }

    function getRequiredUnfreezeVotes() public view override returns (uint256) {
        return requiredUnfreezeVotes;
    }

    function getFreezeThreshold() public view override returns (uint256) {
        return forgedEvidenceThreshold;
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return IParticipantRegistry(participantRegistry).hasRole(role, account);
    }

    function _requireActiveVerifier() internal view {
        IParticipantRegistry registry = IParticipantRegistry(participantRegistry);
        require(registry.hasRole(VERIFIER_ROLE, msg.sender), "NotVerifier");
        require(registry.isVerifierActive(msg.sender), "VerifierNotActive");
    }
}
