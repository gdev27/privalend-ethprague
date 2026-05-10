# PrivaLend Frontend

Next.js frontend version of the original `privalend-v5.html` single page.

## Commands

```bash
npm install
npm run dev
npm run build
```

The app uses the Next.js App Router under `src/app` and keeps the page styling in `src/app/globals.css`.

## Wallet Connection

RainbowKit is wired through `src/app/providers.tsx` and `src/lib/wagmi.ts`.

For the full wallet list and WalletConnect QR/mobile flows, copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=4c8732f195345771b68e014eae9df31c
```

The same project id is also used as the built-in default in `src/lib/wagmi.ts`.

## Live Sepolia Demo Runbook

Copy `.env.example` to `.env.local` and keep only public values under `NEXT_PUBLIC_*`. If the stage needs the manual matching button, set `NEXT_PUBLIC_DEMO_TICK_ENABLED=true` and set `PRIVALEND_BACKEND_ADMIN_KEY` server-side only.

Start the services:

```bash
cd engine && bun run local-workflow
cd server && bun run dev
cd server && bun run executor
cd frontend && npm run dev
```

The frontend requires Sepolia (`11155111`) and uses the signed-pool addresses from env. Use two browser profiles:

1. Lender wallet: connect on Sepolia, enter a USDC lend amount and minimum percent rate, approve USDC to the pool, then submit the encrypted lend intent.
2. Borrower wallet: connect on Sepolia, enter a USDC borrow amount, WETH collateral, and maximum percent rate, approve WETH to the pool, then submit the encrypted borrow intent.
3. Wait for the backend cron, or use the demo tick button if enabled. Both dashboards should show a signed proposal pending settlement.
4. Let `server/src/executor.ts` settle the proposal, or use the visible `Settle fallback` action. The on-chain loan then appears in both dashboards.
5. Borrower approves USDC for the outstanding amount and repays. Lender withdraws the claim. Borrower closes the repaid position to receive collateral back.

Before the public run, confirm both wallets have Sepolia ETH, the lender has the debt token, the borrower has collateral, and the borrower has debt token for the repayment step.
