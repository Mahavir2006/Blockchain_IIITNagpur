// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IFiatOffRampAttestor.sol";

/**
 * @dev A settlement is accepted only with a signature from a partner the owner registered.
 * The signed statement binds this contract, the chain, the hop, the amount and the asset, and
 * each hop can be attested once, so signatures cannot be replayed or reused for other hops.
 * Anyone may submit a partner's signed statement.
 */
contract FiatOffRampAttestor is IFiatOffRampAttestor, Ownable {
    mapping(address => bool) public registeredPartners;
    mapping(bytes32 => bool) public attestedHops;

    constructor() Ownable(msg.sender) {}

    function registerPartner(address partner) public onlyOwner {
        require(partner != address(0), "InvalidPartner");
        registeredPartners[partner] = true;
    }

    /// @notice The hash a partner signs (as an EIP-191 personal message) to attest a settlement.
    function settlementHash(bytes32 hopId, uint256 amount, address asset) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, hopId, amount, asset));
    }

    function attestFiatSettlement(
        bytes32 hopId,
        uint256 amount,
        address asset,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(amount > 0, "ZeroAmount");
        require(!attestedHops[hopId], "AlreadyAttested");
        // EIP-191 personal-message prefix, built inline (OZ MessageHashUtils needs the Cancun mcopy opcode).
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", settlementHash(hopId, amount, asset)));
        address partner = ECDSA.recover(digest, v, r, s);
        require(registeredPartners[partner], "NotAuthorizedPartner");

        attestedHops[hopId] = true;
        emit FiatSettlementAttested(hopId, partner, amount, asset);
    }

    function isRegisteredPartner(address partner) public view override returns (bool) {
        return registeredPartners[partner];
    }
}
