// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IParticipantRegistry.sol";

/**
 * @dev Verifiers are admitted, not self-appointed. During a bootstrap phase the deployer
 * seeds the initial verifier set; once `closeBootstrap` is called, a candidate is admitted
 * only when `ADMISSION_QUORUM` active verifiers vote for it. A verifier counts as active only
 * while its bond is at least `MIN_VERIFIER_BOND`, so slashing below that removes its vote.
 * NGOs and vendors cannot also be verifiers (conflict of interest).
 */
contract ParticipantRegistry is IParticipantRegistry, AccessControl, ReentrancyGuard {
    bytes32 public constant NGO_ROLE = keccak256("NGO_ROLE");
    bytes32 public constant VENDOR_ROLE = keccak256("VENDOR_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant DONOR_ROLE = keccak256("DONOR_ROLE");

    uint256 public constant MIN_VERIFIER_BOND = 10 ether;
    uint256 public constant ADMISSION_QUORUM = 2;

    mapping(address => address) public vendorSigningAddress;
    mapping(address => uint256) public verifierBond;
    mapping(address => uint256) public verifierNonce;
    mapping(address => bool) public verifierApplied;
    mapping(address => mapping(address => bool)) public admissionVotes;
    mapping(address => uint256) public admissionVoteCount;
    bool public bootstrapOpen = true;

    IERC20 public bondToken;

    event VerifierApplied(address indexed candidate);
    event BootstrapClosed();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setBondToken(IERC20 _token) public onlyRole(DEFAULT_ADMIN_ROLE) {
        bondToken = _token;
    }

    function registerNGO() public {
        require(!hasRole(NGO_ROLE, msg.sender), "AlreadyRegistered");
        require(!_isVerifierOrApplicant(msg.sender), "ConflictOfInterest");
        _grantRole(NGO_ROLE, msg.sender);
        emit RoleGranted(NGO_ROLE, msg.sender);
    }

    function registerVendor(address signingAddress) public {
        require(signingAddress != address(0), "InvalidSigningAddress");
        require(!hasRole(VENDOR_ROLE, msg.sender), "AlreadyRegistered");
        require(!_isVerifierOrApplicant(msg.sender), "ConflictOfInterest");
        _grantRole(VENDOR_ROLE, msg.sender);
        vendorSigningAddress[msg.sender] = signingAddress;
        emit RoleGranted(VENDOR_ROLE, msg.sender);
    }

    /// @notice Apply to become a verifier; the role is granted only on admission.
    function registerVerifier() public {
        require(!_isVerifierOrApplicant(msg.sender), "AlreadyRegistered");
        require(!hasRole(NGO_ROLE, msg.sender) && !hasRole(VENDOR_ROLE, msg.sender), "ConflictOfInterest");
        verifierApplied[msg.sender] = true;
        emit VerifierApplied(msg.sender);
    }

    /// @notice Seed the initial verifier set. Only possible before the bootstrap is closed.
    function admitVerifier(address candidate) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bootstrapOpen, "BootstrapClosed");
        _admit(candidate);
    }

    function closeBootstrap() public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bootstrapOpen, "BootstrapClosed");
        bootstrapOpen = false;
        emit BootstrapClosed();
    }

    /// @notice Active verifiers admit new verifiers by quorum.
    function voteAdmitVerifier(address candidate) public {
        require(isVerifierActive(msg.sender), "VerifierNotActive");
        require(verifierApplied[candidate] && !hasRole(VERIFIER_ROLE, candidate), "NotApplicant");
        require(!admissionVotes[candidate][msg.sender], "AlreadyVoted");
        admissionVotes[candidate][msg.sender] = true;
        admissionVoteCount[candidate] += 1;
        if (admissionVoteCount[candidate] >= ADMISSION_QUORUM) {
            _admit(candidate);
        }
    }

    function stakeBond(uint256 amount) public nonReentrant {
        require(amount > 0, "InsufficientBond");
        require(hasRole(VERIFIER_ROLE, msg.sender), "NotVerifier");
        require(address(bondToken) != address(0), "BondTokenNotSet");

        IERC20(bondToken).transferFrom(msg.sender, address(this), amount);
        verifierBond[msg.sender] += amount;
        emit BondStaked(msg.sender, amount);
    }

    function slashBond(address verifier, uint256 amount) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(verifierBond[verifier] >= amount, "InsufficientBond");
        verifierBond[verifier] -= amount;
        // Slashed stake goes to the slashing authority (treasury), not back to the verifier.
        IERC20(bondToken).transfer(msg.sender, amount);
        emit BondSlashed(verifier, amount);
    }

    function withdrawBond(uint256 amount) public nonReentrant {
        require(hasRole(VERIFIER_ROLE, msg.sender), "NotVerifier");
        require(verifierBond[msg.sender] >= amount, "InsufficientBond");
        verifierBond[msg.sender] -= amount;
        IERC20(bondToken).transfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    function hasRole(bytes32 role, address account) public view override(AccessControl, IParticipantRegistry) returns (bool) {
        return super.hasRole(role, account);
    }

    function isVerifierActive(address verifier) public view override returns (bool) {
        return hasRole(VERIFIER_ROLE, verifier) && verifierBond[verifier] >= MIN_VERIFIER_BOND;
    }

    function getVendorSigningAddress(address vendor) public view override returns (address) {
        return vendorSigningAddress[vendor];
    }

    function getVerifierBond(address verifier) public view override returns (uint256) {
        return verifierBond[verifier];
    }

    function getVerifierNonce(address verifier) public view override returns (uint256) {
        return verifierNonce[verifier];
    }

    function incrementVerifierNonce(address verifier) public onlyRole(VERIFIER_ROLE) override {
        verifierNonce[verifier] += 1;
    }

    function _admit(address candidate) internal {
        require(verifierApplied[candidate], "NotApplicant");
        require(!hasRole(VERIFIER_ROLE, candidate), "AlreadyRegistered");
        _grantRole(VERIFIER_ROLE, candidate);
        emit RoleGranted(VERIFIER_ROLE, candidate);
    }

    function _isVerifierOrApplicant(address account) internal view returns (bool) {
        return verifierApplied[account] || hasRole(VERIFIER_ROLE, account);
    }
}
