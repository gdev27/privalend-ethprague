// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "../access/OwnableLite.sol";
import {Errors} from "../libraries/Errors.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

contract OracleRouter is OwnableLite, IPriceOracle {
    struct ManualPrice {
        bool enabled;
        uint256 price;
        uint256 updatedAt;
    }

    IPriceOracle public primaryOracle;

    mapping(address => ManualPrice) public manualPriceByToken;
    mapping(address => bool) public pausedToken;

    event PrimaryOracleUpdated(address indexed previousOracle, address indexed newOracle);
    event ManualPriceUpdated(address indexed token, bool enabled, uint256 price, uint256 updatedAt);
    event TokenPaused(address indexed token, bool paused);

    constructor(address primaryOracle_) {
        if (primaryOracle_ == address(0)) revert Errors.InvalidAddress();
        primaryOracle = IPriceOracle(primaryOracle_);
    }

    function setPrimaryOracle(address primaryOracle_) external onlyOwner {
        if (primaryOracle_ == address(0)) revert Errors.InvalidAddress();
        address previous = address(primaryOracle);
        primaryOracle = IPriceOracle(primaryOracle_);
        emit PrimaryOracleUpdated(previous, primaryOracle_);
    }

    function setManualPrice(address token, bool enabled, uint256 price, uint256 updatedAt) external onlyOwner {
        if (token == address(0)) revert Errors.InvalidAddress();
        if (enabled && (price == 0 || updatedAt == 0)) revert Errors.InvalidAmount();
        manualPriceByToken[token] = ManualPrice({enabled: enabled, price: price, updatedAt: updatedAt});
        emit ManualPriceUpdated(token, enabled, price, updatedAt);
    }

    function setTokenPaused(address token, bool paused) external onlyOwner {
        if (token == address(0)) revert Errors.InvalidAddress();
        pausedToken[token] = paused;
        emit TokenPaused(token, paused);
    }

    function getPrice(address token) external view override returns (uint256 price, uint256 updatedAt) {
        if (pausedToken[token]) revert Errors.InvalidState();

        ManualPrice memory manualPrice = manualPriceByToken[token];
        if (manualPrice.enabled) {
            return (manualPrice.price, manualPrice.updatedAt);
        }

        return primaryOracle.getPrice(token);
    }
}
