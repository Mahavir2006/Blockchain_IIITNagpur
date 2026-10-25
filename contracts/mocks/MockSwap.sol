// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IMockSwap.sol";

contract MockSwap is IMockSwap, Ownable {
    using SafeERC20 for IERC20;

    uint256 public rateNumerator;
    uint256 public rateDenominator;

    constructor(uint256 _num, uint256 _den) Ownable(msg.sender) {
        require(_den > 0, "ZeroDenominator");
        rateNumerator = _num;
        rateDenominator = _den;
    }

    function setRate(uint256 _num, uint256 _den) public onlyOwner {
        require(_den > 0, "ZeroDenominator");
        rateNumerator = _num;
        rateDenominator = _den;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn) public {
        require(amountIn > 0, "ZeroAmount");
        uint256 amountOut = (amountIn * rateNumerator) / rateDenominator;
        require(amountOut > 0, "ZeroOutput");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    function getRate() public view returns (uint256, uint256) {
        return (rateNumerator, rateDenominator);
    }
}
