// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {EngineRegistry} from "../src/EngineRegistry.sol";
import {PrivaLendPool} from "../src/PrivaLendPool.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Errors} from "../src/libraries/Errors.sol";

contract PrivaLendPoolTest is Test {
    EngineRegistry internal engineRegistry;
    PrivaLendPool internal pool;
    MockERC20 internal debt;
    MockERC20 internal collateral;

    uint256 internal kmsPrivateKey = 0xA11CE;
    uint256 internal otherPrivateKey = 0xB0B;
    address internal kmsAddress;
    address internal borrower = address(0xB0B);
    address internal lenderA = address(0xA11CE);
    address internal lenderB = address(0x5E11);

    event LoanMatched(bytes32 indexed proposalId, address indexed borrower, uint256 principal);

    function setUp() public {
        kmsAddress = vm.addr(kmsPrivateKey);
        engineRegistry = new EngineRegistry(kmsAddress);
        pool = new PrivaLendPool(address(engineRegistry));
        debt = new MockERC20("Mock USDC", "USDC", 6);
        collateral = new MockERC20("Mock USDC", "USDC", 6);

        debt.mint(lenderA, 1_000e6);
        debt.mint(lenderB, 1_000e6);
        collateral.mint(borrower, 500e6);

        vm.prank(lenderA);
        debt.approve(address(pool), type(uint256).max);
        vm.prank(lenderB);
        debt.approve(address(pool), type(uint256).max);
        vm.prank(borrower);
        collateral.approve(address(pool), type(uint256).max);
    }

    function testSettleMatchTransfersPrincipalAndEscrowsCollateral() public {
        (
            PrivaLendPool.ProposalTerms memory terms,
            PrivaLendPool.MatchedTick[] memory ticks,
            bytes32 proposalHash,
            bytes memory signature
        ) = _signedProposal(kmsPrivateKey);

        vm.expectEmit(true, true, false, true, address(pool));
        emit LoanMatched(terms.proposalId, borrower, 100e6);
        pool.settleMatch(terms, ticks, proposalHash, signature);
        uint256 loanId = 1;

        PrivaLendPool.Loan memory loan = pool.getLoan(loanId);
        assertEq(loan.borrower, borrower);
        assertEq(loan.principal, 100e6);
        assertEq(loan.outstandingPrincipal, 100e6);
        assertEq(loan.collateralAmount, 150e6);
        assertEq(uint8(loan.status), uint8(PrivaLendPool.LoanStatus.ACTIVE));

        assertEq(debt.balanceOf(borrower), 100e6);
        assertEq(debt.balanceOf(lenderA), 930e6);
        assertEq(debt.balanceOf(lenderB), 970e6);
        assertEq(collateral.balanceOf(address(pool)), 150e6);
        assertTrue(pool.consumedProposalHash(proposalHash));
    }

    function testRejectsReplay() public {
        (
            PrivaLendPool.ProposalTerms memory terms,
            PrivaLendPool.MatchedTick[] memory ticks,
            bytes32 proposalHash,
            bytes memory signature
        ) = _signedProposal(kmsPrivateKey);
        pool.settleMatch(terms, ticks, proposalHash, signature);

        vm.expectRevert(PrivaLendPool.ProposalAlreadySettled.selector);
        pool.settleMatch(terms, ticks, proposalHash, signature);
    }

    function testRejectsInvalidSignature() public {
        (
            PrivaLendPool.ProposalTerms memory terms,
            PrivaLendPool.MatchedTick[] memory ticks,
            bytes32 proposalHash,
            bytes memory signature
        ) = _signedProposal(otherPrivateKey);

        vm.expectRevert(PrivaLendPool.InvalidSignature.selector);
        pool.settleMatch(terms, ticks, proposalHash, signature);
    }

    function testRejectsHashMismatch() public {
        (
            PrivaLendPool.ProposalTerms memory terms,
            PrivaLendPool.MatchedTick[] memory ticks,
            bytes32 proposalHash,
            bytes memory signature
        ) = _signedProposal(kmsPrivateKey);
        terms.principal = 101e6;

        vm.expectRevert(PrivaLendPool.ProposalHashMismatch.selector);
        pool.settleMatch(terms, ticks, proposalHash, signature);
    }

    function testRepayWithdrawClaimsAndClosePosition() public {
        (
            PrivaLendPool.ProposalTerms memory terms,
            PrivaLendPool.MatchedTick[] memory ticks,
            bytes32 proposalHash,
            bytes memory signature
        ) = _signedProposal(kmsPrivateKey);
        pool.settleMatch(terms, ticks, proposalHash, signature);
        uint256 loanId = 1;

        vm.prank(borrower);
        debt.approve(address(pool), type(uint256).max);
        vm.prank(borrower);
        pool.repay(loanId, 100e6);

        PrivaLendPool.Loan memory loan = pool.getLoan(loanId);
        assertEq(loan.outstandingPrincipal, 0);
        assertEq(uint8(loan.status), uint8(PrivaLendPool.LoanStatus.REPAID));
        assertEq(pool.lenderClaimableByLoan(loanId, lenderA), 70e6);
        assertEq(pool.lenderClaimableByLoan(loanId, lenderB), 30e6);

        vm.prank(lenderA);
        pool.withdrawClaim(loanId);
        vm.prank(lenderB);
        pool.withdrawClaim(loanId);
        assertEq(debt.balanceOf(lenderA), 1_000e6);
        assertEq(debt.balanceOf(lenderB), 1_000e6);

        vm.prank(borrower);
        pool.closePosition(loanId);
        loan = pool.getLoan(loanId);
        assertEq(loan.collateralAmount, 0);
        assertEq(collateral.balanceOf(borrower), 500e6);
    }

    function testRejectsDuplicateLenders() public {
        (PrivaLendPool.ProposalTerms memory terms, PrivaLendPool.MatchedTick[] memory ticks) = _proposal();
        ticks[1].lender = lenderA;
        bytes32 proposalHash = pool.computeProposalHash(terms, ticks);
        bytes memory signature = _sign(kmsPrivateKey, proposalHash);

        vm.expectRevert(Errors.AlreadyExists.selector);
        pool.settleMatch(terms, ticks, proposalHash, signature);
    }

    function _signedProposal(uint256 signerPrivateKey)
        internal
        view
        returns (
            PrivaLendPool.ProposalTerms memory terms,
            PrivaLendPool.MatchedTick[] memory ticks,
            bytes32 proposalHash,
            bytes memory signature
        )
    {
        (terms, ticks) = _proposal();
        proposalHash = pool.computeProposalHash(terms, ticks);
        signature = _sign(signerPrivateKey, proposalHash);
    }

    function _proposal()
        internal
        view
        returns (PrivaLendPool.ProposalTerms memory terms, PrivaLendPool.MatchedTick[] memory ticks)
    {
        ticks = new PrivaLendPool.MatchedTick[](2);
        ticks[0] = PrivaLendPool.MatchedTick({
            lender: lenderA,
            lendIntentId: keccak256(bytes("lend-a")),
            amount: 70e6,
            rate: 700e14
        });
        ticks[1] = PrivaLendPool.MatchedTick({
            lender: lenderB,
            lendIntentId: keccak256(bytes("lend-b")),
            amount: 30e6,
            rate: 800e14
        });

        terms = PrivaLendPool.ProposalTerms({
            proposalId: keccak256(bytes("proposal-1")),
            borrowIntentId: keccak256(bytes("borrow-1")),
            borrower: borrower,
            token: address(debt),
            principal: 100e6,
            effectiveBorrowerRate: 730e14,
            collateralToken: address(collateral),
            collateralAmount: 150e6
        });
    }

    function _sign(uint256 privateKey, bytes32 proposalHash) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", proposalHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
