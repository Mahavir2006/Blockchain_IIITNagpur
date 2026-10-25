// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFreezeController {
    event CampaignFrozen(uint256 indexed campaignId, uint8 indexed reason);
    event CampaignUnfrozen(uint256 indexed campaignId);
    event FreezeVoteCast(uint256 indexed campaignId, address indexed voter, bool indexed unfreeze);

    function triggerFreeze(uint256 campaignId, uint8 reason) external;
    function voteUnfreeze(uint256 campaignId) external;
    function isFrozen(uint256 campaignId) external view returns (bool);
    function getFreezeReason(uint256 campaignId) external view returns (uint8);
    function getUnfreezeVotes(uint256 campaignId) external view returns (uint256);
    function getRequiredUnfreezeVotes() external view returns (uint256);
    function setRequiredUnfreezeVotes(uint256 votes) external;
    function getFreezeThreshold() external view returns (uint256);
    function setFreezeThreshold(uint256 threshold) external;
}
