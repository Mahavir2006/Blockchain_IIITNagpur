// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IParticipantRegistry {
    event RoleGranted(bytes32 indexed role, address indexed account);
    event RoleRevoked(bytes32 indexed role, address indexed account);
    event BondStaked(address indexed verifier, uint256 amount);
    event BondSlashed(address indexed verifier, uint256 amount);
    event BondWithdrawn(address indexed verifier, uint256 amount);

    function registerNGO() external;
    function registerVendor(address signingAddress) external;
    function registerVerifier() external;
    function stakeBond(uint256 amount) external;
    function slashBond(address verifier, uint256 amount) external;
    function withdrawBond(uint256 amount) external;

    function hasRole(bytes32 role, address account) external view returns (bool);
    function isVerifierActive(address verifier) external view returns (bool);
    function getVendorSigningAddress(address vendor) external view returns (address);
    function getVerifierBond(address verifier) external view returns (uint256);
    function getVerifierNonce(address verifier) external view returns (uint256);
    function incrementVerifierNonce(address verifier) external;
}
