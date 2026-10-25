// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFiatOffRampAttestor {
    event FiatSettlementAttested(
        bytes32 indexed hopId,
        address indexed partner,
        uint256 amount,
        address indexed asset
    );

    function attestFiatSettlement(
        bytes32 hopId,
        uint256 amount,
        address asset,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function registerPartner(address partner) external;
    function isRegisteredPartner(address partner) external view returns (bool);
}
