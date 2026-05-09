// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "./interfaces/IERC20.sol";
import {OwnerRoles} from "./access/OwnerRoles.sol";
import {Errors} from "./libraries/Errors.sol";
import {Types} from "./libraries/Types.sol";

contract LoanCore is OwnerRoles {
    uint256 public nextLoanId = 1;

    mapping(uint256 => Types.Loan) private _loans;
    mapping(uint256 => address[]) private _loanLenders;
    mapping(uint256 => mapping(address => uint256)) public lenderPrincipalByLoan;
    mapping(uint256 => mapping(address => uint256)) public lenderClaimableByLoan;

    mapping(address => bool) public isCoordinator;
    mapping(address => bool) public isPositionManager;
    mapping(address => bool) public isLiquidationManager;

    event CoordinatorUpdated(address indexed account, bool allowed);
    event PositionManagerUpdated(address indexed account, bool allowed);
    event LiquidationManagerUpdated(address indexed account, bool allowed);
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 collateralAmount);
    event LoanRepaid(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 outstandingPrincipal);
    event CollateralAdded(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 collateralAmount);
    event CollateralRemoved(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 collateralAmount);
    event LoanLiquidated(
        uint256 indexed loanId,
        address indexed liquidator,
        uint256 repayAmount,
        uint256 collateralSeized,
        uint256 outstandingPrincipal
    );
    event ClaimWithdrawn(uint256 indexed loanId, address indexed lender, uint256 amount);
    event LoanStatusUpdated(uint256 indexed loanId, Types.LoanStatus status);

    modifier onlyCoordinator() {
        if (!isCoordinator[msg.sender]) revert Errors.Unauthorized();
        _;
    }

    modifier onlyPositionManager() {
        if (!isPositionManager[msg.sender]) revert Errors.Unauthorized();
        _;
    }

    modifier onlyLiquidationManager() {
        if (!isLiquidationManager[msg.sender]) revert Errors.Unauthorized();
        _;
    }

    function setCoordinator(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert Errors.InvalidAddress();
        isCoordinator[account] = allowed;
        emit CoordinatorUpdated(account, allowed);
    }

    function setPositionManager(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert Errors.InvalidAddress();
        isPositionManager[account] = allowed;
        emit PositionManagerUpdated(account, allowed);
    }

    function setLiquidationManager(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert Errors.InvalidAddress();
        isLiquidationManager[account] = allowed;
        emit LiquidationManagerUpdated(account, allowed);
    }

    function createLoanFromMatch(
        address borrower,
        address token,
        address collateralToken,
        uint256 principal,
        uint256 collateralAmount,
        uint256 weightedRateBps,
        uint256 minCollateralRatioBps,
        uint256 durationSeconds,
        address[] calldata lenders,
        uint256[] calldata amounts
    ) external onlyCoordinator returns (uint256 loanId) {
        if (borrower == address(0) || token == address(0) || collateralToken == address(0)) revert Errors.InvalidAddress();
        if (principal == 0 || collateralAmount == 0 || minCollateralRatioBps < 10_000) revert Errors.InvalidAmount();
        if (lenders.length == 0 || lenders.length != amounts.length) revert Errors.InvalidArrayLength();

        uint256 sumPrincipal;
        loanId = nextLoanId++;

        for (uint256 i = 0; i < lenders.length; i++) {
            address lender = lenders[i];
            uint256 amount = amounts[i];
            if (lender == address(0) || amount == 0) revert Errors.InvalidAmount();
            for (uint256 j = 0; j < i; j++) {
                if (lenders[j] == lender) revert Errors.AlreadyExists();
            }
            sumPrincipal += amount;
            lenderPrincipalByLoan[loanId][lender] += amount;
            _loanLenders[loanId].push(lender);
            _safeTransferFrom(token, lender, borrower, amount);
        }
        if (sumPrincipal != principal) revert Errors.InvalidAmount();

        _safeTransferFrom(collateralToken, borrower, address(this), collateralAmount);

        uint256 dueTimestamp = block.timestamp + (durationSeconds == 0 ? 30 days : durationSeconds);
        _loans[loanId] = Types.Loan({
            id: loanId,
            borrower: borrower,
            token: token,
            collateralToken: collateralToken,
            principal: principal,
            outstandingPrincipal: principal,
            collateralAmount: collateralAmount,
            weightedRateBps: weightedRateBps,
            minCollateralRatioBps: minCollateralRatioBps,
            startTimestamp: block.timestamp,
            dueTimestamp: dueTimestamp,
            status: Types.LoanStatus.ACTIVE
        });

        emit LoanCreated(loanId, borrower, principal, collateralAmount);
    }

    function repayFromPositionManager(uint256 loanId, address payer, uint256 amount) external onlyPositionManager {
        if (payer == address(0) || amount == 0) revert Errors.InvalidAmount();
        Types.Loan storage loan = _loans[loanId];
        if (loan.status != Types.LoanStatus.ACTIVE) revert Errors.InvalidState();
        if (amount > loan.outstandingPrincipal) revert Errors.InvalidAmount();

        _safeTransferFrom(loan.token, payer, address(this), amount);
        _distributeRepayment(loanId, amount);
        loan.outstandingPrincipal -= amount;

        if (loan.outstandingPrincipal == 0) {
            loan.status = Types.LoanStatus.REPAID;
            emit LoanStatusUpdated(loanId, Types.LoanStatus.REPAID);
        }

        emit LoanRepaid(loanId, payer, amount, loan.outstandingPrincipal);
    }

    function addCollateralFromPositionManager(uint256 loanId, address payer, uint256 amount) external onlyPositionManager {
        if (payer == address(0) || amount == 0) revert Errors.InvalidAmount();
        Types.Loan storage loan = _loans[loanId];
        if (loan.status != Types.LoanStatus.ACTIVE) revert Errors.InvalidState();
        _safeTransferFrom(loan.collateralToken, payer, address(this), amount);
        loan.collateralAmount += amount;
        emit CollateralAdded(loanId, payer, amount, loan.collateralAmount);
    }

    function removeCollateralToBorrower(uint256 loanId, uint256 amount) external onlyPositionManager {
        if (amount == 0) revert Errors.InvalidAmount();
        Types.Loan storage loan = _loans[loanId];
        if (loan.status != Types.LoanStatus.ACTIVE && loan.status != Types.LoanStatus.REPAID) revert Errors.InvalidState();
        if (loan.collateralAmount < amount) revert Errors.InvalidAmount();
        loan.collateralAmount -= amount;
        _safeTransfer(loan.collateralToken, loan.borrower, amount);
        emit CollateralRemoved(loanId, loan.borrower, amount, loan.collateralAmount);
    }

    function applyLiquidation(
        uint256 loanId,
        address liquidator,
        uint256 repayAmount,
        uint256 collateralToSeize
    ) external onlyLiquidationManager {
        if (liquidator == address(0) || repayAmount == 0 || collateralToSeize == 0) revert Errors.InvalidAmount();
        Types.Loan storage loan = _loans[loanId];
        if (loan.status != Types.LoanStatus.ACTIVE) revert Errors.InvalidState();
        if (repayAmount > loan.outstandingPrincipal) revert Errors.InvalidAmount();
        if (collateralToSeize > loan.collateralAmount) revert Errors.InvalidAmount();

        _safeTransferFrom(loan.token, liquidator, address(this), repayAmount);
        _distributeRepayment(loanId, repayAmount);
        loan.outstandingPrincipal -= repayAmount;
        loan.collateralAmount -= collateralToSeize;
        _safeTransfer(loan.collateralToken, liquidator, collateralToSeize);

        if (loan.outstandingPrincipal == 0 || loan.collateralAmount == 0) {
            loan.status = Types.LoanStatus.LIQUIDATED;
            emit LoanStatusUpdated(loanId, Types.LoanStatus.LIQUIDATED);
        }

        emit LoanLiquidated(loanId, liquidator, repayAmount, collateralToSeize, loan.outstandingPrincipal);
    }

    function markDefault(uint256 loanId) external onlyOwner {
        Types.Loan storage loan = _loans[loanId];
        if (loan.status != Types.LoanStatus.ACTIVE) revert Errors.InvalidState();
        if (block.timestamp <= loan.dueTimestamp) revert Errors.InvalidState();
        loan.status = Types.LoanStatus.DEFAULTED;
        emit LoanStatusUpdated(loanId, Types.LoanStatus.DEFAULTED);
    }

    function withdrawClaim(uint256 loanId) external {
        uint256 claimable = lenderClaimableByLoan[loanId][msg.sender];
        if (claimable == 0) revert Errors.InvalidAmount();
        lenderClaimableByLoan[loanId][msg.sender] = 0;
        address token = _loans[loanId].token;
        _safeTransfer(token, msg.sender, claimable);
        emit ClaimWithdrawn(loanId, msg.sender, claimable);
    }

    function getLoan(uint256 loanId) external view returns (Types.Loan memory) {
        return _loans[loanId];
    }

    function getLoanLenders(uint256 loanId) external view returns (address[] memory) {
        return _loanLenders[loanId];
    }

    function _distributeRepayment(uint256 loanId, uint256 amount) internal {
        address[] memory lenders = _loanLenders[loanId];
        if (lenders.length == 0) revert Errors.InvalidState();

        Types.Loan storage loan = _loans[loanId];
        uint256 distributed;
        for (uint256 i = 0; i < lenders.length; i++) {
            address lender = lenders[i];
            uint256 share = (amount * lenderPrincipalByLoan[loanId][lender]) / loan.principal;
            lenderClaimableByLoan[loanId][lender] += share;
            distributed += share;
        }
        if (distributed < amount) {
            lenderClaimableByLoan[loanId][lenders[0]] += (amount - distributed);
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        bool ok = IERC20(token).transferFrom(from, to, amount);
        if (!ok) revert Errors.TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        bool ok = IERC20(token).transfer(to, amount);
        if (!ok) revert Errors.TransferFailed();
    }
}
