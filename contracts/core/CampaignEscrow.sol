// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ICampaignEscrow.sol";
import "../interfaces/IFreezeController.sol";
import "../interfaces/IImpactVerifier.sol";
import "../interfaces/IAttestationVerifier.sol";

contract CampaignEscrow is ICampaignEscrow, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Campaign {
        address ngo;
        bytes32 category;
        uint256 target;
        uint256 totalDeposited;
        uint256 totalReleased;
        uint256 expiry;
        bool frozen;
        uint256 nextTrancheIndex;
        uint256[] trancheAmounts;
        bool[] trancheReleased;
        uint256 categorySpent;
        uint256 categoryCap;
        // Tokens this campaign still holds. The escrow pools every campaign in one token
        // balance, so releases and refunds must be bounded by the campaign's own share.
        uint256 balance;
    }

    struct Tranche {
        uint256 amount;
        uint256 releaseCondition;
        bool released;
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(address => uint256)) public donorBalances;
    mapping(uint256 => bool) public campaignExists;
    uint256 public nextCampaignId;

    // Core dependencies cannot be swapped after deployment, so no account can route around a freeze.
    IERC20 public immutable token;
    IFreezeController public immutable freezeController;
    IImpactVerifier public immutable impactVerifier;
    IAttestationVerifier public attestationVerifier;

    constructor(address _token, address _freezeController, address _impactVerifier)
        Ownable(msg.sender)
    {
        token = IERC20(_token);
        freezeController = IFreezeController(_freezeController);
        impactVerifier = IImpactVerifier(_impactVerifier);
        nextCampaignId = 1;
    }

    /// @notice One-time wiring to the attestation verifier (it is deployed after the escrow).
    function setAttestationVerifier(address _attestationVerifier) public onlyOwner {
        require(address(attestationVerifier) == address(0), "AlreadySet");
        require(_attestationVerifier != address(0), "InvalidAttestationVerifier");
        attestationVerifier = IAttestationVerifier(_attestationVerifier);
    }

    function createCampaign(
        bytes32 category,
        uint256 target,
        uint256 expiry,
        uint256[] calldata trancheAmounts,
        uint256[] calldata trancheReleaseConditions
    ) public returns (uint256 campaignId) {
        require(target > 0, "InvalidTarget");
        require(expiry > block.timestamp, "InvalidExpiry");
        require(trancheAmounts.length > 0, "InvalidTranches");
        require(trancheAmounts.length == trancheReleaseConditions.length, "TrancheLengthMismatch");
        uint256 trancheTotal;
        for (uint256 i = 0; i < trancheAmounts.length; i++) {
            trancheTotal += trancheAmounts[i];
        }
        require(trancheTotal <= target, "TranchesExceedTarget");

        campaignId = nextCampaignId;
        nextCampaignId += 1;

        Campaign storage c = campaigns[campaignId];
        c.ngo = msg.sender;
        c.category = category;
        c.target = target;
        c.expiry = expiry;
        c.trancheAmounts = trancheAmounts;
        c.nextTrancheIndex = 0;
        c.categoryCap = target;

        for (uint256 i = 0; i < trancheAmounts.length; i++) {
            c.trancheReleased.push(false);
        }

        campaignExists[campaignId] = true;
        emit CampaignCreated(campaignId, msg.sender, category);
        return campaignId;
    }

    function deposit(uint256 campaignId, uint256 amount) public nonReentrant {
        require(campaignExists[campaignId], "CampaignNotFound");
        require(amount > 0, "InvalidAmount");
        require(!freezeController.isFrozen(campaignId), "CampaignFrozen");

        Campaign storage c = campaigns[campaignId];
        require(c.totalDeposited + amount <= c.target, "ExceedsTarget");

        token.safeTransferFrom(msg.sender, address(this), amount);

        c.totalDeposited += amount;
        c.balance += amount;
        donorBalances[campaignId][msg.sender] += amount;

        emit DepositReceived(msg.sender, campaignId, amount);
    }

    function requestTrancheRelease(uint256 campaignId, uint256 trancheIndex) public nonReentrant {
        require(campaignExists[campaignId], "CampaignNotFound");

        Campaign storage c = campaigns[campaignId];
        require(c.ngo == msg.sender, "NotNGO");
        require(!freezeController.isFrozen(campaignId), "CampaignFrozen");
        require(trancheIndex < c.trancheAmounts.length, "InvalidTrancheIndex");
        require(!c.trancheReleased[trancheIndex], "TrancheAlreadyReleased");
        require(trancheIndex == c.nextTrancheIndex, "TrancheOutOfOrder");
        require(block.timestamp <= c.expiry, "CampaignExpired");

        uint256 trancheAmount = c.trancheAmounts[trancheIndex];
        require(trancheAmount <= c.balance, "InsufficientCampaignBalance");
        // Every unit released, including this tranche, must be backed by quorum-verified evidence.
        require(address(attestationVerifier) != address(0), "AttestationNotSet");
        require(
            attestationVerifier.verifiedAmount(campaignId) >= c.totalReleased + trancheAmount,
            "InsufficientVerifiedEvidence"
        );

        // A tranche is ready once the NGO has published a delivery-commitment root;
        // individual deliveries are then provable via ImpactVerifier.verifyDelivery.
        require(impactVerifier.getDeliveryRoot(campaignId) != bytes32(0), "TrancheNotReady");

        c.trancheReleased[trancheIndex] = true;
        c.nextTrancheIndex += 1;
        c.totalReleased += trancheAmount;
        c.balance -= trancheAmount;

        token.safeTransfer(c.ngo, trancheAmount);

        emit TrancheReleased(campaignId, trancheIndex, trancheAmount);
    }

    function refundDonor(uint256 campaignId, address donor) public nonReentrant {
        require(campaignExists[campaignId], "CampaignNotFound");

        Campaign storage c = campaigns[campaignId];
        require(freezeController.isFrozen(campaignId) || block.timestamp > c.expiry, "NotRefundable");

        uint256 donorBalance = donorBalances[campaignId][donor];
        require(donorBalance > 0, "NoBalance");

        // Pro-rata share of what the campaign still holds: released tranches are already
        // spent, so each donor bears them in proportion to their deposit. The ratio
        // balance / totalDeposited is unchanged by each refund, so later donors get the same rate.
        // The last donor out takes the exact remainder so rounding dust is never stranded.
        uint256 payout = donorBalance == c.totalDeposited
            ? c.balance
            : (donorBalance * c.balance) / c.totalDeposited;

        donorBalances[campaignId][donor] = 0;
        c.totalDeposited -= donorBalance;
        c.balance -= payout;

        if (payout > 0) {
            token.safeTransfer(donor, payout);
        }

        emit Refunded(donor, campaignId, payout);
    }

    function isFrozen(uint256 campaignId) public view override returns (bool) {
        return freezeController.isFrozen(campaignId);
    }

    function getCampaign(uint256 campaignId) public view override returns (
        address ngo,
        bytes32 category,
        uint256 target,
        uint256 totalDeposited,
        uint256 totalReleased,
        uint256 expiry,
        bool frozen,
        uint256 nextTrancheIndex
    ) {
        require(campaignExists[campaignId], "CampaignNotFound");
        Campaign storage c = campaigns[campaignId];
        return (
            c.ngo,
            c.category,
            c.target,
            c.totalDeposited,
            c.totalReleased,
            c.expiry,
            freezeController.isFrozen(campaignId),
            c.nextTrancheIndex
        );
    }
}
