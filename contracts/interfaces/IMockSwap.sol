// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockSwap {
    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function setRate(uint256 rateNumerator, uint256 rateDenominator) external;
    function swap(address tokenIn, address tokenOut, uint256 amountIn) external;
    function getRate() external view returns (uint256 numerator, uint256 denominator);
}
