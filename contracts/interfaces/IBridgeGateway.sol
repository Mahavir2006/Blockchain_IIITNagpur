// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBridgeGateway {
    event AssetLocked(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        bytes32 messageId
    );
    event AssetMinted(
        address indexed recipient,
        address indexed token,
        uint256 amount,
        uint256 sourceChainId,
        bytes32 messageId
    );
    event MessageRelayed(bytes32 indexed messageId, uint256 indexed sourceChainId);

    function lock(
        address token,
        uint256 amount,
        uint256 destinationChainId,
        address recipient
    ) external returns (bytes32 messageId);

    function mint(
        address token,
        uint256 amount,
        address recipient,
        uint256 sourceChainId,
        bytes32 messageId
    ) external;

    function relayMessage(bytes32 messageId, uint256 sourceChainId) external;

    function isMessageProcessed(bytes32 messageId) external view returns (bool);
    function getLockedAmount(address token, uint256 chainId) external view returns (uint256);
}
