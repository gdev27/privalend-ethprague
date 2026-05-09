# Modular Deployment Verification Checklist

## Pre-deploy

- Ensure all required env vars are set:
  - `PRIVATE_KEY`
  - `MATCHER_ADDRESS`
  - `DEBT_TOKEN`
  - `COLLATERAL_TOKEN`
  - `DEBT_FEED`
  - `COLLATERAL_FEED`
  - `MAX_ORACLE_STALENESS`
  - optional: `CLOSE_FACTOR_BPS`, `LIQUIDATION_BONUS_BPS`
- Confirm debt/collateral token pair is correct for target market.
- Confirm Chainlink feeds match token pair and heartbeat assumptions.
- Confirm risk params are intentional:
  - `0 < CLOSE_FACTOR_BPS <= 10000`
  - `LIQUIDATION_BONUS_BPS <= 5000`

## Post-deploy role and wiring checks

- `IntentRegistry.matchingCoordinator == MatchingCoordinator`.
- `MatchingCoordinator.isMatcher(MATCHER_ADDRESS) == true`.
- `LoanCore.isCoordinator(MatchingCoordinator) == true`.
- `LoanCore.isPositionManager(PositionManager) == true`.
- `LoanCore.isLiquidationManager(LiquidationManager) == true`.
- `OracleRouter.primaryOracle == ChainlinkOracle`.

## Oracle checks

- `ChainlinkOracle.feedByToken(DEBT_TOKEN)` configured and non-zero.
- `ChainlinkOracle.feedByToken(COLLATERAL_TOKEN)` configured and non-zero.
- `OracleRouter.getPrice(DEBT_TOKEN)` returns fresh, non-zero price.
- `OracleRouter.getPrice(COLLATERAL_TOKEN)` returns fresh, non-zero price.

## Functional sanity checks (testnet dry run)

- Create borrow and lend intents through `IntentRegistry`.
- Execute one match through `MatchingCoordinator` and verify loan is active in `LoanCore`.
- Verify health factor reads as expected from `PositionManager` and `LiquidationManager`.
- Simulate adverse price move and execute partial liquidation path.
- Verify lender repayment claims and borrower close-position path.

## Notes

- `weightedRateBps` is currently used for match eligibility checks and metadata; no interest accrual is implemented yet.
