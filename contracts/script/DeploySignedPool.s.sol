// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import {EngineRegistry} from "../src/EngineRegistry.sol";
import {PrivaLendPool} from "../src/PrivaLendPool.sol";

contract DeploySignedPool is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address kmsAddress = vm.envAddress("KMS_ADDRESS");
        require(kmsAddress != address(0), "DEPLOY: KMS_ADDRESS zero");

        vm.startBroadcast(pk);
        EngineRegistry engineRegistry = new EngineRegistry(kmsAddress);
        new PrivaLendPool(address(engineRegistry));
        vm.stopBroadcast();
    }
}
