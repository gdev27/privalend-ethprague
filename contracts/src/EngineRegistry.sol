// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./access/OwnableLite.sol";
import {Errors} from "./libraries/Errors.sol";

contract EngineRegistry is OwnableLite {
    address public kmsAddress;

    event KmsAddressUpdated(address indexed previousKmsAddress, address indexed newKmsAddress);

    constructor(address kmsAddress_) {
        if (kmsAddress_ == address(0)) revert Errors.InvalidAddress();
        kmsAddress = kmsAddress_;
        emit KmsAddressUpdated(address(0), kmsAddress_);
    }

    function setKmsAddress(address kmsAddress_) external onlyOwner {
        if (kmsAddress_ == address(0)) revert Errors.InvalidAddress();
        address previous = kmsAddress;
        kmsAddress = kmsAddress_;
        emit KmsAddressUpdated(previous, kmsAddress_);
    }
}
