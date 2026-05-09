// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library Types {
    enum IntentSide {
        LEND,
        BORROW
    }

    enum LoanStatus {
        NONE,
        ACTIVE,
        REPAID,
        LIQUIDATED,
        DEFAULTED
    }

    struct Intent {
        address maker;
        IntentSide side;
        address token;
        address collateralToken;
        uint256 maxAmount;
        uint256 remainingAmount;
        uint256 rateBps;
        uint256 minCollateralRatioBps;
        uint256 expiry;
        uint256 nonce;
        bool active;
    }

    struct Loan {
        uint256 id;
        address borrower;
        address token;
        address collateralToken;
        uint256 principal;
        uint256 outstandingPrincipal;
        uint256 collateralAmount;
        uint256 weightedRateBps;
        uint256 minCollateralRatioBps;
        uint256 startTimestamp;
        uint256 dueTimestamp;
        LoanStatus status;
    }

    /// @notice Scalar fields for match digest + execution (keeps stack shallow for IR codegen).
    struct MatchExecutionParams {
        uint256 epochId;
        bytes32 borrowIntentId;
        address borrower;
        address token;
        address collateralToken;
        uint256 principal;
        uint256 collateralAmount;
        uint256 weightedRateBps;
        uint256 minCollateralRatioBps;
        uint256 durationSeconds;
        uint256 borrowerNonce;
        bytes32 salt;
    }
}
