// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./access/OwnableLite.sol";
import {LoanCore} from "./LoanCore.sol";
import {Types} from "./libraries/Types.sol";
import {Errors} from "./libraries/Errors.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IERC20Metadata} from "./interfaces/IERC20Metadata.sol";

contract PositionManager is OwnableLite {
    LoanCore public immutable loanCore;
    IPriceOracle public oracle;

    event OracleUpdated(address indexed previousOracle, address indexed newOracle);

    constructor(address loanCore_, address oracle_) {
        if (loanCore_ == address(0) || oracle_ == address(0)) revert Errors.InvalidAddress();
        loanCore = LoanCore(loanCore_);
        oracle = IPriceOracle(oracle_);
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle_ == address(0)) revert Errors.InvalidAddress();
        address previous = address(oracle);
        oracle = IPriceOracle(oracle_);
        emit OracleUpdated(previous, oracle_);
    }

    function repay(uint256 loanId, uint256 amount) external {
        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.borrower != msg.sender) revert Errors.Unauthorized();
        loanCore.repayFromPositionManager(loanId, msg.sender, amount);
    }

    function addCollateral(uint256 loanId, uint256 amount) external {
        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.borrower != msg.sender) revert Errors.Unauthorized();
        loanCore.addCollateralFromPositionManager(loanId, msg.sender, amount);
    }

    function removeCollateral(uint256 loanId, uint256 amount) external {
        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.borrower != msg.sender) revert Errors.Unauthorized();
        if (amount == 0 || amount > loan.collateralAmount) revert Errors.InvalidAmount();

        if (loan.outstandingPrincipal > 0) {
            uint256 projectedHealth = _healthFactorBps(
                loan.outstandingPrincipal,
                loan.collateralAmount - amount,
                loan.token,
                loan.collateralToken
            );
            if (projectedHealth < loan.minCollateralRatioBps) revert Errors.InvalidState();
        }

        loanCore.removeCollateralToBorrower(loanId, amount);
    }

    function closePosition(uint256 loanId) external {
        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.borrower != msg.sender) revert Errors.Unauthorized();
        if (loan.outstandingPrincipal != 0) revert Errors.InvalidState();
        if (loan.collateralAmount == 0) revert Errors.InvalidAmount();
        loanCore.removeCollateralToBorrower(loanId, loan.collateralAmount);
    }

    function healthFactorBps(uint256 loanId) external view returns (uint256) {
        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.outstandingPrincipal == 0) return type(uint256).max;
        return _healthFactorBps(loan.outstandingPrincipal, loan.collateralAmount, loan.token, loan.collateralToken);
    }

    function _healthFactorBps(
        uint256 debtAmount,
        uint256 collateralAmount,
        address debtToken,
        address collateralToken
    ) internal view returns (uint256) {
        (uint256 debtPrice,) = oracle.getPrice(debtToken);
        (uint256 collateralPrice,) = oracle.getPrice(collateralToken);
        if (debtPrice == 0 || collateralPrice == 0) revert Errors.OracleBadPrice();

        uint256 debtValue = (_scaleTo1e18(debtAmount, debtToken) * debtPrice) / 1e8;
        uint256 collateralValue = (_scaleTo1e18(collateralAmount, collateralToken) * collateralPrice) / 1e8;
        if (debtValue == 0) return type(uint256).max;
        return (collateralValue * 10_000) / debtValue;
    }

    function _scaleTo1e18(uint256 amount, address token) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals == 18) return amount;
        if (decimals < 18) return amount * (10 ** (18 - decimals));
        return amount / (10 ** (decimals - 18));
    }
}
