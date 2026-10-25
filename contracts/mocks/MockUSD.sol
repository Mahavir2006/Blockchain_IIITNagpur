// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSD is ERC20, Ownable {
    constructor() Ownable(msg.sender) ERC20("MockUSD", "MUSD") {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
