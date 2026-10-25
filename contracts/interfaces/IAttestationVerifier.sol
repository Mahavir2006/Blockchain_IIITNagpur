// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAttestationVerifier {
    struct Attestation {
        uint256 evidenceId;
        address vendor;
        uint256 amount;
        bytes32 commitment;
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 nonce;
    }

    event VendorAttested(uint256 indexed evidenceId, address indexed vendor);
    event QuorumVerified(uint256 indexed evidenceId);
    event ChallengeRaised(uint256 indexed evidenceId, address indexed challenger);
    event ChallengeResolved(
        uint256 indexed evidenceId,
        bool upheld,
        address indexed slashed
    );

    function vendorAttest(
        uint256 evidenceId,
        uint256 amount,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 nonce
    ) external;

    function verifierAttest(uint256 evidenceId) external;

    function verifierChallenge(uint256 evidenceId) external;

    function getEvidenceState(uint256 evidenceId) external view returns (uint8);
    function getAttestationCount(uint256 evidenceId) external view returns (uint256);
    function getChallengeCount(uint256 evidenceId) external view returns (uint256);
    function verifiedAmount(uint256 campaignId) external view returns (uint256);
}
