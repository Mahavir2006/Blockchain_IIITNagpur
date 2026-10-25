// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CommitmentLib
 * @dev Library for computing evidence commitments and nullifiers.
 *
 * Commitment: keccak256(salt || invoiceHash || vendorId || amount || category || date)
 * Nullifier:  keccak256(invoiceHash || vendorId || amount || date)
 *
 * The nullifier excludes the salt so the same underlying evidence cannot be
 * reused even with a different salt. The nullifier is global across all
 * campaigns and donors.
 *
 * Honest labelling: these hashes prove integrity and non-reuse. They do NOT
 * prove that an off-chain invoice is genuine (the oracle problem).
 */
library CommitmentLib {
    /// @notice Compute the evidence commitment.
    /// @param salt Random 32-byte value chosen by the submitter.
    /// @param invoiceHash Hash of the off-chain invoice document.
    /// @param vendorId Registered vendor identifier (address).
    /// @param amount Expenditure amount in the campaign's ERC-20 unit.
    /// @param category Declared spending category.
    /// @param date Invoice date (Unix timestamp).
    /// @return commitment The on-chain commitment bytes32.
    function computeCommitment(
        bytes32 salt,
        bytes32 invoiceHash,
        address vendorId,
        uint256 amount,
        bytes32 category,
        uint256 date
    ) internal pure returns (bytes32 commitment) {
        return keccak256(abi.encodePacked(salt, invoiceHash, vendorId, amount, category, date));
    }

    /// @notice Compute the global nullifier from invoice content.
    /// @param invoiceHash Hash of the off-chain invoice document.
    /// @param vendorId Registered vendor identifier (address).
    /// @param amount Expenditure amount.
    /// @param date Invoice date (Unix timestamp).
    /// @return nullifier The global nullifier bytes32.
    function computeNullifier(
        bytes32 invoiceHash,
        address vendorId,
        uint256 amount,
        uint256 date
    ) internal pure returns (bytes32 nullifier) {
        return keccak256(abi.encodePacked(invoiceHash, vendorId, amount, date));
    }
}
