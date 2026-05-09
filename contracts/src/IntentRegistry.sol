// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnerRoles} from "./access/OwnerRoles.sol";
import {Errors} from "./libraries/Errors.sol";
import {Types} from "./libraries/Types.sol";

contract IntentRegistry is OwnerRoles {
    mapping(address => uint256) public nonces;
    mapping(bytes32 => Types.Intent) private _intents;

    address public matchingCoordinator;

    event MatchingCoordinatorUpdated(address indexed previousCoordinator, address indexed newCoordinator);
    event IntentPosted(
        bytes32 indexed intentId,
        address indexed maker,
        Types.IntentSide side,
        address token,
        address collateralToken,
        uint256 maxAmount,
        uint256 rateBps,
        uint256 minCollateralRatioBps,
        uint256 expiry,
        uint256 nonce
    );
    event IntentCancelled(bytes32 indexed intentId, address indexed maker);
    event IntentConsumed(bytes32 indexed intentId, uint256 amount, uint256 remainingAmount);

    modifier onlyMatchingCoordinator() {
        if (msg.sender != matchingCoordinator) revert Errors.Unauthorized();
        _;
    }

    function setMatchingCoordinator(address coordinator) external onlyOwner {
        if (coordinator == address(0)) revert Errors.InvalidAddress();
        address previous = matchingCoordinator;
        matchingCoordinator = coordinator;
        emit MatchingCoordinatorUpdated(previous, coordinator);
    }

    function postIntent(
        Types.IntentSide side,
        address token,
        address collateralToken,
        uint256 maxAmount,
        uint256 rateBps,
        uint256 minCollateralRatioBps,
        uint256 expiry
    ) external returns (bytes32 intentId) {
        if (token == address(0) || collateralToken == address(0)) revert Errors.InvalidAddress();
        if (maxAmount == 0 || expiry <= block.timestamp) revert Errors.InvalidAmount();
        if (side == Types.IntentSide.BORROW && minCollateralRatioBps < 10_000) revert Errors.InvalidAmount();

        uint256 nonce = nonces[msg.sender]++;
        intentId = keccak256(
            abi.encode(
                msg.sender,
                side,
                token,
                collateralToken,
                maxAmount,
                rateBps,
                minCollateralRatioBps,
                expiry,
                nonce,
                block.chainid,
                address(this)
            )
        );
        if (_intents[intentId].maker != address(0)) revert Errors.AlreadyExists();

        _intents[intentId] = Types.Intent({
            maker: msg.sender,
            side: side,
            token: token,
            collateralToken: collateralToken,
            maxAmount: maxAmount,
            remainingAmount: maxAmount,
            rateBps: rateBps,
            minCollateralRatioBps: minCollateralRatioBps,
            expiry: expiry,
            nonce: nonce,
            active: true
        });

        emit IntentPosted(
            intentId,
            msg.sender,
            side,
            token,
            collateralToken,
            maxAmount,
            rateBps,
            minCollateralRatioBps,
            expiry,
            nonce
        );
    }

    function cancelIntent(bytes32 intentId) external {
        Types.Intent storage intent = _intents[intentId];
        if (intent.maker == address(0)) revert Errors.NotFound();
        if (intent.maker != msg.sender) revert Errors.Unauthorized();
        if (!intent.active) revert Errors.NotActive();
        intent.active = false;
        emit IntentCancelled(intentId, msg.sender);
    }

    function consumeIntent(bytes32 intentId, uint256 amount) external onlyMatchingCoordinator returns (Types.Intent memory intent) {
        if (amount == 0) revert Errors.InvalidAmount();
        intent = _intents[intentId];
        if (intent.maker == address(0)) revert Errors.NotFound();
        if (!intent.active) revert Errors.NotActive();
        if (block.timestamp > intent.expiry) revert Errors.Expired();
        if (intent.remainingAmount < amount) revert Errors.InvalidAmount();

        Types.Intent storage storedIntent = _intents[intentId];
        storedIntent.remainingAmount -= amount;
        if (storedIntent.remainingAmount == 0) {
            storedIntent.active = false;
        }
        emit IntentConsumed(intentId, amount, storedIntent.remainingAmount);
        return storedIntent;
    }

    function intentOf(bytes32 intentId) external view returns (Types.Intent memory) {
        return _intents[intentId];
    }
}
