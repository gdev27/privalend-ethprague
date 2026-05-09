// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {LoanCore} from "../src/LoanCore.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Types} from "../src/libraries/Types.sol";
import {Errors} from "../src/libraries/Errors.sol";

contract LoanCoreTest is Test {
    LoanCore internal core;
    MockERC20 internal debt;
    MockERC20 internal collateral;

    address internal coordinator = address(0xC0);
    address internal positionManager = address(0x9000);
    address internal borrower = address(0xB0B);
    address internal lenderA = address(0xA11CE);
    address internal lenderB = address(0x5E11);

    function setUp() public {
        core = new LoanCore();
        debt = new MockERC20(6);
        collateral = new MockERC20(6);

        core.setCoordinator(coordinator, true);
        core.setPositionManager(positionManager, true);

        debt.mint(lenderA, 1000e6);
        debt.mint(lenderB, 1000e6);
        debt.mint(borrower, 1000e6);
        collateral.mint(borrower, 2000e6);

        vm.prank(lenderA);
        debt.approve(address(core), type(uint256).max);
        vm.prank(lenderB);
        debt.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        collateral.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        debt.approve(address(core), type(uint256).max);
    }

    function testCreateRepayAndWithdraw() public {
        address[] memory lenders = new address[](2);
        lenders[0] = lenderA;
        lenders[1] = lenderB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 70e6;
        amounts[1] = 30e6;

        vm.prank(coordinator);
        uint256 loanId = core.createLoanFromMatch(
            borrower,
            address(debt),
            address(collateral),
            100e6,
            150e6,
            800,
            12_000,
            7 days,
            lenders,
            amounts
        );

        Types.Loan memory loan = core.getLoan(loanId);
        assertEq(loan.outstandingPrincipal, 100e6);
        assertEq(debt.balanceOf(borrower), 1100e6);
        assertEq(collateral.balanceOf(address(core)), 150e6);

        vm.prank(positionManager);
        core.repayFromPositionManager(loanId, borrower, 100e6);

        loan = core.getLoan(loanId);
        assertEq(loan.outstandingPrincipal, 0);
        assertEq(uint8(loan.status), uint8(Types.LoanStatus.REPAID));

        vm.prank(lenderA);
        core.withdrawClaim(loanId);
        vm.prank(lenderB);
        core.withdrawClaim(loanId);

        assertEq(debt.balanceOf(lenderA), 1000e6);
        assertEq(debt.balanceOf(lenderB), 1000e6);
    }

    function testRejectsDuplicateLendersInSingleLoan() public {
        address[] memory lenders = new address[](2);
        lenders[0] = lenderA;
        lenders[1] = lenderA;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 60e6;
        amounts[1] = 40e6;

        vm.prank(coordinator);
        vm.expectRevert(Errors.AlreadyExists.selector);
        core.createLoanFromMatch(
            borrower,
            address(debt),
            address(collateral),
            100e6,
            150e6,
            800,
            12_000,
            7 days,
            lenders,
            amounts
        );
    }
}
