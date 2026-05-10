// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {LoanCore} from "../src/LoanCore.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {MockChainlinkFeed} from "../src/mocks/MockChainlinkFeed.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Types} from "../src/libraries/Types.sol";
import {Errors} from "../src/libraries/Errors.sol";

contract LiquidationManagerTest is Test {
    LoanCore internal core;
    LiquidationManager internal liquidationManager;
    ChainlinkOracle internal chainlinkOracle;
    OracleRouter internal oracleRouter;
    MockChainlinkFeed internal debtFeed;
    MockChainlinkFeed internal collateralFeed;
    MockERC20 internal debt;
    MockERC20 internal collateral;

    address internal coordinator = address(0x1111);
    address internal borrower = address(0xB0B);
    address internal lender = address(0xA11CE);
    address internal liquidator = address(0x1A2B);

    function setUp() public {
        core = new LoanCore();
        chainlinkOracle = new ChainlinkOracle();
        oracleRouter = new OracleRouter(address(chainlinkOracle));
        liquidationManager = new LiquidationManager(address(core), address(oracleRouter));

        core.setCoordinator(coordinator, true);
        core.setLiquidationManager(address(liquidationManager), true);

        debt = new MockERC20("Mock USDC", "USDC", 6);
        collateral = new MockERC20("Mock USDC", "USDC", 6);
        debtFeed = new MockChainlinkFeed(8);
        collateralFeed = new MockChainlinkFeed(8);
        debtFeed.setAnswer(1e8, block.timestamp);
        collateralFeed.setAnswer(1e8, block.timestamp);
        chainlinkOracle.setFeed(address(debt), address(debtFeed), 1 days);
        chainlinkOracle.setFeed(address(collateral), address(collateralFeed), 1 days);

        debt.mint(lender, 1_000e6);
        collateral.mint(borrower, 2_000e6);
        debt.mint(liquidator, 1_000e6);

        vm.prank(lender);
        debt.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        collateral.approve(address(core), type(uint256).max);
        vm.prank(liquidator);
        debt.approve(address(core), type(uint256).max);
    }

    function testLiquidatesWhenHealthFallsBelowThreshold() public {
        address[] memory lenders = new address[](1);
        lenders[0] = lender;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e6;

        vm.prank(coordinator);
        uint256 loanId = core.createLoanFromMatch(
            borrower,
            address(debt),
            address(collateral),
            100e6,
            110e6,
            900,
            12_000,
            10 days,
            lenders,
            amounts
        );

        uint256 healthBefore = liquidationManager.healthFactorBps(loanId);
        assertLt(healthBefore, 12_000);

        vm.prank(liquidator);
        liquidationManager.liquidate(loanId, 50e6);

        Types.Loan memory loanAfter = core.getLoan(loanId);
        assertEq(loanAfter.outstandingPrincipal, 50e6);
        assertGt(collateral.balanceOf(liquidator), 0);
    }

    function testCloseFactorClampLimitsRepayAmount() public {
        address[] memory lenders = new address[](1);
        lenders[0] = lender;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e6;

        vm.prank(coordinator);
        uint256 loanId = core.createLoanFromMatch(
            borrower,
            address(debt),
            address(collateral),
            100e6,
            110e6,
            900,
            12_000,
            10 days,
            lenders,
            amounts
        );

        vm.prank(liquidator);
        liquidationManager.liquidate(loanId, 100e6);

        Types.Loan memory loanAfter = core.getLoan(loanId);
        assertEq(loanAfter.outstandingPrincipal, 50e6);
    }

    function testDecimalMismatchAndRoundingProducesNonZeroSeizure() public {
        MockERC20 debt18 = new MockERC20("Mock WETH", "WETH", 18);
        MockERC20 collateral6 = new MockERC20("Mock USDC", "USDC", 6);
        MockChainlinkFeed debt18Feed = new MockChainlinkFeed(8);
        MockChainlinkFeed collateral6Feed = new MockChainlinkFeed(8);
        debt18Feed.setAnswer(1e8, block.timestamp);
        collateral6Feed.setAnswer(2e8, block.timestamp);
        chainlinkOracle.setFeed(address(debt18), address(debt18Feed), 1 days);
        chainlinkOracle.setFeed(address(collateral6), address(collateral6Feed), 1 days);

        debt18.mint(lender, 100e18);
        collateral6.mint(borrower, 500e6);
        debt18.mint(liquidator, 100e18);

        vm.prank(lender);
        debt18.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        collateral6.approve(address(core), type(uint256).max);
        vm.prank(liquidator);
        debt18.approve(address(core), type(uint256).max);

        address[] memory lenders = new address[](1);
        lenders[0] = lender;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e18;

        vm.prank(coordinator);
        uint256 loanId = core.createLoanFromMatch(
            borrower,
            address(debt18),
            address(collateral6),
            1e18,
            400_000,
            900,
            15_000,
            10 days,
            lenders,
            amounts
        );

        vm.prank(liquidator);
        liquidationManager.liquidate(loanId, 0.1e18);

        Types.Loan memory loanAfter = core.getLoan(loanId);
        assertLt(loanAfter.outstandingPrincipal, 1e18);
        assertGt(collateral6.balanceOf(liquidator), 0);
    }

    function testRejectsTinyRepayThatRoundsToZeroSeizure() public {
        MockERC20 debt18 = new MockERC20("Mock WETH", "WETH", 18);
        MockERC20 collateral6 = new MockERC20("Mock USDC", "USDC", 6);
        MockChainlinkFeed debt18Feed = new MockChainlinkFeed(8);
        MockChainlinkFeed collateral6Feed = new MockChainlinkFeed(8);
        debt18Feed.setAnswer(1e8, block.timestamp);
        collateral6Feed.setAnswer(2e8, block.timestamp);
        chainlinkOracle.setFeed(address(debt18), address(debt18Feed), 1 days);
        chainlinkOracle.setFeed(address(collateral6), address(collateral6Feed), 1 days);

        debt18.mint(lender, 100e18);
        collateral6.mint(borrower, 500e6);
        debt18.mint(liquidator, 100e18);

        vm.prank(lender);
        debt18.approve(address(core), type(uint256).max);
        vm.prank(borrower);
        collateral6.approve(address(core), type(uint256).max);
        vm.prank(liquidator);
        debt18.approve(address(core), type(uint256).max);

        address[] memory lenders = new address[](1);
        lenders[0] = lender;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e18;

        vm.prank(coordinator);
        uint256 loanId = core.createLoanFromMatch(
            borrower,
            address(debt18),
            address(collateral6),
            1e18,
            400_000,
            900,
            15_000,
            10 days,
            lenders,
            amounts
        );

        vm.prank(liquidator);
        vm.expectRevert(Errors.InvalidAmount.selector);
        liquidationManager.liquidate(loanId, 1);
    }
}
