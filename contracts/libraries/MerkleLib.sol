// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Leaves and internal nodes are hashed with different one-byte prefixes
 * (0x00 for leaves, 0x01 for nodes), so an internal node or the root can never be
 * presented as a delivery leaf (second-preimage protection). Pairs are hashed in sorted order.
 */
library MerkleLib {
    bytes1 internal constant LEAF_PREFIX = 0x00;
    bytes1 internal constant NODE_PREFIX = 0x01;

    function leafHash(bytes32 leaf) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(LEAF_PREFIX, leaf));
    }

    function nodeHash(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(NODE_PREFIX, a, b)) : keccak256(abi.encodePacked(NODE_PREFIX, b, a));
    }

    function verifyProof(bytes32 root, bytes32 leaf, bytes32[] memory proof) internal pure returns (bool) {
        bytes32 computedHash = leafHash(leaf);
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = nodeHash(computedHash, proof[i]);
        }
        return computedHash == root;
    }
}
