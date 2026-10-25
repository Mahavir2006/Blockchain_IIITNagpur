// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICampaignEscrow {
    event DepositReceived(address indexed donor, uint256 indexed campaignId, uint256 amount);
    event CampaignCreated(uint256 indexed campaignId, address indexed ngo, bytes32 category);
    event CampaignFrozen(uint256 indexed campaignId);
    event CampaignUnfrozen(uint256 indexed campaignId);
    event TrancheReleased(uint256 indexed campaignId, uint256 trancheIndex, uint256 amount);
    event Refunded(address indexed donor, uint256 indexed campaignId, uint256 amount);

    function createCampaign(
        bytes32 category,
        uint256 target,
        uint256 expiry,
        uint256[] calldata trancheAmounts,
        uint256[] calldata trancheReleaseConditions
    ) external returns (uint256 campaignId);

    function deposit(uint256 campaignId, uint256 amount) external;

    function requestTrancheRelease(uint256 campaignId, uint256 trancheIndex) external;

    function refundDonor(uint256 campaignId, address donor) external;

    function isFrozen(uint256 campaignId) external view returns (bool);
    function getCampaign(uint256 campaignId) external view returns (
        address ngo,
        bytes32 category,
        uint256 target,
        uint256 totalDeposited,
        uint256 totalReleased,
        uint256 expiry,
        bool frozen,
        uint256 nextTrancheIndex
    );
}
