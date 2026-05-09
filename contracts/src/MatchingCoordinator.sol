// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnerRoles} from "./access/OwnerRoles.sol";
import {Errors} from "./libraries/Errors.sol";
import {Types} from "./libraries/Types.sol";
import {IntentRegistry} from "./IntentRegistry.sol";
import {LoanCore} from "./LoanCore.sol";

contract MatchingCoordinator is OwnerRoles {
    struct Epoch {
        bool open;
        bool finalized;
        uint256 openedAt;
        uint256 finalizedAt;
    }

    IntentRegistry public intentRegistry;
    LoanCore public loanCore;

    uint256 public currentEpochId;
    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(bytes32 => bool)) public approvedDigestByEpoch;
    mapping(bytes32 => bool) public consumedMatchDigest;
    mapping(address => mapping(uint256 => bool)) public consumedBorrowerNonce;

    event IntentRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event LoanCoreUpdated(address indexed previousLoanCore, address indexed newLoanCore);
    event EpochOpened(uint256 indexed epochId);
    event EpochFinalized(uint256 indexed epochId);
    event MatchDigestRegistered(uint256 indexed epochId, bytes32 indexed matchDigest, address indexed matcher);
    event MatchExecuted(uint256 indexed epochId, uint256 indexed loanId, bytes32 indexed matchDigest);

    constructor(address intentRegistry_, address loanCore_) {
        if (intentRegistry_ == address(0) || loanCore_ == address(0)) revert Errors.InvalidAddress();
        intentRegistry = IntentRegistry(intentRegistry_);
        loanCore = LoanCore(loanCore_);
    }

    function setIntentRegistry(address intentRegistry_) external onlyOwner {
        if (intentRegistry_ == address(0)) revert Errors.InvalidAddress();
        address previous = address(intentRegistry);
        intentRegistry = IntentRegistry(intentRegistry_);
        emit IntentRegistryUpdated(previous, intentRegistry_);
    }

    function setLoanCore(address loanCore_) external onlyOwner {
        if (loanCore_ == address(0)) revert Errors.InvalidAddress();
        address previous = address(loanCore);
        loanCore = LoanCore(loanCore_);
        emit LoanCoreUpdated(previous, loanCore_);
    }

    function openEpoch() external onlyOwner returns (uint256 epochId) {
        if (currentEpochId > 0 && epochs[currentEpochId].open) revert Errors.InvalidState();
        epochId = ++currentEpochId;
        epochs[epochId] = Epoch({open: true, finalized: false, openedAt: block.timestamp, finalizedAt: 0});
        emit EpochOpened(epochId);
    }

    function finalizeEpoch(uint256 epochId) external onlyOwner {
        Epoch storage epoch = epochs[epochId];
        if (!epoch.open || epoch.finalized) revert Errors.InvalidState();
        if (epochId != currentEpochId) revert Errors.InvalidState();
        epoch.open = false;
        epoch.finalized = true;
        epoch.finalizedAt = block.timestamp;
        emit EpochFinalized(epochId);
    }

    function registerMatchDigest(uint256 epochId, bytes32 matchDigest) external onlyMatcher {
        Epoch memory epoch = epochs[epochId];
        if (!epoch.open || epoch.finalized) revert Errors.InvalidState();
        if (matchDigest == bytes32(0)) revert Errors.InvalidAmount();
        if (approvedDigestByEpoch[epochId][matchDigest]) revert Errors.AlreadyExists();
        approvedDigestByEpoch[epochId][matchDigest] = true;
        emit MatchDigestRegistered(epochId, matchDigest, msg.sender);
    }

    function executeMatch(
        Types.MatchExecutionParams calldata params,
        bytes32[] calldata lendIntentIds,
        address[] calldata lenders,
        uint256[] calldata amounts
    ) external onlyMatcher returns (uint256 loanId) {
        if (lendIntentIds.length == 0) revert Errors.InvalidArrayLength();
        if (lendIntentIds.length != lenders.length || lenders.length != amounts.length) revert Errors.InvalidArrayLength();
        if (params.borrower == address(0) || params.token == address(0) || params.collateralToken == address(0)) {
            revert Errors.InvalidAddress();
        }

        Epoch memory epoch = epochs[params.epochId];
        if (!epoch.finalized || epoch.open) revert Errors.InvalidState();
        if (consumedBorrowerNonce[params.borrower][params.borrowerNonce]) revert Errors.Replay();

        bytes32 digest = computeMatchDigest(params, lendIntentIds, lenders, amounts);

        if (!approvedDigestByEpoch[params.epochId][digest]) revert Errors.Unauthorized();
        if (consumedMatchDigest[digest]) revert Errors.Replay();

        Types.Intent memory borrowIntent = intentRegistry.consumeIntent(params.borrowIntentId, params.principal);
        if (borrowIntent.side != Types.IntentSide.BORROW) revert Errors.InvalidState();
        if (borrowIntent.maker != params.borrower) revert Errors.Unauthorized();
        if (borrowIntent.token != params.token || borrowIntent.collateralToken != params.collateralToken) {
            revert Errors.InvalidState();
        }
        if (params.weightedRateBps > borrowIntent.rateBps) revert Errors.InvalidAmount();
        if (params.minCollateralRatioBps < borrowIntent.minCollateralRatioBps) revert Errors.InvalidAmount();

        uint256 summedPrincipal = _consumeLendIntents(
            lendIntentIds, lenders, amounts, params.token, params.collateralToken, params.weightedRateBps
        );
        if (summedPrincipal != params.principal) revert Errors.InvalidAmount();

        consumedBorrowerNonce[params.borrower][params.borrowerNonce] = true;
        consumedMatchDigest[digest] = true;

        loanId = loanCore.createLoanFromMatch(
            params.borrower,
            params.token,
            params.collateralToken,
            params.principal,
            params.collateralAmount,
            params.weightedRateBps,
            params.minCollateralRatioBps,
            params.durationSeconds,
            lenders,
            amounts
        );

        emit MatchExecuted(params.epochId, loanId, digest);
    }

    function computeMatchDigest(
        Types.MatchExecutionParams calldata params,
        bytes32[] calldata lendIntentIds,
        address[] calldata lenders,
        uint256[] calldata amounts
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                params.epochId,
                params.borrowIntentId,
                lendIntentIds,
                lenders,
                amounts,
                params.borrower,
                params.token,
                params.collateralToken,
                params.principal,
                params.collateralAmount,
                params.weightedRateBps,
                params.minCollateralRatioBps,
                params.durationSeconds,
                params.borrowerNonce,
                params.salt,
                block.chainid,
                address(this)
            )
        );
    }

    function _consumeLendIntents(
        bytes32[] calldata lendIntentIds,
        address[] calldata lenders,
        uint256[] calldata amounts,
        address token,
        address collateralToken,
        uint256 weightedRateBps
    ) internal returns (uint256 summedPrincipal) {
        uint256 len = lendIntentIds.length;
        for (uint256 i = 0; i < len; i++) {
            Types.Intent memory lendIntent = intentRegistry.consumeIntent(lendIntentIds[i], amounts[i]);
            if (lendIntent.side != Types.IntentSide.LEND) revert Errors.InvalidState();
            if (lendIntent.maker != lenders[i]) revert Errors.Unauthorized();
            if (lendIntent.token != token || lendIntent.collateralToken != collateralToken) revert Errors.InvalidState();
            if (weightedRateBps < lendIntent.rateBps) revert Errors.InvalidAmount();
            summedPrincipal += amounts[i];
        }
    }
}
