// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {IntentRegistry} from "../src/IntentRegistry.sol";
import {MatchingCoordinator} from "../src/MatchingCoordinator.sol";
import {LoanCore} from "../src/LoanCore.sol";
import {PositionManager} from "../src/PositionManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockChainlinkFeed} from "../src/mocks/MockChainlinkFeed.sol";
import {Types} from "../src/libraries/Types.sol";

contract SepoliaFullWorkflow is Script {
    uint256 internal constant DEFAULT_CHAIN_ID = 11155111;

    address internal constant DEFAULT_INTENT_REGISTRY = 0x1bDb5993C3D1F089DaEab4351e1C0c92685301D7;
    address internal constant DEFAULT_LOAN_CORE = 0xC82A109460078976EFE0CB775cAF213C3787f8f3;
    address internal constant DEFAULT_MATCHING_COORDINATOR = 0xcCDA03ec6BA2768Fc50b1fF0AD18462Beb9f6586;
    address internal constant DEFAULT_CHAINLINK_ORACLE = 0x36bF3b2De28c407F4Fa961aa4f0b71621ba51ACB;
    address internal constant DEFAULT_ORACLE_ROUTER = 0xfEa196790eA9D83dd414bFdCc72017F6349b2F47;
    address internal constant DEFAULT_POSITION_MANAGER = 0x1Ac826fb43e430a6c7BFAD461a0fa8a752f483Fd;
    address internal constant DEFAULT_LIQUIDATION_MANAGER = 0xeDf2e47063C82bAa6B73cd1736eE53e5551dd2E8;
    address internal constant DEFAULT_MATCHER = 0xBf879877e05430aC14fcEF6fE102DF29e264b114;

    address internal constant DEFAULT_DEBT_TOKEN = 0x1ba22D78fB5d9910E77612032fE5d2dDF1A8A8F1;
    address internal constant DEFAULT_COLLATERAL_TOKEN = 0x70B0FE94eE8665CF63Bf466cCC0Ed9bcCeBaa1F3;
    address internal constant DEFAULT_DEBT_FEED = 0x328608974405B181307435345471a8c0D01C7fc5;
    address internal constant DEFAULT_COLLATERAL_FEED = 0xcF5C297fcFd61d5A1b19F4C01c7422Bf7c571094;

    function run() external {
        uint256 privateKey = _workflowPrivateKey();
        address actor = vm.addr(privateKey);

        require(block.chainid == _chainId(), "WORKFLOW: wrong chain");
        _verifyWiring(actor);

        vm.startBroadcast(privateKey);

        _seedMocks(actor);
        (bytes32 borrowIntentId, bytes32 lendIntentId) = _postIntents();
        uint256 epochId = _openOrUseEpoch();
        uint256 loanId = _executeMatch(actor, epochId, borrowIntentId, lendIntentId);
        (uint256 healthBeforeStress, uint256 healthAfterStress, uint256 claimable) =
            _stressLiquidateRepayAndClose(actor, loanId);

        vm.stopBroadcast();

        console2.log("Sepolia full workflow complete");
        console2.log("actor", actor);
        console2.log("epochId", epochId);
        console2.log("loanId", loanId);
        console2.log("healthBeforeStressBps", healthBeforeStress);
        console2.log("healthAfterStressBps", healthAfterStress);
        console2.log("lenderClaimWithdrawn", claimable);
    }

    function _seedMocks(address actor) internal {
        _debtFeed().setAnswer(int256(_debtPrice()), block.timestamp);
        _collateralFeed().setAnswer(int256(_collateralPrice()), block.timestamp);

        _debt().mint(actor, _mintDebtAmount());
        _collateral().mint(actor, _mintCollateralAmount());
        _debt().approve(_loanCoreAddress(), type(uint256).max);
        _collateral().approve(_loanCoreAddress(), type(uint256).max);
    }

    function _postIntents() internal returns (bytes32 borrowIntentId, bytes32 lendIntentId) {
        uint256 expiry = block.timestamp + _intentExpirySeconds();
        borrowIntentId = _registry().postIntent(
            Types.IntentSide.BORROW,
            _debtTokenAddress(),
            _collateralTokenAddress(),
            _principal(),
            _borrowMaxRateBps(),
            _minCollateralRatioBps(),
            expiry
        );
        lendIntentId = _registry().postIntent(
            Types.IntentSide.LEND,
            _debtTokenAddress(),
            _collateralTokenAddress(),
            _principal(),
            _lendRateBps(),
            0,
            expiry
        );
    }

    function _executeMatch(address actor, uint256 epochId, bytes32 borrowIntentId, bytes32 lendIntentId)
        internal
        returns (uint256 loanId)
    {
        bytes32[] memory lendIntentIds = new bytes32[](1);
        lendIntentIds[0] = lendIntentId;

        address[] memory lenders = new address[](1);
        lenders[0] = actor;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _principal();

        Types.MatchExecutionParams memory params = _matchParams(actor, epochId, borrowIntentId, lendIntentId);
        bytes32 digest = _coordinator().computeMatchDigest(params, lendIntentIds, lenders, amounts);

        _coordinator().registerMatchDigest(epochId, digest);
        _coordinator().finalizeEpoch(epochId);
        loanId = _coordinator().executeMatch(params, lendIntentIds, lenders, amounts);
    }

    function _matchParams(address actor, uint256 epochId, bytes32 borrowIntentId, bytes32 lendIntentId)
        internal
        view
        returns (Types.MatchExecutionParams memory)
    {
        return Types.MatchExecutionParams({
            epochId: epochId,
            borrowIntentId: borrowIntentId,
            borrower: actor,
            token: _debtTokenAddress(),
            collateralToken: _collateralTokenAddress(),
            principal: _principal(),
            collateralAmount: _collateralAmount(),
            weightedRateBps: _lendRateBps(),
            minCollateralRatioBps: _minCollateralRatioBps(),
            durationSeconds: _durationSeconds(),
            borrowerNonce: uint256(keccak256(abi.encode(block.chainid, actor, block.timestamp, borrowIntentId))),
            salt: keccak256(abi.encode(actor, lendIntentId, block.number))
        });
    }

    function _stressLiquidateRepayAndClose(address actor, uint256 loanId)
        internal
        returns (uint256 healthBeforeStress, uint256 healthAfterStress, uint256 claimable)
    {
        healthBeforeStress = _positionManager().healthFactorBps(loanId);
        _collateralFeed().setAnswer(int256(_collateralStressPrice()), block.timestamp);
        healthAfterStress = _positionManager().healthFactorBps(loanId);

        _liquidationManager().liquidate(loanId, _liquidationRepayAmount());
        Types.Loan memory afterLiquidation = _loanCore().getLoan(loanId);
        if (afterLiquidation.outstandingPrincipal > 0) {
            _positionManager().repay(loanId, afterLiquidation.outstandingPrincipal);
        }

        Types.Loan memory repaid = _loanCore().getLoan(loanId);
        if (repaid.collateralAmount > 0) {
            _positionManager().closePosition(loanId);
        }

        claimable = _loanCore().lenderClaimableByLoan(loanId, actor);
        if (claimable > 0) {
            _loanCore().withdrawClaim(loanId);
        }
    }

    function _verifyWiring(address actor) internal view {
        require(_matcherAddress() == actor, "WORKFLOW: broadcaster must be matcher");
        require(_coordinator().owner() == actor, "WORKFLOW: broadcaster must own coordinator");
        require(_registry().matchingCoordinator() == _matchingCoordinatorAddress(), "WORKFLOW: registry mismatch");
        require(address(_coordinator().intentRegistry()) == _intentRegistryAddress(), "WORKFLOW: coordinator registry");
        require(address(_coordinator().loanCore()) == _loanCoreAddress(), "WORKFLOW: coordinator loan core");
        require(_coordinator().isMatcher(actor), "WORKFLOW: matcher not authorized");
        require(_loanCore().isCoordinator(_matchingCoordinatorAddress()), "WORKFLOW: coordinator role missing");
        require(_loanCore().isPositionManager(_positionManagerAddress()), "WORKFLOW: position role missing");
        require(_loanCore().isLiquidationManager(_liquidationManagerAddress()), "WORKFLOW: liquidation role missing");
        require(address(_positionManager().oracle()) == _oracleRouterAddress(), "WORKFLOW: position oracle");
        require(address(_liquidationManager().oracle()) == _oracleRouterAddress(), "WORKFLOW: liquidation oracle");
        require(address(_oracleRouter().primaryOracle()) == _chainlinkOracleAddress(), "WORKFLOW: primary oracle");
        _verifyFeed(_debtTokenAddress(), _debtFeedAddress(), "WORKFLOW: debt feed");
        _verifyFeed(_collateralTokenAddress(), _collateralFeedAddress(), "WORKFLOW: collateral feed");
    }

    function _verifyFeed(address token, address expectedFeed, string memory message) internal view {
        (address configuredFeed,) = _chainlinkOracle().feedByToken(token);
        require(configuredFeed == expectedFeed, message);
    }

    function _openOrUseEpoch() internal returns (uint256 epochId) {
        uint256 currentEpochId = _coordinator().currentEpochId();
        if (currentEpochId > 0) {
            (bool open, bool finalized,,) = _coordinator().epochs(currentEpochId);
            if (open && !finalized) return currentEpochId;
        }
        return _coordinator().openEpoch();
    }

    function _workflowPrivateKey() internal view returns (uint256 privateKey) {
        privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (privateKey == 0) privateKey = vm.envOr("CRE_ETH_PRIVATE_KEY", uint256(0));
        if (privateKey == 0) privateKey = vm.envOr("EXECUTOR_PRIVATE_KEY", uint256(0));
        require(privateKey != 0, "WORKFLOW: PRIVATE_KEY missing");
    }

    function _chainId() internal view returns (uint256) {
        return vm.envOr("CHAIN_ID", DEFAULT_CHAIN_ID);
    }

    function _intentRegistryAddress() internal view returns (address) {
        return vm.envOr("INTENT_REGISTRY_ADDRESS", DEFAULT_INTENT_REGISTRY);
    }

    function _loanCoreAddress() internal view returns (address) {
        return vm.envOr("LOAN_CORE_ADDRESS", DEFAULT_LOAN_CORE);
    }

    function _matchingCoordinatorAddress() internal view returns (address) {
        return vm.envOr("MATCHING_COORDINATOR_ADDRESS", DEFAULT_MATCHING_COORDINATOR);
    }

    function _chainlinkOracleAddress() internal view returns (address) {
        return vm.envOr("CHAINLINK_ORACLE_ADDRESS", DEFAULT_CHAINLINK_ORACLE);
    }

    function _oracleRouterAddress() internal view returns (address) {
        return vm.envOr("ORACLE_ROUTER_ADDRESS", DEFAULT_ORACLE_ROUTER);
    }

    function _positionManagerAddress() internal view returns (address) {
        return vm.envOr("POSITION_MANAGER_ADDRESS", DEFAULT_POSITION_MANAGER);
    }

    function _liquidationManagerAddress() internal view returns (address) {
        return vm.envOr("LIQUIDATION_MANAGER_ADDRESS", DEFAULT_LIQUIDATION_MANAGER);
    }

    function _matcherAddress() internal view returns (address) {
        return vm.envOr("MATCHER_ADDRESS", DEFAULT_MATCHER);
    }

    function _debtTokenAddress() internal view returns (address) {
        return vm.envOr("DEBT_TOKEN", DEFAULT_DEBT_TOKEN);
    }

    function _collateralTokenAddress() internal view returns (address) {
        return vm.envOr("COLLATERAL_TOKEN", DEFAULT_COLLATERAL_TOKEN);
    }

    function _debtFeedAddress() internal view returns (address) {
        return vm.envOr("DEBT_FEED", DEFAULT_DEBT_FEED);
    }

    function _collateralFeedAddress() internal view returns (address) {
        return vm.envOr("COLLATERAL_FEED", DEFAULT_COLLATERAL_FEED);
    }

    function _mintDebtAmount() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_MINT_DEBT_AMOUNT", uint256(1_000e6));
    }

    function _mintCollateralAmount() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_MINT_COLLATERAL_AMOUNT", uint256(1_000e18));
    }

    function _principal() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_PRINCIPAL", uint256(100e6));
    }

    function _collateralAmount() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_COLLATERAL_AMOUNT", uint256(140e18));
    }

    function _lendRateBps() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_LEND_RATE_BPS", uint256(700));
    }

    function _borrowMaxRateBps() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_BORROW_MAX_RATE_BPS", uint256(950));
    }

    function _minCollateralRatioBps() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_MIN_COLLATERAL_RATIO_BPS", uint256(13_000));
    }

    function _durationSeconds() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_DURATION_SECONDS", uint256(7 days));
    }

    function _intentExpirySeconds() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_INTENT_EXPIRY_SECONDS", uint256(1 days));
    }

    function _debtPrice() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_DEBT_PRICE", uint256(1e8));
    }

    function _collateralPrice() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_COLLATERAL_PRICE", uint256(1e8));
    }

    function _collateralStressPrice() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_COLLATERAL_STRESS_PRICE", uint256(5e7));
    }

    function _liquidationRepayAmount() internal view returns (uint256) {
        return vm.envOr("WORKFLOW_LIQUIDATION_REPAY_AMOUNT", uint256(50e6));
    }

    function _registry() internal view returns (IntentRegistry) {
        return IntentRegistry(_intentRegistryAddress());
    }

    function _coordinator() internal view returns (MatchingCoordinator) {
        return MatchingCoordinator(_matchingCoordinatorAddress());
    }

    function _loanCore() internal view returns (LoanCore) {
        return LoanCore(_loanCoreAddress());
    }

    function _positionManager() internal view returns (PositionManager) {
        return PositionManager(_positionManagerAddress());
    }

    function _liquidationManager() internal view returns (LiquidationManager) {
        return LiquidationManager(_liquidationManagerAddress());
    }

    function _chainlinkOracle() internal view returns (ChainlinkOracle) {
        return ChainlinkOracle(_chainlinkOracleAddress());
    }

    function _oracleRouter() internal view returns (OracleRouter) {
        return OracleRouter(_oracleRouterAddress());
    }

    function _debt() internal view returns (MockERC20) {
        return MockERC20(_debtTokenAddress());
    }

    function _collateral() internal view returns (MockERC20) {
        return MockERC20(_collateralTokenAddress());
    }

    function _debtFeed() internal view returns (MockChainlinkFeed) {
        return MockChainlinkFeed(_debtFeedAddress());
    }

    function _collateralFeed() internal view returns (MockChainlinkFeed) {
        return MockChainlinkFeed(_collateralFeedAddress());
    }
}
