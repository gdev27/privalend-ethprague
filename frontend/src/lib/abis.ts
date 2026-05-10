export const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const intentRegistryAbi = [
  {
    type: "function",
    name: "postIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "side", type: "uint8" },
      { name: "token", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "maxAmount", type: "uint256" },
      { name: "rateBps", type: "uint256" },
      { name: "minCollateralRatioBps", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [{ name: "intentId", type: "bytes32" }],
  },
  {
    type: "event",
    name: "IntentPosted",
    inputs: [
      { indexed: true, name: "intentId", type: "bytes32" },
      { indexed: true, name: "maker", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
      { indexed: false, name: "token", type: "address" },
      { indexed: false, name: "collateralToken", type: "address" },
      { indexed: false, name: "maxAmount", type: "uint256" },
      { indexed: false, name: "rateBps", type: "uint256" },
      { indexed: false, name: "minCollateralRatioBps", type: "uint256" },
      { indexed: false, name: "expiry", type: "uint256" },
      { indexed: false, name: "nonce", type: "uint256" },
    ],
  },
] as const;

export const loanCoreAbi = [
  {
    type: "function",
    name: "nextLoanId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getLoan",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "borrower", type: "address" },
          { name: "token", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "outstandingPrincipal", type: "uint256" },
          { name: "collateralAmount", type: "uint256" },
          { name: "weightedRateBps", type: "uint256" },
          { name: "minCollateralRatioBps", type: "uint256" },
          { name: "startTimestamp", type: "uint256" },
          { name: "dueTimestamp", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getLoanLenders",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "lenderPrincipalByLoan",
    stateMutability: "view",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "lender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lenderClaimableByLoan",
    stateMutability: "view",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "lender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawClaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const positionManagerAbi = [
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closePosition",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const privaLendPoolAbi = [
  {
    type: "function",
    name: "engineRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "nextLoanId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "consumedProposalHash",
    stateMutability: "view",
    inputs: [{ name: "proposalHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "settleMatch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "terms",
        type: "tuple",
        components: [
          { name: "proposalId", type: "bytes32" },
          { name: "borrowIntentId", type: "bytes32" },
          { name: "borrower", type: "address" },
          { name: "token", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "effectiveBorrowerRate", type: "uint256" },
          { name: "collateralToken", type: "address" },
          { name: "collateralAmount", type: "uint256" },
        ],
      },
      {
        name: "matchedTicks",
        type: "tuple[]",
        components: [
          { name: "lender", type: "address" },
          { name: "lendIntentId", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "rate", type: "uint256" },
        ],
      },
      { name: "proposalHash", type: "bytes32" },
      { name: "kmsSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getLoan",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "proposalIdHash", type: "bytes32" },
          { name: "borrower", type: "address" },
          { name: "token", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "outstandingPrincipal", type: "uint256" },
          { name: "collateralAmount", type: "uint256" },
          { name: "effectiveBorrowerRate", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getLoanLenders",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "lenderPrincipalByLoan",
    stateMutability: "view",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "lender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lenderClaimableByLoan",
    stateMutability: "view",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "lender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closePosition",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawClaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "LoanMatched",
    inputs: [
      { indexed: true, name: "proposalId", type: "bytes32" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "principal", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "LoanRepaid",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "payer", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "outstandingPrincipal", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "ClaimWithdrawn",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "lender", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "CollateralReturned",
    inputs: [
      { indexed: true, name: "loanId", type: "uint256" },
      { indexed: true, name: "borrower", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;
