// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {MockChainlinkFeed} from "../src/mocks/MockChainlinkFeed.sol";
import {Errors} from "../src/libraries/Errors.sol";

contract OracleRouterTest is Test {
    ChainlinkOracle internal chainlinkOracle;
    OracleRouter internal router;
    MockChainlinkFeed internal feed;

    address internal token = address(0xAAA);

    function setUp() public {
        chainlinkOracle = new ChainlinkOracle();
        router = new OracleRouter(address(chainlinkOracle));
        feed = new MockChainlinkFeed(8);
        feed.setAnswer(2_000e8, block.timestamp);
        chainlinkOracle.setFeed(token, address(feed), 1 days);
    }

    function testReturnsPrimaryPrice() public view {
        (uint256 price,) = router.getPrice(token);
        assertEq(price, 2_000e8);
    }

    function testManualOverrideAndPause() public {
        router.setManualPrice(token, true, 1_800e8, block.timestamp);
        (uint256 manualPrice,) = router.getPrice(token);
        assertEq(manualPrice, 1_800e8);

        router.setTokenPaused(token, true);
        vm.expectRevert(Errors.InvalidState.selector);
        router.getPrice(token);
    }
}
