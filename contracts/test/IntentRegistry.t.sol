// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {IntentRegistry} from "../src/IntentRegistry.sol";
import {Types} from "../src/libraries/Types.sol";
import {Errors} from "../src/libraries/Errors.sol";

contract IntentRegistryTest is Test {
    IntentRegistry internal registry;
    address internal borrower = address(0xB0B);
    address internal token = address(0x100);
    address internal collateralToken = address(0x200);
    address internal coordinator = address(0xCAFE);

    function setUp() public {
        registry = new IntentRegistry();
        registry.setMatchingCoordinator(coordinator);
    }

    function testPostIntentAndCancel() public {
        vm.prank(borrower);
        bytes32 intentId = registry.postIntent(
            Types.IntentSide.BORROW,
            token,
            collateralToken,
            100e6,
            900,
            12_000,
            block.timestamp + 1 days
        );

        Types.Intent memory intent = registry.intentOf(intentId);
        assertEq(intent.maker, borrower);
        assertEq(uint8(intent.side), uint8(Types.IntentSide.BORROW));
        assertEq(intent.remainingAmount, 100e6);
        assertTrue(intent.active);

        vm.prank(borrower);
        registry.cancelIntent(intentId);
        intent = registry.intentOf(intentId);
        assertFalse(intent.active);
    }

    function testConsumeIntentPartialThenClose() public {
        vm.prank(borrower);
        bytes32 intentId = registry.postIntent(
            Types.IntentSide.BORROW,
            token,
            collateralToken,
            100e6,
            900,
            12_000,
            block.timestamp + 1 days
        );

        vm.prank(coordinator);
        Types.Intent memory intentAfterFirst = registry.consumeIntent(intentId, 40e6);
        assertEq(intentAfterFirst.remainingAmount, 60e6);
        assertTrue(intentAfterFirst.active);

        vm.prank(coordinator);
        Types.Intent memory intentAfterSecond = registry.consumeIntent(intentId, 60e6);
        assertEq(intentAfterSecond.remainingAmount, 0);
        assertFalse(intentAfterSecond.active);
    }

    function testConsumeIntentRejectsUnauthorizedCaller() public {
        vm.prank(borrower);
        bytes32 intentId = registry.postIntent(
            Types.IntentSide.BORROW,
            token,
            collateralToken,
            100e6,
            900,
            12_000,
            block.timestamp + 1 days
        );

        vm.expectRevert(Errors.Unauthorized.selector);
        registry.consumeIntent(intentId, 10e6);
    }
}
