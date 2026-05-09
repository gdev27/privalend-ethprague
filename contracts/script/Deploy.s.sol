// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";
import {MatchingCoordinator} from "../src/MatchingCoordinator.sol";
import {LoanCore} from "../src/LoanCore.sol";
import {PositionManager} from "../src/PositionManager.sol";
import {LiquidationManager} from "../src/LiquidationManager.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        _deployModular();
        vm.stopBroadcast();
    }

    function _deployModular() internal {
        IntentRegistry intentRegistry = new IntentRegistry();
        LoanCore loanCore = new LoanCore();
        MatchingCoordinator matchingCoordinator = new MatchingCoordinator(address(intentRegistry), address(loanCore));

        ChainlinkOracle chainlinkOracle = new ChainlinkOracle();
        OracleRouter oracleRouter = new OracleRouter(address(chainlinkOracle));
        PositionManager positionManager = new PositionManager(address(loanCore), address(oracleRouter));
        LiquidationManager liquidationManager = new LiquidationManager(address(loanCore), address(oracleRouter));

        intentRegistry.setMatchingCoordinator(address(matchingCoordinator));
        address matcher = _requireEnvAddress("MATCHER_ADDRESS");
        matchingCoordinator.setMatcher(matcher, true);

        loanCore.setCoordinator(address(matchingCoordinator), true);
        loanCore.setPositionManager(address(positionManager), true);
        loanCore.setLiquidationManager(address(liquidationManager), true);

        address debtToken = _requireEnvAddress("DEBT_TOKEN");
        address collateralToken = _requireEnvAddress("COLLATERAL_TOKEN");
        address debtFeed = _requireEnvAddress("DEBT_FEED");
        address collateralFeed = _requireEnvAddress("COLLATERAL_FEED");
        require(debtToken != collateralToken, "DEPLOY: token pair invalid");
        require(debtFeed != collateralFeed, "DEPLOY: feed pair invalid");

        uint32 maxOracleStaleness = uint32(vm.envUint("MAX_ORACLE_STALENESS"));
        require(maxOracleStaleness > 0, "DEPLOY: stale window invalid");
        chainlinkOracle.setFeed(debtToken, debtFeed, maxOracleStaleness);
        chainlinkOracle.setFeed(collateralToken, collateralFeed, maxOracleStaleness);

        uint256 closeFactorBps = vm.envOr("CLOSE_FACTOR_BPS", uint256(5_000));
        uint256 liquidationBonusBps = vm.envOr("LIQUIDATION_BONUS_BPS", uint256(500));
        require(closeFactorBps > 0 && closeFactorBps <= 10_000, "DEPLOY: close factor invalid");
        require(liquidationBonusBps <= 5_000, "DEPLOY: liquidation bonus invalid");
        liquidationManager.setRiskParams(closeFactorBps, liquidationBonusBps);
    }

    function _requireEnvAddress(string memory key) internal view returns (address value) {
        value = vm.envAddress(key);
        require(value != address(0), "DEPLOY: zero address");
    }
}
