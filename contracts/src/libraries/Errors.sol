// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library Errors {
    error NotOwner();
    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidArrayLength();
    error InvalidState();
    error AlreadyExists();
    error NotFound();
    error NotActive();
    error Expired();
    error Replay();
    error TransferFailed();
    error HealthFactorOk();
    error OracleNotConfigured();
    error OracleStale();
    error OracleBadPrice();
}
