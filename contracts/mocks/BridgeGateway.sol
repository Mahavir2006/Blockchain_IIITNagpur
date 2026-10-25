// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IBridgeGateway.sol";

contract BridgeGateway is IBridgeGateway {
    using SafeERC20 for IERC20;

    mapping(bytes32 => bool) public processedMessages;
    mapping(address => mapping(uint256 => uint256)) public lockedAmounts;
    uint256 public messageNonce;

    address public immutable relayer;

    constructor() {
        relayer = msg.sender;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "NotRelayer");
        _;
    }

    function lock(
        address token,
        uint256 amount,
        uint256 destinationChainId,
        address recipient
    ) public returns (bytes32 messageId) {
        require(amount > 0, "ZeroAmount");
        messageNonce += 1;
        messageId = keccak256(abi.encodePacked(messageNonce, block.timestamp, msg.sender, token, amount, destinationChainId, recipient));
        require(!processedMessages[messageId], "MessageAlreadyExists");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        lockedAmounts[token][destinationChainId] += amount;

        emit AssetLocked(msg.sender, token, amount, destinationChainId, recipient, messageId);
        return messageId;
    }

    function mint(
        address token,
        uint256 amount,
        address recipient,
        uint256 sourceChainId,
        bytes32 messageId
    ) public onlyRelayer {
        require(!processedMessages[messageId], "MessageAlreadyProcessed");
        require(lockedAmounts[token][sourceChainId] >= amount, "NotLocked");

        processedMessages[messageId] = true;
        lockedAmounts[token][sourceChainId] -= amount;

        IERC20(token).safeTransfer(recipient, amount);

        emit AssetMinted(recipient, token, amount, sourceChainId, messageId);
    }

    function relayMessage(bytes32 messageId, uint256 sourceChainId) public onlyRelayer {
        require(!processedMessages[messageId], "MessageAlreadyProcessed");
        processedMessages[messageId] = true;
        emit MessageRelayed(messageId, sourceChainId);
    }

    function isMessageProcessed(bytes32 messageId) public view override returns (bool) {
        return processedMessages[messageId];
    }

    function getLockedAmount(address token, uint256 chainId) public view override returns (uint256) {
        return lockedAmounts[token][chainId];
    }
}
