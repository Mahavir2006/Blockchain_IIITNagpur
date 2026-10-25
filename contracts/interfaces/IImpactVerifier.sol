// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IImpactVerifier {
    event DeliveryRootPublished(uint256 indexed campaignId, bytes32 indexed root);
    event DeliveryVerified(uint256 indexed campaignId, bytes32 indexed leaf);

    function publishDeliveryRoot(uint256 campaignId, bytes32 root) external;
    function verifyDelivery(uint256 campaignId, bytes32 leaf, bytes32[] calldata proof) external view returns (bool);
    function getDeliveryRoot(uint256 campaignId) external view returns (bytes32);
    function getRootBlock(uint256 campaignId) external view returns (uint256);
}
