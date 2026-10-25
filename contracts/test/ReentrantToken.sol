// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only ERC-20 that re-enters a target contract when it sends tokens.
contract ReentrantToken is ERC20 {
    address public hookFrom;
    address public target;
    bytes public payload;
    bool public reentered;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address _hookFrom, address _target, bytes calldata _payload) external {
        hookFrom = _hookFrom;
        target = _target;
        payload = _payload;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == hookFrom && target != address(0) && !reentered) {
            reentered = true;
            (bool ok, ) = target.call(payload);
            reentrySucceeded = ok;
        }
    }
}
