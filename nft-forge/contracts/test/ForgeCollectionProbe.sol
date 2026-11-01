// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ForgeCollection} from "../ForgeCollection.sol";

/// @notice Test harness executed via `eth_call` (never deployed). Its constructor
/// deploys a ForgeCollection, exercises it, and returns ABI-encoded results, so
/// the contract can be tested against a live chain's EVM without spending gas.
contract ForgeCollectionProbe {
    struct Result {
        uint256 totalSupply;
        string firstTokenURI;
        string lastTokenURI;
        address lastOwner;
        uint256 holderBalance;
        address royaltyReceiver;
        uint256 royaltyAmount;
        bool interfaces;
        bool overMintReverted;
        bool nonOwnerReverted;
        bool frozenReverted;
        string contractURI;
        bool provenanceOk;
    }

    constructor(uint256 mintCount, uint256 maxSupply) {
        ForgeCollection c = new ForgeCollection(
            ForgeCollection.InitParams({
                name: "Space Pirates",
                symbol: "SPIRATE",
                baseURI: "ipfs://bafyprobe/",
                contractURI: "ipfs://bafyprobe/collection.json",
                unrevealedURI: "",
                maxSupply: maxSupply,
                startTokenId: 1,
                reserved: maxSupply,
                royaltyReceiver: address(0xC0FFEE),
                royaltyBps: 500,
                provenanceHash: keccak256("provenance"),
                revealCommitment: bytes32(0),
                payout: address(this),
                owner: address(this)
            })
        );
        address holder = address(0xBEEF);
        if (mintCount > 0) c.mintBatch(holder, mintCount);

        // Over-mint must revert.
        bool overMintReverted;
        try c.mintBatch(holder, maxSupply - mintCount + 1) {} catch { overMintReverted = true; }

        // Non-owner calls must revert (call from a fresh helper with no rights).
        bool nonOwnerReverted = !_callAsStranger(address(c), abi.encodeCall(ForgeCollection.mintBatch, (holder, 1)));

        // Freezing locks the base URI.
        c.freezeMetadata();
        bool frozenReverted;
        try c.setBaseURI("ipfs://changed/") {} catch { frozenReverted = true; }

        Result memory r;
        r.totalSupply = c.totalSupply();
        if (mintCount > 0) {
            r.firstTokenURI = c.tokenURI(1);
            r.lastTokenURI = c.tokenURI(mintCount);
            r.lastOwner = c.ownerOf(mintCount);
        }
        r.holderBalance = c.balanceOf(holder);
        (r.royaltyReceiver, r.royaltyAmount) = c.royaltyInfo(1, 10_000);
        r.interfaces = c.supportsInterface(0x80ac58cd) && c.supportsInterface(0x2a55205a) && c.supportsInterface(0x49064906);
        r.overMintReverted = overMintReverted;
        r.nonOwnerReverted = nonOwnerReverted;
        r.frozenReverted = frozenReverted;
        r.contractURI = c.contractURI();
        r.provenanceOk = c.provenanceHash() == keccak256("provenance");
        bytes memory out = abi.encode(r);
        assembly {
            return(add(out, 0x20), mload(out))
        }
    }

    function _callAsStranger(address target, bytes memory data) private returns (bool ok) {
        Stranger s = new Stranger();
        ok = s.exec(target, data);
    }
}

contract Stranger {
    function exec(address target, bytes memory data) external returns (bool ok) {
        (ok, ) = target.call(data);
    }
}
