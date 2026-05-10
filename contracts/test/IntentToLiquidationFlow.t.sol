// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {IntentRegistry} from "../src/IntentRegistry.sol";
import {MatchingCoordinator} from "../src/MatchingCoordinator.sol";
import {LoanCore} from "../src/LoanCore.sol";
import {PositionManager} from "../src/PositionManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {MockChainlinkFeed} from "../src/mocks/MockChainlinkFeed.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Types} from "../src/libraries/Types.sol";

contract IntentToLiquidationFlowTest is Test {
    IntentRegistry internal registry;
    MatchingCoordinator internal coordinator;
    LoanCore internal core;
    PositionManager internal positionManager;
    LiquidationManager internal liquidationManager;
    ChainlinkOracle internal chainlinkOracle;
    OracleRouter internal oracleRouter;
    MockChainlinkFeed internal debtFeed;
    MockChainlinkFeed internal collateralFeed;
    MockERC20 internal debt;
    MockERC20 internal collateral;

    address internal matcher = address(0x7777);
    address internal borrower = address(0xB0B);
    address internal lenderA = address(0xA11CE);
    address internal lenderB = address(0x5E11);
    address internal liquidator = address(0x1A2B);

    function setUp() public {
        registry = new IntentRegistry();
        core = new LoanCore();
        coordinator = new MatchingCoordinator(address(registry), address(core));

        chainlinkOracle = new ChainlinkOracle();
        oracleRouter = new OracleRouter(address(chainlinkOracle));
        positionManager = new PositionManager(address(core), address(oracleRouter));
        liquidationManager = new LiquidationManager(address(core), address(oracleRouter));

        registry.setMatchingCoordinator(address(coordinator));
        coordinator.setMatcher(matcher, true);
        core.setCoordinator(address(coordinator), true);
        core.setPositionManager(address(positionManager), true);
        core.setLiquidationManager(address(liquidationManager), true);

        debt = new MockERC20("Mock USDC", "USDC", 6);
        collateral = new MockERC20("Mock USDC", "USDC", 6);
        debtFeed = new MockChainlinkFeed(8);
        collateralFeed = new MockChainlinkFeed(8);
        debtFeed.setAnswer(1e8, block.timestamp);
        collateralFeed.setAnswer(1e8, block.timestamp);
        chainlinkOracle.setFeed(address(debt), address(debtFeed), 1 days);
        chainlinkOracle.setFeed(address(collateral), address(collateralFeed), 1 days);

        debt.mint(lenderA, 1_000e6);
        debt.mint(lenderB, 1_000e6);
        debt.mint(borrower, 500e6);
        debt.mint(liquidator, 1_000e6);
        collateral.mint(borrower, 2_000e6);

        vm.prank(lenderA);
        debt.approve(address(core), type(uint256).max);
        vm.prank(lenderB);
        debt.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        collateral.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        debt.approve(address(core), type(uint256).max);
        vm.prank(liquidator);
        debt.approve(address(core), type(uint256).max);
    }

    function testIntentToLiquidationAndRepayFlow() public {
        vm.prank(borrower);
        bytes32 borrowIntentId = registry.postIntent(
            Types.IntentSide.BORROW,
            address(debt),
            address(collateral),
            100e6,
            950,
            13_000,
            block.timestamp + 1 days
        );

        vm.prank(lenderA);
        bytes32 lendIntentA = registry.postIntent(
            Types.IntentSide.LEND, address(debt), address(collateral), 70e6, 700, 0, block.timestamp + 1 days
        );
        vm.prank(lenderB);
        bytes32 lendIntentB = registry.postIntent(
            Types.IntentSide.LEND, address(debt), address(collateral), 30e6, 750, 0, block.timestamp + 1 days
        );

        uint256 epochId = coordinator.openEpoch();
        bytes32[] memory lendIntentIds = new bytes32[](2);
        lendIntentIds[0] = lendIntentA;
        lendIntentIds[1] = lendIntentB;
        address[] memory lenders = new address[](2);
        lenders[0] = lenderA;
        lenders[1] = lenderB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 70e6;
        amounts[1] = 30e6;
        uint256 borrowerNonce = 5;
        bytes32 salt = bytes32(uint256(123));

        Types.MatchExecutionParams memory params = Types.MatchExecutionParams({
            epochId: epochId,
            borrowIntentId: borrowIntentId,
            borrower: borrower,
            token: address(debt),
            collateralToken: address(collateral),
            principal: 100e6,
            collateralAmount: 140e6,
            weightedRateBps: 800,
            minCollateralRatioBps: 13_000,
            durationSeconds: 7 days,
            borrowerNonce: borrowerNonce,
            salt: salt
        });

        bytes32 digest = coordinator.computeMatchDigest(params, lendIntentIds, lenders, amounts);
        vm.prank(matcher);
        coordinator.registerMatchDigest(epochId, digest);
        coordinator.finalizeEpoch(epochId);

        vm.prank(matcher);
        uint256 loanId = coordinator.executeMatch(params, lendIntentIds, lenders, amounts);

        collateralFeed.setAnswer(5e7, block.timestamp); // collateral price drops 50%

        vm.prank(liquidator);
        liquidationManager.liquidate(loanId, 50e6);

        Types.Loan memory afterLiquidation = core.getLoan(loanId);
        assertEq(afterLiquidation.outstandingPrincipal, 50e6);

        vm.prank(borrower);
        positionManager.repay(loanId, 50e6);
        vm.prank(borrower);
        positionManager.closePosition(loanId);

        Types.Loan memory closed = core.getLoan(loanId);
        assertEq(closed.outstandingPrincipal, 0);
        assertEq(closed.collateralAmount, 0);
    }
}
