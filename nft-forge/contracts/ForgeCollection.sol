// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title NFT Forge collection
/// @notice Fixed-supply ERC-721 collection generated with NFT Forge.
///  - Sequential token IDs from `startTokenId`, minted by the owner in batches.
///  - `tokenURI(id)` = baseURI + id + ".json", matching NFT Forge's export package.
///  - `provenanceHash` commits to the exact artwork before minting: SHA-256 over
///    every image's SHA-256, in token order.
///  - ERC-2981 royalties, ERC-4906 metadata refresh events, ERC-7572 contractURI.
///  - Metadata can be frozen permanently.
/// Randomness is never derived on-chain: trait generation is seeded and
/// reproducible off-chain (Arbitrum chains return a constant `prevrandao`).
contract ForgeCollection is ERC721, ERC2981, Ownable2Step, IERC4906 {
    using Strings for uint256;

    uint256 public maxSupply;
    uint256 public startTokenId;
    uint256 public totalMinted;
    bytes32 public provenanceHash;
    bool public metadataFrozen;

    string private _baseTokenURI;
    string private _contractMetadataURI;

    error MaxSupplyExceeded(uint256 requested, uint256 remaining);
    error ZeroQuantity();
    error MetadataIsFrozen();

    event MetadataFrozen();
    /// @dev ERC-7572
    event ContractURIUpdated();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        string memory contractURI_,
        uint256 maxSupply_,
        uint256 startTokenId_,
        address royaltyReceiver,
        uint96 royaltyBps,
        bytes32 provenanceHash_,
        address initialOwner
    ) ERC721(name_, symbol_) Ownable(initialOwner) {
        maxSupply = maxSupply_;
        startTokenId = startTokenId_;
        provenanceHash = provenanceHash_;
        _baseTokenURI = baseURI_;
        _contractMetadataURI = contractURI_;
        _setDefaultRoyalty(royaltyReceiver, royaltyBps);
    }

    // ------------------------------------------------------------------ minting

    /// @notice Mint the next `quantity` token IDs to `to`.
    function mintBatch(address to, uint256 quantity) external onlyOwner {
        uint256 first = _reserve(quantity);
        for (uint256 i; i < quantity; ++i) _mint(to, first + i);
    }

    /// @notice Mint one token to each recipient, in order.
    function airdrop(address[] calldata recipients) external onlyOwner {
        uint256 first = _reserve(recipients.length);
        for (uint256 i; i < recipients.length; ++i) _mint(recipients[i], first + i);
    }

    function _reserve(uint256 quantity) private returns (uint256 first) {
        if (quantity == 0) revert ZeroQuantity();
        uint256 minted = totalMinted;
        if (quantity > maxSupply - minted) revert MaxSupplyExceeded(quantity, maxSupply - minted);
        first = startTokenId + minted;
        totalMinted = minted + quantity;
    }

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    // ----------------------------------------------------------------- metadata

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return bytes(_baseTokenURI).length == 0 ? "" : string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        _baseTokenURI = newBaseURI;
        if (totalMinted > 0) emit BatchMetadataUpdate(startTokenId, startTokenId + totalMinted - 1);
    }

    /// @notice Permanently lock token metadata. Irreversible.
    function freezeMetadata() external onlyOwner {
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function contractURI() external view returns (string memory) {
        return _contractMetadataURI;
    }

    function setContractURI(string calldata newURI) external onlyOwner {
        _contractMetadataURI = newURI;
        emit ContractURIUpdated();
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981, IERC165) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }
}
