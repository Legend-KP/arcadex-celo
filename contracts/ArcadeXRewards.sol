// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title ArcadeXRewards
 * @notice One MiniPay-whitelisted hub: daily on-chain check-in + milestones + future claims.
 *
 * @dev Hardened for safe deployment:
 *      - Interval enforcement after first-ever check-in (no post-reset bypass)
 *      - Campaign core params freeze after first participant
 *      - startTime / endTime windows
 *      - Treasury reservation for USDT/USDC milestones
 *      - cancelCampaign keeps claim() open for earners
 *      - Optional EIP-712 eligibility (Sybil gate)
 */
contract ArcadeXRewards is ReentrancyGuard, EIP712, IERC721Receiver {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    uint8 public constant REWARD_OFFCHAIN = 0;
    uint8 public constant REWARD_ERC721 = 1;
    uint8 public constant REWARD_USDT = 2;
    uint8 public constant REWARD_USDC = 3;

    address public constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    bytes32 private constant _ELIGIBLE_TYPEHASH =
        keccak256("Eligible(address player,uint256 campaignId,uint256 deadline)");

    address public owner;
    address public pendingOwner;
    address public eligibilitySigner;
    bool public paused;

    struct Campaign {
        bool active;
        bool cancelled;
        bool requireEligibility;
        uint16 requiredDays;
        uint32 minIntervalSeconds;
        uint32 maxClaims;
        uint64 startTime;
        uint64 endTime;
        uint8 rewardMode;
        address rewardTarget;
        uint256 rewardAmount;
        bytes32 rewardMeta;
        bool resetAfterMilestone;
    }

    struct Progress {
        uint16 currentDay;
        uint64 lastCheckInAt;
        bool milestoneReached;
        bool onChainClaimed;
        bool initialized;
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(address => mapping(uint256 => Progress)) public progress;
    mapping(uint256 => bool) public hasParticipants;
    mapping(uint256 => uint32) public claimCount;

    uint256 public reservedUSDT;
    uint256 public reservedUSDC;

    error NotOwner();
    error PausedError();
    error CampaignInactive();
    error CampaignIsCancelled();
    error CampaignNotStarted();
    error CampaignEnded();
    error CampaignMisconfigured();
    error TooSoon();
    error StreakComplete();
    error ClaimPending();
    error OffchainNoClaim();
    error StreakIncomplete();
    error AlreadyClaimed();
    error ZeroAddress();
    error ZeroAmount();
    error UnknownRewardMode();
    error ParamsFrozen();
    error InsufficientTreasury();
    error InsufficientWithdrawable();
    error InvalidEligibility();
    error EligibilityExpired();
    error NothingToExpire();
    error AlreadyPaused();
    error NotPaused();
    error UnsupportedReward();
    error NftContractRequired();
    error InvalidAsset();

    event CheckedIn(
        address indexed player,
        uint256 indexed campaignId,
        uint16 day,
        uint256 timestamp
    );
    event MilestoneReached(
        address indexed player,
        uint256 indexed campaignId,
        uint16 day,
        uint8 rewardMode,
        bytes32 rewardMeta,
        uint256 timestamp
    );
    event StreakReset(
        address indexed player,
        uint256 indexed campaignId,
        string reason,
        uint256 timestamp
    );
    event OnChainRewardClaimed(
        address indexed player,
        uint256 indexed campaignId,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount,
        uint256 timestamp
    );
    event CampaignUpdated(
        uint256 indexed campaignId,
        bool active,
        uint16 requiredDays,
        uint8 rewardMode,
        uint64 startTime,
        uint64 endTime
    );
    event CampaignCancelled(uint256 indexed campaignId, address indexed by);
    event ReservationReleased(
        address indexed player,
        uint256 indexed campaignId,
        address token,
        uint256 amount
    );
    event EligibilitySignerUpdated(address indexed previousSigner, address indexed newSigner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WithdrawnUSDT(address indexed to, uint256 amount);
    event WithdrawnUSDC(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    constructor(address initialEligibilitySigner) EIP712("ArcadeXRewards", "1") {
        owner = msg.sender;
        if (initialEligibilitySigner != address(0)) {
            eligibilitySigner = initialEligibilitySigner;
        }
    }

    // ─── Daily check-in ──────────────────────────────────────────────────────────

    /**
     * @param campaignId Campaign id
     * @param deadline EIP-712 eligibility deadline (ignored if campaign does not require it)
     * @param signature Backend eligibility signature (empty if not required)
     */
    function checkIn(uint256 campaignId, uint256 deadline, bytes calldata signature)
        external
        whenNotPaused
    {
        Campaign memory cfg = campaigns[campaignId];
        if (!cfg.active) revert CampaignInactive();
        if (cfg.cancelled) revert CampaignIsCancelled();
        if (cfg.requiredDays == 0 || cfg.minIntervalSeconds == 0) revert CampaignMisconfigured();
        if (block.timestamp < cfg.startTime) revert CampaignNotStarted();
        if (cfg.endTime != 0 && block.timestamp > cfg.endTime) revert CampaignEnded();

        if (cfg.requireEligibility) {
            _verifyEligibility(msg.sender, campaignId, deadline, signature);
        }

        Progress storage p = progress[msg.sender][campaignId];
        uint64 nowTs = uint64(block.timestamp);

        if (p.milestoneReached && cfg.rewardMode != REWARD_OFFCHAIN) {
            revert ClaimPending();
        }

        if (!p.initialized) {
            // True first-ever check-in for this wallet/campaign — interval skipped once.
            p.initialized = true;
            p.currentDay = 1;
            if (!hasParticipants[campaignId]) {
                hasParticipants[campaignId] = true;
            }
        } else {
            // Restarts after reset ALWAYS enforce the interval against lastCheckInAt.
            if (nowTs < p.lastCheckInAt + cfg.minIntervalSeconds) revert TooSoon();

            uint64 missAfter = p.lastCheckInAt + (uint64(cfg.minIntervalSeconds) * 2);
            if (nowTs >= missAfter) {
                emit StreakReset(msg.sender, campaignId, "missed_day", nowTs);
                p.currentDay = 1;
                p.milestoneReached = false;
                p.onChainClaimed = false;
            } else if (p.currentDay == 0) {
                // Post off-chain / claim reset — start a new cycle at day 1.
                p.currentDay = 1;
            } else {
                if (p.currentDay >= cfg.requiredDays) revert StreakComplete();
                unchecked {
                    p.currentDay += 1;
                }
            }
        }

        p.lastCheckInAt = nowTs;
        emit CheckedIn(msg.sender, campaignId, p.currentDay, nowTs);

        if (p.currentDay >= cfg.requiredDays) {
            p.milestoneReached = true;
            emit MilestoneReached(
                msg.sender,
                campaignId,
                p.currentDay,
                cfg.rewardMode,
                cfg.rewardMeta,
                nowTs
            );

            if (cfg.rewardMode == REWARD_USDT) {
                reservedUSDT += cfg.rewardAmount;
            } else if (cfg.rewardMode == REWARD_USDC) {
                reservedUSDC += cfg.rewardAmount;
            }

            if (cfg.resetAfterMilestone && cfg.rewardMode == REWARD_OFFCHAIN) {
                emit StreakReset(msg.sender, campaignId, "milestone_complete", nowTs);
                p.currentDay = 0;
                p.milestoneReached = false;
                p.onChainClaimed = false;
            }
        }
    }

    /**
     * @notice Claim on-chain rewards after streak. Allowed even if campaign was cancelled.
     */
    function claim(uint256 campaignId) external nonReentrant whenNotPaused {
        Campaign memory cfg = campaigns[campaignId];
        if (cfg.rewardMode == REWARD_OFFCHAIN) revert OffchainNoClaim();

        Progress storage p = progress[msg.sender][campaignId];
        if (!p.milestoneReached) revert StreakIncomplete();
        if (p.onChainClaimed) revert AlreadyClaimed();
        if (p.currentDay < cfg.requiredDays) revert StreakIncomplete();

        p.onChainClaimed = true;
        unchecked {
            claimCount[campaignId] += 1;
        }

        if (cfg.rewardMode == REWARD_USDT) {
            reservedUSDT -= cfg.rewardAmount;
        } else if (cfg.rewardMode == REWARD_USDC) {
            reservedUSDC -= cfg.rewardAmount;
        }

        _payout(msg.sender, cfg);

        emit OnChainRewardClaimed(
            msg.sender,
            campaignId,
            cfg.rewardMode,
            cfg.rewardTarget,
            cfg.rewardAmount,
            block.timestamp
        );

        if (cfg.resetAfterMilestone) {
            emit StreakReset(msg.sender, campaignId, "claim_complete", block.timestamp);
            p.currentDay = 0;
            p.milestoneReached = false;
            p.onChainClaimed = false;
        }
    }

    /**
     * @notice Release reserved funds after campaign end if an earner never claimed.
     */
    function expireUnclaimed(address player, uint256 campaignId) external nonReentrant {
        Campaign memory cfg = campaigns[campaignId];
        Progress storage p = progress[player][campaignId];

        if (!p.milestoneReached || p.onChainClaimed) revert NothingToExpire();
        if (cfg.rewardMode != REWARD_USDT && cfg.rewardMode != REWARD_USDC) {
            revert NothingToExpire();
        }
        if (cfg.endTime == 0 || block.timestamp <= cfg.endTime) revert NothingToExpire();

        p.onChainClaimed = true; // lock — cannot claim after expiry sweep
        p.milestoneReached = false;

        uint256 amount = cfg.rewardAmount;
        if (cfg.rewardMode == REWARD_USDT) {
            reservedUSDT -= amount;
            emit ReservationReleased(player, campaignId, USDT, amount);
        } else {
            reservedUSDC -= amount;
            emit ReservationReleased(player, campaignId, USDC, amount);
        }
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setCampaign(
        uint256 campaignId,
        bool active,
        uint16 requiredDays,
        uint32 minIntervalSeconds,
        uint32 maxClaims,
        uint64 startTime,
        uint64 endTime,
        uint8 rewardMode,
        address rewardTarget,
        uint256 rewardAmount,
        bytes32 rewardMeta,
        bool resetAfterMilestone,
        bool requireEligibility
    ) external onlyOwner {
        if (requiredDays == 0 || minIntervalSeconds == 0) revert CampaignMisconfigured();
        if (endTime != 0 && endTime < startTime) revert CampaignMisconfigured();
        if (rewardMode > REWARD_USDC) revert UnknownRewardMode();

        if (rewardMode == REWARD_ERC721) {
            if (rewardTarget == address(0)) revert NftContractRequired();
        }
        if (rewardMode == REWARD_USDT) {
            rewardTarget = USDT;
            if (rewardAmount == 0) revert ZeroAmount();
        }
        if (rewardMode == REWARD_USDC) {
            rewardTarget = USDC;
            if (rewardAmount == 0) revert ZeroAmount();
        }
        if (rewardMode == REWARD_OFFCHAIN) {
            rewardTarget = address(0);
        }
        if (requireEligibility && eligibilitySigner == address(0)) {
            revert InvalidEligibility();
        }

        Campaign storage existing = campaigns[campaignId];

        if (existing.cancelled) revert CampaignIsCancelled();

        if (hasParticipants[campaignId]) {
            // Core economics frozen after first participant. New rules => new campaignId.
            if (
                requiredDays != existing.requiredDays ||
                minIntervalSeconds != existing.minIntervalSeconds ||
                rewardMode != existing.rewardMode ||
                rewardTarget != existing.rewardTarget ||
                rewardAmount != existing.rewardAmount ||
                rewardMeta != existing.rewardMeta ||
                resetAfterMilestone != existing.resetAfterMilestone ||
                requireEligibility != existing.requireEligibility ||
                maxClaims != existing.maxClaims ||
                startTime != existing.startTime
            ) {
                revert ParamsFrozen();
            }
            // Allowed post-participation: active flag + endTime (shorten window).
            existing.active = active;
            existing.endTime = endTime;
            emit CampaignUpdated(
                campaignId,
                active,
                existing.requiredDays,
                existing.rewardMode,
                existing.startTime,
                endTime
            );
            return;
        }

        if (rewardMode == REWARD_USDT || rewardMode == REWARD_USDC) {
            uint256 available = _availableBalance(rewardTarget);
            uint256 needed = rewardAmount;
            if (maxClaims > 0) {
                needed = rewardAmount * uint256(maxClaims);
            }
            if (available < needed) revert InsufficientTreasury();
        }

        campaigns[campaignId] = Campaign({
            active: active,
            cancelled: false,
            requireEligibility: requireEligibility,
            requiredDays: requiredDays,
            minIntervalSeconds: minIntervalSeconds,
            maxClaims: maxClaims,
            startTime: startTime,
            endTime: endTime,
            rewardMode: rewardMode,
            rewardTarget: rewardTarget,
            rewardAmount: rewardAmount,
            rewardMeta: rewardMeta,
            resetAfterMilestone: resetAfterMilestone
        });

        emit CampaignUpdated(campaignId, active, requiredDays, rewardMode, startTime, endTime);
    }

    /**
     * @notice Stop new check-ins; earners can still claim() reserved on-chain rewards.
     */
    function cancelCampaign(uint256 campaignId) external onlyOwner {
        Campaign storage cfg = campaigns[campaignId];
        cfg.active = false;
        cfg.cancelled = true;
        emit CampaignCancelled(campaignId, msg.sender);
    }

    function setEligibilitySigner(address newSigner) external onlyOwner {
        emit EligibilitySignerUpdated(eligibilitySigner, newSigner);
        eligibilitySigner = newSigner;
    }

    function pause() external onlyOwner {
        if (paused) revert AlreadyPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == address(this)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function withdrawUSDT(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > _availableBalance(USDT)) revert InsufficientWithdrawable();
        IERC20(USDT).safeTransfer(to, amount);
        emit WithdrawnUSDT(to, amount);
    }

    function withdrawUSDC(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > _availableBalance(USDC)) revert InsufficientWithdrawable();
        IERC20(USDC).safeTransfer(to, amount);
        emit WithdrawnUSDC(to, amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    // ─── Views ──────────────────────────────────────────────────────────────────

    function getCampaign(uint256 campaignId)
        external
        view
        returns (
            bool active,
            bool cancelled,
            bool requireEligibility,
            uint16 requiredDays,
            uint32 minIntervalSeconds,
            uint32 maxClaims,
            uint64 startTime,
            uint64 endTime,
            uint8 rewardMode,
            address rewardTarget,
            uint256 rewardAmount,
            bytes32 rewardMeta,
            bool resetAfterMilestone
        )
    {
        Campaign memory cfg = campaigns[campaignId];
        return (
            cfg.active,
            cfg.cancelled,
            cfg.requireEligibility,
            cfg.requiredDays,
            cfg.minIntervalSeconds,
            cfg.maxClaims,
            cfg.startTime,
            cfg.endTime,
            cfg.rewardMode,
            cfg.rewardTarget,
            cfg.rewardAmount,
            cfg.rewardMeta,
            cfg.resetAfterMilestone
        );
    }

    function getProgress(address player, uint256 campaignId)
        external
        view
        returns (
            uint16 currentDay,
            uint64 lastCheckInAt,
            bool milestoneReached,
            bool onChainClaimed,
            bool initialized,
            bool canCheckIn,
            bool streakWouldReset
        )
    {
        Campaign memory cfg = campaigns[campaignId];
        Progress memory p = progress[player][campaignId];
        currentDay = p.currentDay;
        lastCheckInAt = p.lastCheckInAt;
        milestoneReached = p.milestoneReached;
        onChainClaimed = p.onChainClaimed;
        initialized = p.initialized;

        canCheckIn = false;
        streakWouldReset = false;

        if (
            !cfg.active ||
            cfg.cancelled ||
            cfg.minIntervalSeconds == 0 ||
            block.timestamp < cfg.startTime ||
            (cfg.endTime != 0 && block.timestamp > cfg.endTime)
        ) {
            return (
                currentDay,
                lastCheckInAt,
                milestoneReached,
                onChainClaimed,
                initialized,
                canCheckIn,
                streakWouldReset
            );
        }

        if (p.milestoneReached && cfg.rewardMode != REWARD_OFFCHAIN) {
            return (
                currentDay,
                lastCheckInAt,
                milestoneReached,
                onChainClaimed,
                initialized,
                canCheckIn,
                streakWouldReset
            );
        }

        if (!p.initialized) {
            canCheckIn = true;
            return (
                currentDay,
                lastCheckInAt,
                milestoneReached,
                onChainClaimed,
                initialized,
                canCheckIn,
                streakWouldReset
            );
        }

        uint256 nextAllowed = uint256(p.lastCheckInAt) + cfg.minIntervalSeconds;
        uint256 missAfter = uint256(p.lastCheckInAt) + (uint256(cfg.minIntervalSeconds) * 2);
        canCheckIn = block.timestamp >= nextAllowed;
        streakWouldReset = canCheckIn && block.timestamp >= missAfter && p.currentDay > 0;
    }

    function availableUSDT() external view returns (uint256) {
        return _availableBalance(USDT);
    }

    function availableUSDC() external view returns (uint256) {
        return _availableBalance(USDC);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ─── Internal ───────────────────────────────────────────────────────────────

    function _verifyEligibility(
        address player,
        uint256 campaignId,
        uint256 deadline,
        bytes calldata signature
    ) internal view {
        if (block.timestamp > deadline) revert EligibilityExpired();
        if (eligibilitySigner == address(0)) revert InvalidEligibility();

        bytes32 structHash =
            keccak256(abi.encode(_ELIGIBLE_TYPEHASH, player, campaignId, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        if (recovered != eligibilitySigner) revert InvalidEligibility();
    }

    function _availableBalance(address token) internal view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 reserved = token == USDT ? reservedUSDT : reservedUSDC;
        if (bal <= reserved) return 0;
        return bal - reserved;
    }

    function _payout(address player, Campaign memory cfg) internal {
        if (cfg.rewardMode == REWARD_ERC721) {
            if (cfg.rewardAmount == 0) {
                _safeMintReward(cfg.rewardTarget, player);
            } else {
                IERC721(cfg.rewardTarget).safeTransferFrom(address(this), player, cfg.rewardAmount);
            }
            return;
        }
        if (cfg.rewardMode == REWARD_USDT || cfg.rewardMode == REWARD_USDC) {
            if (cfg.rewardAmount == 0) revert ZeroAmount();
            IERC20(cfg.rewardTarget).safeTransfer(player, cfg.rewardAmount);
            return;
        }
        revert UnsupportedReward();
    }

    function _safeMintReward(address nft, address to) internal {
        (bool success, ) = nft.call(abi.encodeWithSignature("mintReward(address)", to));
        if (!success) revert UnsupportedReward();
    }

    receive() external payable {
        revert("No CELO accepted");
    }

    fallback() external payable {
        revert("No CELO accepted");
    }
}
