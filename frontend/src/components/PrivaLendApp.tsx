"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { formatBaseUnits, formatRateFraction, formatRateWad, formatTokenAmount, parseRatePercent } from "@/lib/amounts";
import type { PoolLoan, ProtocolState } from "@/lib/contracts";
import { usePrivaLendProtocol } from "@/lib/contracts";
import { publicEnv } from "@/lib/env";

type PageKey = "overview" | "lend" | "borrow" | "dashboard";
type TokenSymbol = "USDC" | "WETH";

const TOKEN_META: Record<TokenSymbol, { icon: string; alt: string }> = {
  USDC: { icon: "/tokens/usdc.png", alt: "USDC logo" },
  WETH: { icon: "/tokens/weth.png", alt: "WETH logo" },
};

const WETH_REFERENCE_PRICE_USD = publicEnv.wethReferencePriceUsd;
const CENTRALIZED_LIQUIDATION_LTV = publicEnv.liquidationLtvPercent;

const PAGES: Record<PageKey, { label: string }> = {
  overview: { label: "Overview" },
  lend: { label: "Lend" },
  borrow: { label: "Borrow" },
  dashboard: { label: "Dashboard" },
};

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: ReactNode }> = [
  { key: "overview", label: "Overview", icon: <OverviewIcon /> },
  { key: "lend", label: "Lend", icon: <LendIcon /> },
  { key: "borrow", label: "Borrow", icon: <BorrowIcon /> },
  { key: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
];

export function PrivaLendApp() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [routeShift, setRouteShift] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const protocol = usePrivaLendProtocol();
  const routeTimer = useRef<number | null>(null);
  const routeFrame = useRef<number | null>(null);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (routeTimer.current !== null) window.clearTimeout(routeTimer.current);
      if (routeFrame.current !== null) window.cancelAnimationFrame(routeFrame.current);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  function go(key: PageKey) {
    if (routeTimer.current !== null) window.clearTimeout(routeTimer.current);
    if (routeFrame.current !== null) window.cancelAnimationFrame(routeFrame.current);

    setRouteShift(false);
    routeFrame.current = window.requestAnimationFrame(() => {
      setRouteShift(true);
      routeTimer.current = window.setTimeout(() => setRouteShift(false), 520);
    });

    setActivePage(key);
    window.scrollTo(0, 0);
  }

  function refreshDashboard() {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    setRefreshing(true);
    void protocol.refreshAll().finally(() => {
      refreshTimer.current = window.setTimeout(() => setRefreshing(false), 300);
    });
  }

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="blob blob-a" />
        <div className="blob blob-b" />
        <div className="blob blob-c" />
      </div>
      <div className="grain" aria-hidden="true" />

      <div className={`shell${routeShift ? " route-shift" : ""}`}>
        <aside aria-label="Main navigation">
          <div className="logo-wrap">
            <span className="logo-mark">
              <PrivaLendLogo />
            </span>
            <div className="logo-text">
              <div className="logo-name">
                Priva<em>Lend</em>
              </div>
              <div className="logo-tag">Private lending</div>
            </div>
          </div>
          <nav>
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                className={`nb${activePage === item.key ? " on" : ""}`}
                onClick={() => go(item.key)}
                key={item.key}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main>
          <header className="topbar">
            <div className="crumb">
              <strong>PrivaLend</strong> · <span id="tbar">{PAGES[activePage].label}</span>
            </div>
            <WalletConnectButton />
          </header>

          <OverviewPage active={activePage === "overview"} go={go} />
          <LendPage active={activePage === "lend"} go={go} protocol={protocol} />
          <BorrowPage active={activePage === "borrow"} go={go} protocol={protocol} />
          <DashboardPage active={activePage === "dashboard"} go={go} protocol={protocol} refreshing={refreshing} onRefresh={refreshDashboard} />
        </main>
      </div>
    </>
  );
}

function WalletConnectButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain && (!authenticationStatus || authenticationStatus === "authenticated");

        return (
          <div
            className="wallet-connect"
            {...(!ready && {
              "aria-hidden": true,
              style: {
                opacity: 0,
                pointerEvents: "none" as const,
                userSelect: "none" as const,
              },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <button type="button" className="btn btn-primary btn-sm" id="connect-btn" onClick={openConnectModal}>
                    Connect wallet
                  </button>
                );
              }

              if (chain.unsupported || chain.id !== publicEnv.chainId) {
                return (
                  <button type="button" className="btn btn-warn btn-sm" id="connect-btn" onClick={openChainModal}>
                    Switch to {publicEnv.networkName}
                  </button>
                );
              }

              return (
                <div className="wallet-actions">
                  <button type="button" className="btn btn-ghost btn-sm wallet-chain" onClick={openChainModal}>
                    {chain.hasIcon && (
                      <span className="wallet-chain-icon" style={{ background: chain.iconBackground }}>
                        {chain.iconUrl && <img alt={chain.name ?? "Chain icon"} src={chain.iconUrl} />}
                      </span>
                    )}
                    <span>{chain.name}</span>
                  </button>
                  <button type="button" className="btn btn-primary btn-sm wallet-account" id="connect-btn" onClick={openAccountModal}>
                    <span>{account.displayName}</span>
                  </button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

function OverviewPage({ active, go }: { active: boolean; go: (key: PageKey) => void }) {
  return (
    <section className={`page${active ? " on" : ""}`} id="p-overview">
      <div className="ph">
        <div className="ph-k">Welcome</div>
        <h1 className="ph-title">
          Lend and borrow
          <br />
          <em>without publishing your rate</em>
        </h1>
        <p className="ph-sub">Your preferred rate stays encrypted until matching. Loan terms are settled on-chain so everyone can verify the outcome.</p>
      </div>
      <div className="steps">
        <div className="step">
          <div className="step-n">1</div>
          <p>
            <strong style={{ color: "var(--text)" }}>Choose your side</strong> — Offer to lend or request to borrow, with amounts and tokens you’re comfortable with.
          </p>
        </div>
        <div className="step">
          <div className="step-n">2</div>
          <p>
            <strong style={{ color: "var(--text)" }}>Seal your rate</strong> — Your minimum lending yield or maximum borrowing cost is encrypted before it leaves your device.
          </p>
        </div>
        <div className="step">
          <div className="step-n">3</div>
          <p>
            <strong style={{ color: "var(--text)" }}>Manage the loan</strong> — Track positions, repay, top up collateral, or claim your share from the dashboard.
          </p>
        </div>
      </div>
      <div className="hero-actions">
        <button type="button" className="btn btn-primary" onClick={() => go("lend")}>
          I want to lend
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => go("borrow")}>
          I want to borrow
        </button>
      </div>
    </section>
  );
}

function ModeTabs({ active, go }: { active: PageKey; go: (key: PageKey) => void }) {
  const tabs: Array<{ key: PageKey; label: string }> = [
    { key: "borrow", label: "Borrow" },
    { key: "lend", label: "Lend" },
    { key: "dashboard", label: "Status" },
  ];

  return (
    <div className="mode-tabs" role="tablist" aria-label="PrivaLend actions">
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`mode-tab${active === tab.key ? " on" : ""}`}
          onClick={() => go(tab.key)}
          key={tab.key}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function AssetAmountField({
  balance,
  id,
  label,
  maxDisabled,
  onQuickAmount,
  token,
  value,
  onChange,
  placeholder = "0",
}: {
  balance?: string;
  id: string;
  label: string;
  maxDisabled?: boolean;
  onQuickAmount?: (percent: 25 | 50 | 75 | 100) => void;
  token: TokenSymbol;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="asset-field">
      <div className="asset-field-head">
        <label htmlFor={id}>{label}</label>
        {balance && <span className="asset-balance">Balance {balance}</span>}
      </div>
      <div className="asset-control">
        <input id={id} type="text" inputMode="decimal" placeholder={placeholder} autoComplete="off" value={value} onChange={(event) => onChange?.(event.target.value)} />
        <TokenPill token={token} />
      </div>
      {onQuickAmount && (
        <div className="quick-amount-grid" aria-label={`${token} quick amount`}>
          {([
            { label: "25%", value: 25 },
            { label: "50%", value: 50 },
            { label: "75%", value: 75 },
            { label: "MAX", value: 100 },
          ] as const).map((item) => (
            <button
              type="button"
              className="quick-amount-btn"
              onClick={() => onQuickAmount(item.value)}
              disabled={maxDisabled}
              key={item.value}
              aria-label={`Use ${item.label} of ${token} balance`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LockedAssetField({ label, token }: { label: string; token: TokenSymbol }) {
  return (
    <div className="asset-field asset-field-locked">
      <span className="asset-label">{label}</span>
      <div className="asset-control">
        <span className="locked-asset-copy">Only {token}</span>
        <TokenPill token={token} />
      </div>
    </div>
  );
}

function TokenPill({ token }: { token: TokenSymbol }) {
  return (
    <span className="token-pill" aria-label={`${token} fixed asset`}>
      <span className="token-icon">
        <img src={TOKEN_META[token].icon} alt={TOKEN_META[token].alt} width="24" height="24" />
      </span>
      <span>{token}</span>
    </span>
  );
}

function MetricInput({
  id,
  label,
  suffix,
  type = "number",
  min,
  step,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  suffix?: string;
  type?: "number";
  min?: string;
  step?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="metric-field">
      <label htmlFor={id}>{label}</label>
      <div className="metric-control">
        <input id={id} type={type} min={min} step={step} placeholder={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)} />
        {suffix && <span>{suffix}</span>}
      </div>
    </div>
  );
}

function LendPage({ active, go, protocol }: { active: boolean; go: (key: PageKey) => void; protocol: ProtocolState }) {
  const [lendAmount, setLendAmount] = useState("");
  const [minimumRate, setMinimumRate] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const lendAmountBaseUnits = protocol.parseDebtAmount(lendAmount);
  const minimumRateFraction = parseRatePercent(minimumRate);
  const durationDaysValue = parseDurationDays(durationDays);
  const hasEnoughBalance = lendAmountBaseUnits !== null && protocol.debtToken.balance >= lendAmountBaseUnits;
  const hasEnoughAllowance = lendAmountBaseUnits !== null && protocol.debtToken.allowance >= lendAmountBaseUnits;
  const formReady = lendAmountBaseUnits !== null && minimumRateFraction !== null && durationDaysValue !== null && hasEnoughBalance;

  return (
    <section className={`page intent-page${active ? " on" : ""}`} id="p-lend">
      <ModeTabs active="lend" go={go} />
      <div className="intent-layout">
        <div className="card intent-panel">
          <div className="intent-panel-head">
            <div>
              <div className="ch">Your offer</div>
              <h2>Private lend offer</h2>
            </div>
            <span className="pair-badge">USDC / WETH</span>
          </div>
          <div className="asset-stack">
            <AssetAmountField
              id="lend-amt"
              label="You're lending"
              token="USDC"
              value={lendAmount}
              onChange={setLendAmount}
              balance={formatTokenAmount(protocol.debtToken.balance, protocol.debtToken.decimals, protocol.debtToken.symbol)}
              onQuickAmount={(percent) => setLendAmount(formatBalancePortion(protocol.debtToken, percent))}
              maxDisabled={protocol.debtToken.balance === 0n}
            />
            <LockedAssetField label="Collateral accepted" token="WETH" />
          </div>
          <div className="metric-grid">
            <MetricInput id="lend-rate" label="Minimum rate" suffix="%" min="0" step="0.01" placeholder="5.00" value={minimumRate} onChange={setMinimumRate} />
            <MetricInput id="lend-duration" label="Offer duration" suffix="days" min="1" step="1" placeholder="30" value={durationDays} onChange={setDurationDays} />
          </div>
          <EncryptionNotice mode={protocol.encryptionMode} />
          <IntentActionButton
            className="btn-primary"
            formReady={formReady}
            invalidLabel={lendAmountBaseUnits === null || minimumRateFraction === null || durationDaysValue === null ? "Enter amount, rate, and duration" : "Insufficient USDC"}
            needsApproval={formReady && !hasEnoughAllowance}
            approvalLabel="Approve USDC"
            readyLabel="Encrypt and submit offer"
            protocol={protocol}
            onApprove={() => lendAmountBaseUnits && void protocol.approveDebt(lendAmountBaseUnits)}
            onSubmit={() =>
              lendAmountBaseUnits &&
              minimumRateFraction &&
              durationDaysValue &&
              void protocol.submitLend({ amount: lendAmountBaseUnits, durationDays: durationDaysValue, minimumRate: minimumRateFraction })
            }
          />
        </div>
      </div>
    </section>
  );
}

function BorrowPage({ active, go, protocol }: { active: boolean; go: (key: PageKey) => void; protocol: ProtocolState }) {
  const [borrowAmount, setBorrowAmount] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const borrowAmountBaseUnits = protocol.parseDebtAmount(borrowAmount);
  const collateralAmountBaseUnits = protocol.parseCollateralAmount(collateralAmount);
  const maxRateFraction = parseRatePercent(maxRate);
  const durationDaysValue = parseDurationDays(durationDays);
  const hasEnoughCollateral = collateralAmountBaseUnits !== null && protocol.collateralToken.balance >= collateralAmountBaseUnits;
  const hasEnoughAllowance = collateralAmountBaseUnits !== null && protocol.collateralToken.allowance >= collateralAmountBaseUnits;
  const formReady = borrowAmountBaseUnits !== null && collateralAmountBaseUnits !== null && maxRateFraction !== null && durationDaysValue !== null && hasEnoughCollateral;
  const risk = calculateBorrowRisk({
    borrowAmount,
    collateralAmount,
  });

  return (
    <section className={`page intent-page${active ? " on" : ""}`} id="p-borrow">
      <ModeTabs active="borrow" go={go} />
      <div className="intent-layout">
        <div className="card intent-panel">
          <div className="intent-panel-head">
            <div>
              <div className="ch">Your request</div>
              <h2>Borrow with privacy</h2>
            </div>
            <span className="pair-badge">USDC / WETH</span>
          </div>
          <div className="asset-stack">
            <AssetAmountField id="bor-amt" label="You're borrowing" token="USDC" value={borrowAmount} onChange={setBorrowAmount} />
            <AssetAmountField
              id="bor-coll-amt"
              label="Collateral"
              token="WETH"
              value={collateralAmount}
              onChange={setCollateralAmount}
              balance={formatTokenAmount(protocol.collateralToken.balance, protocol.collateralToken.decimals, protocol.collateralToken.symbol)}
              onQuickAmount={(percent) => setCollateralAmount(formatBalancePortion(protocol.collateralToken, percent))}
              maxDisabled={protocol.collateralToken.balance === 0n}
            />
          </div>
          <div className="metric-grid">
            <MetricInput id="bor-ceiling" label="Max rate" suffix="%" min="0" step="0.01" placeholder="9.50" value={maxRate} onChange={setMaxRate} />
            <MetricInput id="bor-duration" label="Offer duration" suffix="days" min="1" step="1" placeholder="30" value={durationDays} onChange={setDurationDays} />
          </div>
          <BorrowRiskPanel risk={risk} />
          <EncryptionNotice mode={protocol.encryptionMode} />
          <IntentActionButton
            className="btn-warn"
            formReady={formReady}
            invalidLabel={borrowAmountBaseUnits === null || collateralAmountBaseUnits === null || maxRateFraction === null || durationDaysValue === null ? "Enter amount, collateral, rate, and duration" : "Insufficient WETH"}
            needsApproval={formReady && !hasEnoughAllowance}
            approvalLabel="Approve WETH"
            readyLabel="Encrypt and submit request"
            protocol={protocol}
            onApprove={() => collateralAmountBaseUnits && void protocol.approveCollateral(collateralAmountBaseUnits)}
            onSubmit={() =>
              borrowAmountBaseUnits &&
              collateralAmountBaseUnits &&
              maxRateFraction &&
              durationDaysValue &&
              void protocol.submitBorrow({
                amount: borrowAmountBaseUnits,
                collateralAmount: collateralAmountBaseUnits,
                durationDays: durationDaysValue,
                maxRate: maxRateFraction,
              })
            }
          />
        </div>
      </div>
    </section>
  );
}

function EncryptionNotice({ mode }: { mode: ProtocolState["encryptionMode"] }) {
  if (mode === "ecies") {
    return null;
  }

  return <div className="mini-alert mini-alert-warn">Plaintext local fallback is active because NEXT_PUBLIC_CRE_PUBKEY is not set.</div>;
}

function IntentActionButton({
  approvalLabel,
  className,
  formReady,
  invalidLabel,
  needsApproval,
  onApprove,
  onSubmit,
  protocol,
  readyLabel,
}: {
  approvalLabel: string;
  className: "btn-primary" | "btn-warn";
  formReady: boolean;
  invalidLabel: string;
  needsApproval: boolean;
  onApprove: () => void;
  onSubmit: () => void;
  protocol: ProtocolState;
  readyLabel: string;
}) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openChainModal, openConnectModal, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain && (!authenticationStatus || authenticationStatus === "authenticated");
        const wrongChain = connected && (chain.unsupported || chain.id !== publicEnv.chainId);

        if (!connected) {
          return (
            <button type="button" className={`btn ${className} intent-submit`} onClick={openConnectModal}>
              Connect wallet
            </button>
          );
        }

        if (wrongChain) {
          return (
            <button type="button" className="btn btn-warn intent-submit" onClick={openChainModal}>
              Switch to {publicEnv.networkName}
            </button>
          );
        }

        if (!formReady) {
          return (
            <button type="button" className={`btn ${className} intent-submit`} disabled>
              {invalidLabel}
            </button>
          );
        }

        return (
          <button type="button" className={`btn ${needsApproval ? "btn-ghost" : className} intent-submit`} onClick={needsApproval ? onApprove : onSubmit} disabled={protocol.actionPending}>
            {protocol.actionPending ? protocol.actionLabel : needsApproval ? approvalLabel : readyLabel}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function BorrowRiskPanel({ risk }: { risk: BorrowRisk }) {
  const displayLtv = Number.isFinite(risk.ltv) ? `${risk.ltv.toFixed(1)}%` : "Enter amounts";
  const displayHealth = Number.isFinite(risk.healthRatio) ? risk.healthRatio.toFixed(2) : "—";
  const displayLiquidation = `${CENTRALIZED_LIQUIDATION_LTV}% LTV`;

  return (
    <div className={`risk-panel risk-${risk.tone}`}>
      <div className="risk-head">
        <div>
          <span className="risk-k">Health ratio</span>
          <strong>{displayHealth}</strong>
        </div>
        <span className="risk-badge">{risk.label}</span>
      </div>
      <div className="risk-track" aria-label="Borrow health indicator">
        <div className="risk-fill" style={{ width: `${risk.fill}%` }} />
      </div>
      <div className="risk-stats">
        <div>
          <span>Current LTV</span>
          <strong>{displayLtv}</strong>
        </div>
        <div>
          <span>Liquidation</span>
          <strong>{displayLiquidation}</strong>
        </div>
        <div>
          <span>WETH price</span>
          <strong>${WETH_REFERENCE_PRICE_USD.toLocaleString()}</strong>
        </div>
      </div>
    </div>
  );
}

type BorrowRisk = {
  fill: number;
  healthRatio: number;
  label: string;
  ltv: number;
  tone: "empty" | "safe" | "watch" | "danger";
};

function calculateBorrowRisk({
  borrowAmount,
  collateralAmount,
}: {
  borrowAmount: string;
  collateralAmount: string;
}): BorrowRisk {
  const debt = parseFiniteNumber(borrowAmount);
  const collateral = parseFiniteNumber(collateralAmount);
  const threshold = CENTRALIZED_LIQUIDATION_LTV;

  if (!debt || !collateral || !threshold) {
    return { fill: 0, healthRatio: Number.NaN, label: "Awaiting input", ltv: Number.NaN, tone: "empty" };
  }

  const collateralValue = collateral * WETH_REFERENCE_PRICE_USD;
  const ltv = (debt / collateralValue) * 100;
  const healthRatio = threshold / ltv;
  const fill = clamp((healthRatio / 2) * 100, 8, 100);

  if (healthRatio <= 1) {
    return { fill, healthRatio, label: "Liquidation risk", ltv, tone: "danger" };
  }

  if (healthRatio <= 1.25) {
    return { fill, healthRatio, label: "Watch closely", ltv, tone: "watch" };
  }

  return { fill, healthRatio, label: "Healthy", ltv, tone: "safe" };
}

function parseFiniteNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function parseDurationDays(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 30;
  const parsed = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.ceil(parsed);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function DashboardPage({
  active,
  go,
  protocol,
  refreshing,
  onRefresh,
}: {
  active: boolean;
  go: (key: PageKey) => void;
  protocol: ProtocolState;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const connectionLabel = protocol.isConnected ? formatAddress(protocol.address) : "Not connected";

  return (
    <section className={`page${active ? " on" : ""}`} id="p-dashboard">
      <ModeTabs active="dashboard" go={go} />
      <div className="ph">
        <div className="ph-k">Dashboard</div>
        <h1 className="ph-title">
          Your <em>positions</em>
        </h1>
        <p className="ph-sub">Live on-chain PrivaLendPool loans for the connected Sepolia wallet.</p>
      </div>
      <div className="ebar">
        <div className="ec">
          <div className="ek">Wallet</div>
          <div className="ev" id="dash-conn">
            {connectionLabel}
          </div>
        </div>
        <div className="ec">
          <div className="ek">Last poll</div>
          <div className="ev">{protocol.lastPollAt ? new Date(protocol.lastPollAt).toLocaleTimeString() : "-"}</div>
        </div>
        <div className="ec action-cell">
          <button type="button" className="btn btn-ghost btn-sm" id="dash-refresh" onClick={onRefresh} disabled={refreshing || protocol.actionPending}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          {publicEnv.demoTickEnabled && (
            <button type="button" className="btn btn-warn btn-sm" onClick={() => void protocol.runDemoTick()} disabled={protocol.actionPending}>
              Demo tick
            </button>
          )}
        </div>
      </div>
      {protocol.lastError && (
        <div className="mini-alert mini-alert-warn error-row">
          <span>{protocol.lastError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={protocol.clearError}>
            Dismiss
          </button>
        </div>
      )}
      <LoanTable loans={protocol.loans} protocol={protocol} />
      <p className="help">
        <strong style={{ color: "var(--text)" }}>Repay</strong> returns principal to the pool for lender claims. <strong style={{ color: "var(--text)" }}>Withdraw</strong> pulls a lender’s
        claimable repayment. <strong style={{ color: "var(--text)" }}>Close</strong> returns collateral after full repayment.
      </p>
    </section>
  );
}

function LoanTable({ loans, protocol }: { loans: PoolLoan[]; protocol: ProtocolState }) {
  return (
    <div className="tshell">
      <div className="th">
        <span>On-chain loans</span>
        <span style={{ fontSize: "12px", color: "var(--dim)" }}>PrivaLendPool reads</span>
      </div>
      {loans.length === 0 ? (
        <EmptyState label="Settled loans for this wallet will replace the old sample rows here." />
      ) : (
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Loan</th>
                <th>You are</th>
                <th>Outstanding</th>
                <th>Collateral</th>
                <th>Rate</th>
                <th>Health</th>
                <th>Status</th>
                <th>Claimable</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.loanId.toString()}>
                  <td className="mn">#{loan.loanId.toString()}</td>
                  <td>
                    <RoleBadge role={loan.role} />
                  </td>
                  <td className="mn">{formatTokenAmount(loan.outstandingPrincipal, protocol.debtToken.decimals, protocol.debtToken.symbol)}</td>
                  <td className="mn">{formatTokenAmount(loan.collateralAmount, protocol.collateralToken.decimals, protocol.collateralToken.symbol)}</td>
                  <td className="mn">{formatRateWad(loan.effectiveBorrowerRate)}</td>
                  <td>
                    <LoanHealth loan={loan} debtDecimals={protocol.debtToken.decimals} collateralDecimals={protocol.collateralToken.decimals} />
                  </td>
                  <td>
                    <StatusBadge label={loanStatusLabel(loan.status)} status={loan.status === 1 ? "active" : "settled"} />
                  </td>
                  <td className="mn">{formatTokenAmount(loan.lenderClaimable, protocol.debtToken.decimals, protocol.debtToken.symbol)}</td>
                  <td>
                    <LoanActions loan={loan} protocol={protocol} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LoanActions({ loan, protocol }: { loan: PoolLoan; protocol: ProtocolState }) {
  const actions: ReactNode[] = [];

  if ((loan.role === "borrower" || loan.role === "both") && loan.status === 1) {
    const needsRepayApproval = protocol.debtToken.allowance < loan.outstandingPrincipal;
    actions.push(
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => void (needsRepayApproval ? protocol.approveDebt(loan.outstandingPrincipal) : protocol.repay(loan))}
        disabled={protocol.actionPending}
        key="repay"
      >
        {needsRepayApproval ? "Approve repay" : "Repay"}
      </button>,
    );
  }

  if ((loan.role === "borrower" || loan.role === "both") && loan.status === 2 && loan.collateralAmount > 0n) {
    actions.push(
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void protocol.closePosition(loan)} disabled={protocol.actionPending} key="close">
        Close
      </button>,
    );
  }

  if ((loan.role === "lender" || loan.role === "both") && loan.lenderClaimable > 0n) {
    actions.push(
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void protocol.withdrawClaim(loan)} disabled={protocol.actionPending} key="claim">
        Withdraw
      </button>,
    );
  }

  if (actions.length === 0) return <span className="muted-action">Awaiting repayment</span>;
  return <div className="action-stack">{actions}</div>;
}

function LoanHealth({ loan, debtDecimals, collateralDecimals }: { loan: PoolLoan; debtDecimals: number; collateralDecimals: number }) {
  if (loan.collateralAmount === 0n || loan.outstandingPrincipal === 0n) {
    return <span className="hval">-</span>;
  }

  const debt = Number(formatBaseUnits(loan.outstandingPrincipal, debtDecimals, 8));
  const collateral = Number(formatBaseUnits(loan.collateralAmount, collateralDecimals, 8));
  const collateralValue = collateral * WETH_REFERENCE_PRICE_USD;
  const ltv = collateralValue > 0 ? (debt / collateralValue) * 100 : Number.NaN;
  const health = Number.isFinite(ltv) && ltv > 0 ? CENTRALIZED_LIQUIDATION_LTV / ltv : Number.NaN;
  const fill = Number.isFinite(health) ? clamp((health / 2) * 100, 8, 100) : 0;

  return (
    <div className="hbar">
      <div className="htrack">
        <div className={`hfill${health <= 1.25 ? " low" : ""}`} style={{ width: `${fill}%` }} />
      </div>
      <span className="hval" style={{ color: health <= 1.25 ? "var(--bad)" : "var(--ok)" }}>
        {Number.isFinite(health) ? `${health.toFixed(2)}x` : "-"}
      </span>
    </div>
  );
}

function RoleBadge({ role }: { role: "borrower" | "lender" | "both" }) {
  if (role === "both") return <span className="badge b-a">Both</span>;
  return <span className={`badge ${role === "borrower" ? "b-b" : "b-l"}`}>{role === "borrower" ? "Borrower" : "Lender"}</span>;
}

function StatusBadge({ label, status }: { label: string; status: "active" | "pending" | "settled" }) {
  return <span className={`badge ${status === "active" ? "b-a" : status === "pending" ? "b-b" : "b-l"}`}>{label}</span>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>;
}

function loanStatusLabel(status: PoolLoan["status"]) {
  if (status === 1) return "Active";
  if (status === 2) return "Repaid";
  if (status === 3) return "Liquidated";
  if (status === 4) return "Defaulted";
  return "None";
}

function formatAddress(address?: Address) {
  if (!address) return "Wallet connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalancePortion(token: ProtocolState["debtToken"], percent: 25 | 50 | 75 | 100) {
  return formatBaseUnits((token.balance * BigInt(percent)) / 100n, token.decimals, token.decimals);
}

function PrivaLendLogo() {
  return (
    <img className="logo-image" src="/brand/privalend-mark.png" width="34" height="34" alt="" aria-hidden="true" />
  );
}

function OverviewIcon() {
  return (
    <svg className="ni" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="1" width="5" height="5" rx="1" />
      <rect x="8" y="1" width="5" height="5" rx="1" />
      <rect x="1" y="8" width="5" height="5" rx="1" />
      <rect x="8" y="8" width="5" height="5" rx="1" />
    </svg>
  );
}

function LendIcon() {
  return (
    <svg className="ni" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 11V3M3 7l4-4 4 4" />
    </svg>
  );
}

function BorrowIcon() {
  return (
    <svg className="ni" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 3v8M11 7l-4 4-4-4" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg className="ni" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M1 8l3-4 3 3 3-5 3 3" />
      <path d="M1 13h12" />
    </svg>
  );
}
