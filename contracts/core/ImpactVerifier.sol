// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IImpactVerifier.sol";
import "../interfaces/ICampaignEscrow.sol";
import "../libraries/MerkleLib.sol";

contract ImpactVerifier is IImpactVerifier, ReentrancyGuard {
    mapping(uint256 => bytes32) public deliveryRoot;
    mapping(uint256 => uint256) public rootBlock;

    address public immutable deployer;
    ICampaignEscrow public escrow;

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time wiring to the escrow that owns campaign NGO assignments.
    function setEscrow(address _escrow) public {
        require(msg.sender == deployer, "NotDeployer");
        require(address(escrow) == address(0), "AlreadySet");
        require(_escrow != address(0), "InvalidEscrow");
        escrow = ICampaignEscrow(_escrow);
    }

    function publishDeliveryRoot(uint256 campaignId, bytes32 root) public nonReentrant {
        require(root != bytes32(0), "InvalidRoot");
        require(address(escrow) != address(0), "EscrowNotSet");
        (address ngo, , , , , , , ) = escrow.getCampaign(campaignId); // reverts CampaignNotFound
        require(msg.sender == ngo, "NotCampaignNGO");
        deliveryRoot[campaignId] = root;
        rootBlock[campaignId] = block.timestamp;
        emit DeliveryRootPublished(campaignId, root);
    }

    function verifyDelivery(
        uint256 campaignId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) public view override returns (bool) {
        bytes32 root = deliveryRoot[campaignId];
        require(root != bytes32(0), "RootNotFound");
        return MerkleLib.verifyProof(root, leaf, proof);
    }

    function getDeliveryRoot(uint256 campaignId) public view override returns (bytes32) {
        return deliveryRoot[campaignId];
    }

    function getRootBlock(uint256 campaignId) public view override returns (uint256) {
        return rootBlock[campaignId];
    }
}
