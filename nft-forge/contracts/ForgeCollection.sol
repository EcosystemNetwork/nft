// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title NFT Forge collection
/// @notice Fixed-supply ERC-721 collection generated with NFT Forge.
///  - Sequential token IDs from `startTokenId`.
///  - Team reserve minted by the owner (`mintBatch`, `airdrop`), capped at `reserved`.
///  - Public sale in up to 8 phases, each with a time window, price, per-wallet limit,
///    optional phase cap and optional Merkle allowlist (leaf = (account, allowance)).
///  - `provenanceHash` commits to the exact artwork, in generation order, before minting:
///    SHA-256 over every image's SHA-256.
///  - Optional delayed reveal. Until `reveal`, every token shows `unrevealedURI`. Reveal
///    picks a starting offset from a secret committed at deployment (`revealCommitment`)
///    mixed with entropy contributed by every public mint, so token N receives artwork
///    `artworkId(N)` = #(N + offset), which nobody could predict while minting. The
///    revealed metadata (token N.json describing that artwork) is published with the
///    reveal; the provenance hash proves the artwork order was fixed beforehand.
///  - ERC-2981 royalties, ERC-4906 metadata refresh events, ERC-7572 contractURI.
///  - Metadata can be frozen permanently.
/// Randomness is never read from the chain: Arbitrum's `prevrandao` is constant.
contract ForgeCollection is ERC721, ERC2981, Ownable2Step, ReentrancyGuard, IERC4906 {
    using Strings for uint256;

    struct InitParams {
        string name;
        string symbol;
        string baseURI;
        string contractURI;
        /// Empty: revealed from the start (tokenURI uses baseURI directly, offset 0).
        string unrevealedURI;
        uint256 maxSupply;
        uint256 startTokenId;
        /// Tokens only the owner can mint. maxSupply = owner mints everything.
        uint256 reserved;
        address royaltyReceiver;
        uint96 royaltyBps;
        bytes32 provenanceHash;
        /// keccak256(abi.encode(secret)); required iff unrevealedURI is set.
        bytes32 revealCommitment;
        address payout;
        address owner;
    }

    struct Phase {
        uint64 start; // unix seconds, inclusive
        uint64 end; // unix seconds, exclusive; 0 = open-ended
        uint128 price; // wei per token
        uint32 maxPerWallet; // public phases: 0 = unlimited. Allowlist phases use the signed allowance.
        uint32 cap; // max tokens sold in this phase; 0 = no phase cap
        bytes32 merkleRoot; // 0 = open to everyone
    }

    uint256 public constant MAX_PHASES = 8;
    uint256 public constant MAX_PER_TX = 50;

    uint256 public immutable maxSupply;
    uint256 public immutable startTokenId;
    bytes32 public immutable provenanceHash;
    bytes32 public immutable revealCommitment;

    uint256 public totalMinted;
    uint256 public reserved;
    uint256 public reserveMinted;
    bool public metadataFrozen;
    bool public paused;
    bool public revealed;
    uint256 public revealOffset;
    address public payoutAddress;

    Phase[] private _phases;
    mapping(uint256 phaseId => uint256) public phaseMinted;
    mapping(uint256 phaseId => mapping(address account => uint256)) public mintedInPhase;

    bytes32 private _entropy;
    string private _baseTokenURI;
    string private _unrevealedURI;
    string private _contractMetadataURI;

    error MaxSupplyExceeded(uint256 requested, uint256 remaining);
    error ReserveExceeded(uint256 requested, uint256 remaining);
    error ZeroQuantity();
    error TooManyPerTx(uint256 requested, uint256 max);
    error MetadataIsFrozen();
    error InvalidConfig();
    error InvalidPhase();
    error PhaseNotActive();
    error PhaseCapExceeded(uint256 requested, uint256 remaining);
    error WalletLimitExceeded(uint256 requested, uint256 remaining);
    error NotAllowlisted();
    error WrongPayment(uint256 expected, uint256 sent);
    error SalePaused();
    error AlreadyRevealed();
    error BadRevealSecret();
    error OffsetMismatch(uint256 actual);
    error NothingToWithdraw();

    event MetadataFrozen();
    /// @dev ERC-7572
    event ContractURIUpdated();
    event PhaseSet(uint256 indexed phaseId, Phase phase);
    event Minted(uint256 indexed phaseId, address indexed to, uint256 firstTokenId, uint256 quantity, uint256 paid);
    event Revealed(uint256 offset);
    event PausedSet(bool paused);
    event ReserveReduced(uint256 reserved);
    event PayoutAddressSet(address payout);
    event Withdrawn(address to, uint256 amount);

    constructor(InitParams memory p) ERC721(p.name, p.symbol) Ownable(p.owner) {
        if (p.maxSupply == 0 || p.reserved > p.maxSupply || p.payout == address(0)) revert InvalidConfig();
        bool delayed = bytes(p.unrevealedURI).length != 0;
        if (delayed != (p.revealCommitment != bytes32(0))) revert InvalidConfig();
        maxSupply = p.maxSupply;
        startTokenId = p.startTokenId;
        reserved = p.reserved;
        provenanceHash = p.provenanceHash;
        revealCommitment = p.revealCommitment;
        revealed = !delayed;
        payoutAddress = p.payout;
        _baseTokenURI = p.baseURI;
        _unrevealedURI = p.unrevealedURI;
        _contractMetadataURI = p.contractURI;
        _entropy = keccak256(abi.encode(block.chainid, address(this)));
        _setDefaultRoyalty(p.royaltyReceiver, p.royaltyBps);
    }

    // ---------------------------------------------------------------- owner mint

    /// @notice Mint the next `quantity` token IDs to `to` from the team reserve.
    function mintBatch(address to, uint256 quantity) external onlyOwner {
        uint256 first = _reserveMint(quantity);
        for (uint256 i; i < quantity; ++i) _mint(to, first + i);
    }

    /// @notice Mint one reserve token to each recipient, in order.
    function airdrop(address[] calldata recipients) external onlyOwner {
        uint256 first = _reserveMint(recipients.length);
        for (uint256 i; i < recipients.length; ++i) _mint(recipients[i], first + i);
    }

    function _reserveMint(uint256 quantity) private returns (uint256 first) {
        if (quantity == 0) revert ZeroQuantity();
        uint256 left = reserved - reserveMinted;
        if (quantity > left) revert ReserveExceeded(quantity, left);
        reserveMinted += quantity;
        first = _take(quantity);
    }

    function _take(uint256 quantity) private returns (uint256 first) {
        uint256 minted = totalMinted;
        if (quantity > maxSupply - minted) revert MaxSupplyExceeded(quantity, maxSupply - minted);
        first = startTokenId + minted;
        totalMinted = minted + quantity;
    }

    /// @notice Release unminted reserve to the public sale. The reserve can only shrink.
    function reduceReserve(uint256 newReserved) external onlyOwner {
        if (newReserved > reserved || newReserved < reserveMinted) revert InvalidConfig();
        reserved = newReserved;
        emit ReserveReduced(newReserved);
    }

    // --------------------------------------------------------------- public sale

    /// @notice Create (`phaseId == phaseCount()`) or update a sale phase.
    function setPhase(uint256 phaseId, Phase calldata phase) external onlyOwner {
        if (phase.end != 0 && phase.end <= phase.start) revert InvalidConfig();
        if (phaseId < _phases.length) _phases[phaseId] = phase;
        else if (phaseId == _phases.length && phaseId < MAX_PHASES) _phases.push(phase);
        else revert InvalidPhase();
        emit PhaseSet(phaseId, phase);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function phaseCount() external view returns (uint256) {
        return _phases.length;
    }

    function getPhase(uint256 phaseId) external view returns (Phase memory) {
        if (phaseId >= _phases.length) revert InvalidPhase();
        return _phases[phaseId];
    }

    /// @notice Tokens still available to the public: unminted supply minus unminted reserve.
    function publicRemaining() public view returns (uint256) {
        return maxSupply - totalMinted - (reserved - reserveMinted);
    }

    /// @notice Mint `quantity` tokens in sale phase `phaseId`.
    /// @param allowance For allowlist phases: the allowance in the caller's Merkle leaf. Ignored otherwise.
    /// @param proof For allowlist phases: Merkle proof of keccak256(bytes.concat(keccak256(abi.encode(caller, allowance)))).
    function mint(uint256 phaseId, uint256 quantity, uint256 allowance, bytes32[] calldata proof) external payable nonReentrant {
        if (paused) revert SalePaused();
        if (phaseId >= _phases.length) revert InvalidPhase();
        Phase memory ph = _phases[phaseId];
        if (block.timestamp < ph.start || (ph.end != 0 && block.timestamp >= ph.end)) revert PhaseNotActive();
        if (quantity == 0) revert ZeroQuantity();
        if (quantity > MAX_PER_TX) revert TooManyPerTx(quantity, MAX_PER_TX);

        uint256 limit = ph.maxPerWallet;
        if (ph.merkleRoot != bytes32(0)) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, allowance))));
            if (allowance == 0 || !MerkleProof.verifyCalldata(proof, ph.merkleRoot, leaf)) revert NotAllowlisted();
            limit = allowance;
        }
        uint256 already = mintedInPhase[phaseId][msg.sender];
        if (limit != 0 && quantity + already > limit) revert WalletLimitExceeded(quantity, limit > already ? limit - already : 0);
        if (ph.cap != 0 && quantity + phaseMinted[phaseId] > ph.cap) revert PhaseCapExceeded(quantity, ph.cap - phaseMinted[phaseId]);
        uint256 avail = publicRemaining();
        if (quantity > avail) revert MaxSupplyExceeded(quantity, avail);
        uint256 cost = uint256(ph.price) * quantity;
        if (msg.value != cost) revert WrongPayment(cost, msg.value);

        mintedInPhase[phaseId][msg.sender] = already + quantity;
        phaseMinted[phaseId] += quantity;
        if (!revealed) _entropy = keccak256(abi.encode(_entropy, msg.sender, quantity, block.number, block.timestamp));
        uint256 first = _take(quantity);
        emit Minted(phaseId, msg.sender, first, quantity, msg.value);
        for (uint256 i; i < quantity; ++i) _safeMint(msg.sender, first + i);
    }

    function setPayoutAddress(address payout) external onlyOwner {
        if (payout == address(0)) revert InvalidConfig();
        payoutAddress = payout;
        emit PayoutAddressSet(payout);
    }

    /// @notice Send all sale proceeds to `payoutAddress`.
    function withdraw() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        emit Withdrawn(payoutAddress, amount);
        Address.sendValue(payable(payoutAddress), amount);
    }

    // ------------------------------------------------------------------- reveal

    /// @notice Reveal the collection by publishing the secret committed at deployment,
    /// together with the revealed metadata (token N.json describes `artworkId(N)`).
    /// The offset is keccak256(secret, revealEntropy()) % maxSupply: it mixes the secret
    /// with entropy from every public mint, so neither minters (who don't know the
    /// secret) nor the owner (who committed to it before any mint) could pick it.
    /// `expectedOffset` is what the metadata was built for; a mint landing in between
    /// changes the entropy, and the reveal then reverts instead of mismatching.
    function reveal(bytes32 secret, string calldata revealedBaseURI, uint256 expectedOffset) external onlyOwner {
        if (revealed) revert AlreadyRevealed();
        if (keccak256(abi.encode(secret)) != revealCommitment) revert BadRevealSecret();
        uint256 offset = uint256(keccak256(abi.encode(secret, _entropy))) % maxSupply;
        if (offset != expectedOffset) revert OffsetMismatch(offset);
        revealed = true;
        revealOffset = offset;
        _baseTokenURI = revealedBaseURI;
        emit Revealed(offset);
        emit BatchMetadataUpdate(startTokenId, startTokenId + maxSupply - 1);
    }

    /// @notice Entropy accumulated from public mints (input to the reveal offset).
    function revealEntropy() external view returns (bytes32) {
        return _entropy;
    }

    /// @notice Index of the artwork (in provenance order) that `tokenId` shows once revealed.
    function artworkId(uint256 tokenId) public view returns (uint256) {
        return startTokenId + ((tokenId - startTokenId + revealOffset) % maxSupply);
    }

    // ----------------------------------------------------------------- metadata

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) return _unrevealedURI;
        return bytes(_baseTokenURI).length == 0 ? "" : string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function unrevealedURI() external view returns (string memory) {
        return _unrevealedURI;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        _baseTokenURI = newBaseURI;
        if (totalMinted > 0) emit BatchMetadataUpdate(startTokenId, startTokenId + totalMinted - 1);
    }

    /// @notice Permanently lock token metadata. Irreversible. Only after reveal.
    function freezeMetadata() external onlyOwner {
        if (!revealed) revert InvalidConfig();
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
