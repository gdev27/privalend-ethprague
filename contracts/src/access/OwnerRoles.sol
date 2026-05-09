// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Errors} from "../libraries/Errors.sol";

contract OwnerRoles {
    address public owner;
    mapping(address => bool) public isMatcher;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MatcherUpdated(address indexed matcher, bool allowed);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Errors.NotOwner();
        _;
    }

    modifier onlyMatcher() {
        if (!isMatcher[msg.sender]) revert Errors.Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert Errors.InvalidAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setMatcher(address matcher, bool allowed) external onlyOwner {
        if (matcher == address(0)) revert Errors.InvalidAddress();
        isMatcher[matcher] = allowed;
        emit MatcherUpdated(matcher, allowed);
    }
}
