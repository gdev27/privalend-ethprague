// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {EngineRegistry} from "./EngineRegistry.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {Errors} from "./libraries/Errors.sol";

contract PrivaLendPool {
    enum LoanStatus {
        NONE,
        ACTIVE,
        REPAID
    }

    struct MatchedTick {
        address lender;
        bytes32 lendIntentId;
        uint256 amount;
        uint256 rate;
    }

    struct ProposalTerms {
        bytes32 proposalId;
        bytes32 borrowIntentId;
        address borrower;
        address token;
        uint256 principal;
        uint256 effectiveBorrowerRate;
        address collateralToken;
        uint256 collateralAmount;
    }

    struct Loan {
        uint256 id;
        bytes32 proposalIdHash;
        address borrower;
        address token;
        address collateralToken;
        uint256 principal;
        uint256 outstandingPrincipal;
        uint256 collateralAmount;
        uint256 effectiveBorrowerRate;
        LoanStatus status;
    }

    EngineRegistry public immutable engineRegistry;
    uint256 public nextLoanId = 1;

    mapping(bytes32 => bool) public consumedProposalHash;
    mapping(uint256 => Loan) private _loans;
    mapping(uint256 => address[]) private _loanLenders;
    mapping(uint256 => mapping(address => uint256)) public lenderPrincipalByLoan;
    mapping(uint256 => mapping(address => uint256)) public lenderClaimableByLoan;

    event LoanMatched(bytes32 indexed proposalId, address indexed borrower, uint256 principal);
    event LoanRepaid(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 outstandingPrincipal);
    event ClaimWithdrawn(uint256 indexed loanId, address indexed lender, uint256 amount);
    event CollateralReturned(uint256 indexed loanId, address indexed borrower, uint256 amount);

    error ProposalHashMismatch();
    error ProposalAlreadySettled();
    error InvalidSignature();

    constructor(address engineRegistry_) {
        if (engineRegistry_ == address(0)) revert Errors.InvalidAddress();
        engineRegistry = EngineRegistry(engineRegistry_);
    }

    function settleMatch(
        ProposalTerms calldata terms,
        MatchedTick[] calldata matchedTicks,
        bytes32 proposalHash,
        bytes calldata kmsSignature
    ) external {
        bytes32 computedHash = _validateSignedProposal(terms, matchedTicks, proposalHash, kmsSignature);
        consumedProposalHash[computedHash] = true;

        uint256 loanId = nextLoanId++;
        _pullLenderFunds(loanId, terms, matchedTicks);
        _safeTransferFrom(terms.collateralToken, terms.borrower, address(this), terms.collateralAmount);
        _storeLoan(loanId, terms);

        emit LoanMatched(terms.proposalId, terms.borrower, terms.principal);
    }

    function repay(uint256 loanId, uint256 amount) external {
        Loan storage loan = _loans[loanId];
        if (loan.status != LoanStatus.ACTIVE) revert Errors.InvalidState();
        if (msg.sender != loan.borrower) revert Errors.Unauthorized();
        if (amount == 0 || amount > loan.outstandingPrincipal) revert Errors.InvalidAmount();

        _safeTransferFrom(loan.token, msg.sender, address(this), amount);
        _distributeRepayment(loanId, amount);
        loan.outstandingPrincipal -= amount;

        if (loan.outstandingPrincipal == 0) {
            loan.status = LoanStatus.REPAID;
        }

        emit LoanRepaid(loanId, msg.sender, amount, loan.outstandingPrincipal);
    }

    function closePosition(uint256 loanId) external {
        Loan storage loan = _loans[loanId];
        if (msg.sender != loan.borrower) revert Errors.Unauthorized();
        if (loan.status != LoanStatus.REPAID) revert Errors.InvalidState();
        uint256 collateralAmount = loan.collateralAmount;
        if (collateralAmount == 0) revert Errors.InvalidAmount();

        loan.collateralAmount = 0;
        _safeTransfer(loan.collateralToken, loan.borrower, collateralAmount);
        emit CollateralReturned(loanId, loan.borrower, collateralAmount);
    }

    function withdrawClaim(uint256 loanId) external {
        uint256 claimable = lenderClaimableByLoan[loanId][msg.sender];
        if (claimable == 0) revert Errors.InvalidAmount();
        lenderClaimableByLoan[loanId][msg.sender] = 0;
        _safeTransfer(_loans[loanId].token, msg.sender, claimable);
        emit ClaimWithdrawn(loanId, msg.sender, claimable);
    }

    function computeProposalHash(ProposalTerms calldata terms, MatchedTick[] calldata matchedTicks)
        external
        pure
        returns (bytes32)
    {
        return _computeProposalHash(terms, matchedTicks);
    }

    function _computeProposalHash(ProposalTerms calldata terms, MatchedTick[] calldata matchedTicks)
        internal
        pure
        returns (bytes32)
    {
        bytes32 idsHash = keccak256(abi.encode(terms.proposalId, terms.borrowIntentId));
        bytes32 termsHash = keccak256(
            abi.encode(
                terms.borrower,
                terms.token,
                terms.principal,
                terms.effectiveBorrowerRate,
                terms.collateralToken,
                terms.collateralAmount
            )
        );
        return keccak256(abi.encode(idsHash, _hashMatchedTicks(matchedTicks), termsHash));
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return _loans[loanId];
    }

    function getLoanLenders(uint256 loanId) external view returns (address[] memory) {
        return _loanLenders[loanId];
    }

    function _hashMatchedTicks(MatchedTick[] calldata ticks) internal pure returns (bytes32) {
        bytes32[] memory tickHashes = new bytes32[](ticks.length);
        for (uint256 i = 0; i < ticks.length; i++) {
            MatchedTick calldata tick = ticks[i];
            tickHashes[i] = keccak256(abi.encode(tick.lender, tick.lendIntentId, tick.amount, tick.rate));
        }
        return keccak256(abi.encodePacked(tickHashes));
    }

    function _validateSignedProposal(
        ProposalTerms calldata terms,
        MatchedTick[] calldata matchedTicks,
        bytes32 proposalHash,
        bytes calldata kmsSignature
    ) internal view returns (bytes32 computedHash) {
        if (terms.borrower == address(0) || terms.token == address(0) || terms.collateralToken == address(0)) {
            revert Errors.InvalidAddress();
        }
        if (terms.principal == 0 || terms.collateralAmount == 0) revert Errors.InvalidAmount();
        if (matchedTicks.length == 0) revert Errors.InvalidArrayLength();

        computedHash = _computeProposalHash(terms, matchedTicks);
        if (computedHash != proposalHash) revert ProposalHashMismatch();
        if (consumedProposalHash[computedHash]) revert ProposalAlreadySettled();

        address recovered = _recoverSigner(_toEthSignedMessageHash(computedHash), kmsSignature);
        if (recovered != engineRegistry.kmsAddress()) revert InvalidSignature();
    }

    function _pullLenderFunds(uint256 loanId, ProposalTerms calldata terms, MatchedTick[] calldata matchedTicks) internal {
        uint256 summedPrincipal;
        for (uint256 i = 0; i < matchedTicks.length; i++) {
            MatchedTick calldata tick = matchedTicks[i];
            if (tick.lender == address(0) || tick.amount == 0) revert Errors.InvalidAmount();
            for (uint256 j = 0; j < i; j++) {
                if (matchedTicks[j].lender == tick.lender) revert Errors.AlreadyExists();
            }

            summedPrincipal += tick.amount;
            lenderPrincipalByLoan[loanId][tick.lender] = tick.amount;
            _loanLenders[loanId].push(tick.lender);
            _safeTransferFrom(terms.token, tick.lender, terms.borrower, tick.amount);
        }
        if (summedPrincipal != terms.principal) revert Errors.InvalidAmount();
    }

    function _storeLoan(uint256 loanId, ProposalTerms calldata terms) internal {
        _loans[loanId] = Loan({
            id: loanId,
            proposalIdHash: terms.proposalId,
            borrower: terms.borrower,
            token: terms.token,
            collateralToken: terms.collateralToken,
            principal: terms.principal,
            outstandingPrincipal: terms.principal,
            collateralAmount: terms.collateralAmount,
            effectiveBorrowerRate: terms.effectiveBorrowerRate,
            status: LoanStatus.ACTIVE
        });
    }

    function _distributeRepayment(uint256 loanId, uint256 amount) internal {
        address[] memory lenders = _loanLenders[loanId];
        if (lenders.length == 0) revert Errors.InvalidState();

        Loan storage loan = _loans[loanId];
        uint256 distributed;
        for (uint256 i = 0; i < lenders.length; i++) {
            address lender = lenders[i];
            uint256 share = (amount * lenderPrincipalByLoan[loanId][lender]) / loan.principal;
            lenderClaimableByLoan[loanId][lender] += share;
            distributed += share;
        }
        if (distributed < amount) {
            lenderClaimableByLoan[loanId][lenders[0]] += (amount - distributed);
        }
    }

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) {
            revert InvalidSignature();
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        bool ok = IERC20(token).transferFrom(from, to, amount);
        if (!ok) revert Errors.TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        bool ok = IERC20(token).transfer(to, amount);
        if (!ok) revert Errors.TransferFailed();
    }
}
