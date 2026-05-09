// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "../access/OwnableLite.sol";
import {Errors} from "../libraries/Errors.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract ChainlinkOracle is OwnableLite, IPriceOracle {
    struct FeedConfig {
        address feed;
        uint32 maxStaleness;
    }

    mapping(address => FeedConfig) public feedByToken;

    event FeedUpdated(address indexed token, address indexed feed, uint32 maxStaleness);

    function setFeed(address token, address feed, uint32 maxStaleness) external onlyOwner {
        if (token == address(0) || feed == address(0)) revert Errors.InvalidAddress();
        if (maxStaleness == 0) revert Errors.InvalidAmount();
        feedByToken[token] = FeedConfig({feed: feed, maxStaleness: maxStaleness});
        emit FeedUpdated(token, feed, maxStaleness);
    }

    function getPrice(address token) external view override returns (uint256 price, uint256 updatedAt) {
        FeedConfig memory config = feedByToken[token];
        if (config.feed == address(0)) revert Errors.OracleNotConfigured();

        AggregatorV3Interface aggregator = AggregatorV3Interface(config.feed);
        (, int256 rawPrice,, uint256 rawUpdatedAt,) = aggregator.latestRoundData();
        if (rawPrice <= 0) revert Errors.OracleBadPrice();
        if (rawUpdatedAt == 0 || block.timestamp > rawUpdatedAt + config.maxStaleness) revert Errors.OracleStale();

        uint8 decimals = aggregator.decimals();
        uint256 normalized = uint256(rawPrice);
        if (decimals > 8) {
            normalized /= 10 ** (decimals - 8);
        } else if (decimals < 8) {
            normalized *= 10 ** (8 - decimals);
        }

        return (normalized, rawUpdatedAt);
    }
}
