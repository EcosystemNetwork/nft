// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ForgeCollection} from "../ForgeCollection.sol";

/// @notice Test-only attacker: re-enters `mint` from the ERC-721 receive hook.
contract ReentrantMinter {
    ForgeCollection public immutable target;
    bool public reentered;
    bool public attempted;

    constructor(ForgeCollection target_) {
        target = target_;
    }

    function attack(uint256 phaseId) external payable {
        target.mint{value: msg.value}(phaseId, 1, 0, new bytes32[](0));
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!attempted) {
            attempted = true;
            try target.mint(0, 1, 0, new bytes32[](0)) {
                reentered = true;
            } catch {}
        }
        return this.onERC721Received.selector;
    }
}
