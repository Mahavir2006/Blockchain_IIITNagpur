// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEvidenceRegistry {
    event EvidenceSubmitted(
        uint256 indexed campaignId,
        bytes32 indexed commitment,
        bytes32 nullifier,
        address indexed ngo
    );
    event DuplicateEvidenceDetected(
        uint256 indexed campaignIdA,
        uint256 indexed campaignIdB,
        bytes32 nullifier
    );
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
    ) external returns (uint256 evidenceId);
    function revealEvidence(uint256 evidenceId, bytes32 salt) external;
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
    function getEvidenceVendor(uint256 evidenceId) external view returns (address);
    function getEvidence(uint256 evidenceId) external view returns (
        uint256 campaignId,
        bytes32 commitment,
        bytes32 nullifier,
        address ngo,
        uint256 amount,
        bytes32 category,
        uint256 date,
        bool revealed
    );
}
