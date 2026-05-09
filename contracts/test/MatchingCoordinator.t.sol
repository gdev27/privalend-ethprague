// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {IntentRegistry} from "../src/IntentRegistry.sol";
import {MatchingCoordinator} from "../src/MatchingCoordinator.sol";
import {LoanCore} from "../src/LoanCore.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Types} from "../src/libraries/Types.sol";
import {Errors} from "../src/libraries/Errors.sol";

contract MatchingCoordinatorTest is Test {
    IntentRegistry internal registry;
    MatchingCoordinator internal coordinator;
    LoanCore internal core;
    MockERC20 internal debt;
    MockERC20 internal collateral;

    address internal matcher = address(0x7777);
    address internal borrower = address(0xB0B);
    address internal lenderA = address(0xA11CE);
    address internal lenderB = address(0x5E11);

    function setUp() public {
        registry = new IntentRegistry();
        core = new LoanCore();
        coordinator = new MatchingCoordinator(address(registry), address(core));

        registry.setMatchingCoordinator(address(coordinator));
        core.setCoordinator(address(coordinator), true);
        coordinator.setMatcher(matcher, true);

        debt = new MockERC20(6);
        collateral = new MockERC20(6);
        debt.mint(lenderA, 1_000e6);
        debt.mint(lenderB, 1_000e6);
        collateral.mint(borrower, 2_000e6);

        vm.prank(lenderA);
        debt.approve(address(core), type(uint256).max);
        vm.prank(lenderB);
        debt.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        collateral.approve(address(core), type(uint256).max);
    }

    function testRegistersAndExecutesFinalizedEpochMatch() public {
        vm.prank(borrower);
        bytes32 borrowIntentId = registry.postIntent(
            Types.IntentSide.BORROW,
            address(debt),
            address(collateral),
            100e6,
            950,
            12_000,
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
        uint256 borrowerNonce = 1;
        bytes32 salt = bytes32(uint256(0x999));

        Types.MatchExecutionParams memory params = Types.MatchExecutionParams({
            epochId: epochId,
            borrowIntentId: borrowIntentId,
            borrower: borrower,
            token: address(debt),
            collateralToken: address(collateral),
            principal: 100e6,
            collateralAmount: 140e6,
            weightedRateBps: 800,
            minCollateralRatioBps: 12_000,
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

        Types.Loan memory loan = core.getLoan(loanId);
        assertEq(loan.borrower, borrower);
        assertEq(loan.outstandingPrincipal, 100e6);
        assertTrue(coordinator.consumedBorrowerNonce(borrower, borrowerNonce));
    }

    function testRejectsReplayForDigestAndBorrowerNonce() public {
        vm.prank(borrower);
        bytes32 borrowIntentId = registry.postIntent(
            Types.IntentSide.BORROW,
            address(debt),
            address(collateral),
            100e6,
            950,
            12_000,
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
        uint256 borrowerNonce = 9;

        Types.MatchExecutionParams memory params = Types.MatchExecutionParams({
            epochId: epochId,
            borrowIntentId: borrowIntentId,
            borrower: borrower,
            token: address(debt),
            collateralToken: address(collateral),
            principal: 100e6,
            collateralAmount: 140e6,
            weightedRateBps: 800,
            minCollateralRatioBps: 12_000,
            durationSeconds: 7 days,
            borrowerNonce: borrowerNonce,
            salt: bytes32(uint256(0x111))
        });

        bytes32 digest = coordinator.computeMatchDigest(params, lendIntentIds, lenders, amounts);
        vm.prank(matcher);
        coordinator.registerMatchDigest(epochId, digest);
        coordinator.finalizeEpoch(epochId);

        vm.prank(matcher);
        coordinator.executeMatch(params, lendIntentIds, lenders, amounts);

        vm.prank(matcher);
        vm.expectRevert(Errors.Replay.selector);
        coordinator.executeMatch(params, lendIntentIds, lenders, amounts);

        vm.prank(borrower);
        bytes32 borrowIntentId2 = registry.postIntent(
            Types.IntentSide.BORROW,
            address(debt),
            address(collateral),
            100e6,
            950,
            12_000,
            block.timestamp + 1 days
        );
        vm.prank(lenderA);
        bytes32 lendIntentA2 = registry.postIntent(
            Types.IntentSide.LEND, address(debt), address(collateral), 70e6, 700, 0, block.timestamp + 1 days
        );
        vm.prank(lenderB);
        bytes32 lendIntentB2 = registry.postIntent(
            Types.IntentSide.LEND, address(debt), address(collateral), 30e6, 750, 0, block.timestamp + 1 days
        );

        uint256 epochId2 = coordinator.openEpoch();
        bytes32[] memory lendIntentIds2 = new bytes32[](2);
        lendIntentIds2[0] = lendIntentA2;
        lendIntentIds2[1] = lendIntentB2;
        address[] memory lenders2 = new address[](2);
        lenders2[0] = lenderA;
        lenders2[1] = lenderB;
        uint256[] memory amounts2 = new uint256[](2);
        amounts2[0] = 70e6;
        amounts2[1] = 30e6;

        Types.MatchExecutionParams memory params2 = Types.MatchExecutionParams({
            epochId: epochId2,
            borrowIntentId: borrowIntentId2,
            borrower: borrower,
            token: address(debt),
            collateralToken: address(collateral),
            principal: 100e6,
            collateralAmount: 150e6,
            weightedRateBps: 800,
            minCollateralRatioBps: 12_000,
            durationSeconds: 7 days,
            borrowerNonce: borrowerNonce,
            salt: bytes32(uint256(0x222))
        });

        bytes32 digest2 = coordinator.computeMatchDigest(params2, lendIntentIds2, lenders2, amounts2);
        vm.prank(matcher);
        coordinator.registerMatchDigest(epochId2, digest2);
        coordinator.finalizeEpoch(epochId2);

        vm.prank(matcher);
        vm.expectRevert(Errors.Replay.selector);
        coordinator.executeMatch(params2, lendIntentIds2, lenders2, amounts2);
    }
}
