// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./access/OwnableLite.sol";
import {LoanCore} from "./LoanCore.sol";
import {Types} from "./libraries/Types.sol";
import {Errors} from "./libraries/Errors.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {IERC20Metadata} from "./interfaces/IERC20Metadata.sol";

contract LiquidationManager is OwnableLite {
    LoanCore public immutable loanCore;
    IPriceOracle public oracle;

    uint256 public closeFactorBps = 5_000;
    uint256 public liquidationBonusBps = 500;

    event OracleUpdated(address indexed previousOracle, address indexed newOracle);
    event RiskParamsUpdated(uint256 closeFactorBps, uint256 liquidationBonusBps);

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

    function setRiskParams(uint256 closeFactorBps_, uint256 liquidationBonusBps_) external onlyOwner {
        if (closeFactorBps_ == 0 || closeFactorBps_ > 10_000) revert Errors.InvalidAmount();
        if (liquidationBonusBps_ > 5_000) revert Errors.InvalidAmount();
        closeFactorBps = closeFactorBps_;
        liquidationBonusBps = liquidationBonusBps_;
        emit RiskParamsUpdated(closeFactorBps_, liquidationBonusBps_);
    }

    function healthFactorBps(uint256 loanId) public view returns (uint256) {
        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.outstandingPrincipal == 0) return type(uint256).max;
        (uint256 debtPrice,) = oracle.getPrice(loan.token);
        (uint256 collateralPrice,) = oracle.getPrice(loan.collateralToken);
        if (debtPrice == 0 || collateralPrice == 0) revert Errors.OracleBadPrice();

        uint256 debtValue = (_scaleTo1e18(loan.outstandingPrincipal, loan.token) * debtPrice) / 1e8;
        uint256 collateralValue = (_scaleTo1e18(loan.collateralAmount, loan.collateralToken) * collateralPrice) / 1e8;
        if (debtValue == 0) return type(uint256).max;
        return (collateralValue * 10_000) / debtValue;
    }

    function liquidate(uint256 loanId, uint256 requestedRepayAmount) external {
        if (requestedRepayAmount == 0) revert Errors.InvalidAmount();

        Types.Loan memory loan = loanCore.getLoan(loanId);
        if (loan.status != Types.LoanStatus.ACTIVE) revert Errors.InvalidState();

        uint256 currentHealth = healthFactorBps(loanId);
        if (currentHealth >= loan.minCollateralRatioBps) revert Errors.HealthFactorOk();

        uint256 maxCloseAmount = (loan.outstandingPrincipal * closeFactorBps) / 10_000;
        if (maxCloseAmount == 0) maxCloseAmount = loan.outstandingPrincipal;
        uint256 repayAmount = requestedRepayAmount > maxCloseAmount ? maxCloseAmount : requestedRepayAmount;
        if (repayAmount > loan.outstandingPrincipal) repayAmount = loan.outstandingPrincipal;

        (uint256 debtPrice,) = oracle.getPrice(loan.token);
        (uint256 collateralPrice,) = oracle.getPrice(loan.collateralToken);
        if (debtPrice == 0 || collateralPrice == 0) revert Errors.OracleBadPrice();

        uint256 repayValue = (_scaleTo1e18(repayAmount, loan.token) * debtPrice) / 1e8;
        uint256 collateralToSeizeIn1e18 = (repayValue * 1e8) / collateralPrice;
        collateralToSeizeIn1e18 = (collateralToSeizeIn1e18 * (10_000 + liquidationBonusBps)) / 10_000;
        uint256 collateralToSeize = _descaleFrom1e18(collateralToSeizeIn1e18, loan.collateralToken);
        if (collateralToSeize > loan.collateralAmount) collateralToSeize = loan.collateralAmount;
        if (collateralToSeize == 0) revert Errors.InvalidAmount();

        loanCore.applyLiquidation(loanId, msg.sender, repayAmount, collateralToSeize);
    }

    function _scaleTo1e18(uint256 amount, address token) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals == 18) return amount;
        if (decimals < 18) return amount * (10 ** (18 - decimals));
        return amount / (10 ** (decimals - 18));
    }

    function _descaleFrom1e18(uint256 amount, address token) internal view returns (uint256) {
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals == 18) return amount;
        if (decimals < 18) return amount / (10 ** (18 - decimals));
        return amount * (10 ** (decimals - 18));
    }
}
