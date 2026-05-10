"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type PageKey = "overview" | "lend" | "borrow" | "dashboard";

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
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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

  function connectWallet() {
    setConnected(true);
  }

  function refreshDashboard() {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    setRefreshing(true);
    refreshTimer.current = window.setTimeout(() => setRefreshing(false), 600);
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
            <button type="button" className="btn btn-primary btn-sm" id="connect-btn" onClick={connectWallet}>
              {connected ? "Connected" : "Connect wallet"}
            </button>
          </header>

          <OverviewPage active={activePage === "overview"} go={go} />
          <LendPage active={activePage === "lend"} />
          <BorrowPage active={activePage === "borrow"} />
          <DashboardPage active={activePage === "dashboard"} connected={connected} refreshing={refreshing} onRefresh={refreshDashboard} />
        </main>
      </div>
    </>
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

function LendPage({ active }: { active: boolean }) {
  return (
    <section className={`page${active ? " on" : ""}`} id="p-lend">
      <div className="ph">
        <div className="ph-k">Lend</div>
        <h1 className="ph-title">
          Offer <em>liquidity</em>
        </h1>
        <p className="ph-sub">Tell us what you’re willing to lend and the lowest rate you’d accept. We encrypt that rate before sending anything to the server.</p>
      </div>
      <div className="note">Your rate is encrypted in your browser. The matching service sees amounts and tokens, not your exact rate, until a secure match runs.</div>
      <div className="card">
        <div className="ch">Your offer</div>
        <div className="fg">
          <label htmlFor="lend-asset">Asset to lend</label>
          <select id="lend-asset" title="Asset to lend">
            <option>USDC</option>
            <option>DAI</option>
            <option>WETH</option>
          </select>
        </div>
        <div className="fg">
          <label htmlFor="lend-coll">Collateral you accept</label>
          <select id="lend-coll" title="Collateral you accept">
            <option>WETH</option>
            <option>WBTC</option>
            <option>USDC</option>
          </select>
        </div>
        <div className="frow">
          <div className="fg">
            <label htmlFor="lend-amt">
              Maximum amount <span className="inline-hint">(human amount)</span>
            </label>
            <input id="lend-amt" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" title="Maximum amount" />
          </div>
          <div className="fg">
            <label htmlFor="lend-rate">
              Lowest rate you’ll accept <span className="inline-hint">(basis points · 100 = 1%)</span>
            </label>
            <input id="lend-rate" type="number" min="1" placeholder="e.g. 500" title="Rate floor in basis points" />
          </div>
        </div>
        <div className="fg">
          <label htmlFor="lend-exp">Offer valid until</label>
          <input id="lend-exp" type="datetime-local" title="Expiry" />
          <p className="hint">After this time, your offer won’t be matched unless you post a new one.</p>
        </div>
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: "8px" }}>
          Encrypt and submit offer
        </button>
      </div>
      <p className="help">
        After a loan is matched, you’ll receive repayments proportionally. Withdraw what’s available anytime from <strong style={{ color: "var(--text)" }}>Dashboard</strong>.
      </p>
    </section>
  );
}

function BorrowPage({ active }: { active: boolean }) {
  return (
    <section className={`page${active ? " on" : ""}`} id="p-borrow">
      <div className="ph">
        <div className="ph-k">Borrow</div>
        <h1 className="ph-title">
          Request a <em>loan</em>
        </h1>
        <p className="ph-sub">
          Say how much you need, what you’ll post as collateral, and the highest interest you’re willing to pay. That maximum rate is encrypted like your other private fields.
        </p>
      </div>
      <div className="note note-w">The protocol won’t match you at a higher rate than your limit, or with weaker collateral safety than you require.</div>
      <div className="card">
        <div className="ch">Your request</div>
        <div className="fg">
          <label htmlFor="bor-asset">Asset to borrow</label>
          <select id="bor-asset" title="Asset to borrow">
            <option>USDC</option>
            <option>DAI</option>
            <option>WETH</option>
          </select>
        </div>
        <div className="fg">
          <label htmlFor="bor-coll-tok">Collateral asset</label>
          <select id="bor-coll-tok" title="Collateral asset">
            <option>WETH</option>
            <option>WBTC</option>
          </select>
        </div>
        <div className="frow">
          <div className="fg">
            <label htmlFor="bor-amt">
              Amount to borrow <span className="inline-hint">(human amount)</span>
            </label>
            <input id="bor-amt" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" />
          </div>
          <div className="fg">
            <label htmlFor="bor-ceiling">
              Highest rate you’ll pay <span className="inline-hint">(basis points · 100 = 1%)</span>
            </label>
            <input id="bor-ceiling" type="number" min="1" placeholder="e.g. 800" />
          </div>
        </div>
        <div className="frow">
          <div className="fg">
            <label htmlFor="bor-coll-amt">
              Collateral amount <span className="inline-hint">(for matching)</span>
            </label>
            <input id="bor-coll-amt" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" />
          </div>
          <div className="fg">
            <label htmlFor="bor-ratio">
              Minimum collateral safety <span className="inline-hint">(basis points)</span>
            </label>
            <input id="bor-ratio" type="number" min="10000" placeholder="15000" title="Minimum collateral ratio in basis points" />
            <p className="hint">10000 = at least as much collateral value as debt; 15000 ≈ 150%.</p>
          </div>
        </div>
        <div className="fg">
          <label htmlFor="bor-exp">Request valid until</label>
          <input id="bor-exp" type="datetime-local" />
          <p className="hint">After this time, post a new request if you still want to borrow.</p>
        </div>
        <button type="button" className="btn btn-warn" style={{ width: "100%", marginTop: "8px" }}>
          Encrypt and submit request
        </button>
      </div>
      <div className="card" style={{ marginTop: "20px" }}>
        <div className="ch">While the loan is open</div>
        <p className="help" style={{ margin: 0 }}>
          <strong style={{ color: "var(--text)" }}>Health</strong> compares your collateral value to what you owe. Keep it above your minimum to avoid liquidation. You can repay early,
          add collateral, or withdraw spare collateral when you’re safely above that line. Anyone may liquidate an unhealthy position — that’s how lenders stay protected.
        </p>
      </div>
    </section>
  );
}

function DashboardPage({
  active,
  connected,
  refreshing,
  onRefresh,
}: {
  active: boolean;
  connected: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className={`page${active ? " on" : ""}`} id="p-dashboard">
      <div className="ph">
        <div className="ph-k">Dashboard</div>
        <h1 className="ph-title">
          Your <em>positions</em>
        </h1>
        <p className="ph-sub">Connect your wallet to see live loans. Below is an example of what you’ll see.</p>
      </div>
      <div className="ebar">
        <div className="ec">
          <div className="ek">Connection</div>
          <div className="ev" id="dash-conn">
            {connected ? "Wallet connected (demo)" : "Not connected"}
          </div>
        </div>
        <div className="ec">
          <div className="ek">Matching</div>
          <div className="ev match-pulse">Live</div>
        </div>
        <div className="ec" style={{ display: "flex", alignItems: "center" }}>
          <button type="button" className="btn btn-ghost btn-sm" id="dash-refresh" onClick={onRefresh}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="tshell">
        <div className="th">
          <span>Your loans</span>
          <span style={{ fontSize: "12px", color: "var(--dim)" }}>Sample data</span>
        </div>
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
                <th>Due</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mn">#12</td>
                <td>
                  <span className="badge b-b">Borrower</span>
                </td>
                <td className="mn">5,000 USDC</td>
                <td className="mn">3.2 WETH</td>
                <td className="mn">6.4%</td>
                <td>
                  <div className="hbar">
                    <div className="htrack">
                      <div className="hfill" style={{ width: "72%" }} />
                    </div>
                    <span className="hval" style={{ color: "var(--ok)" }}>
                      1.7×
                    </span>
                  </div>
                </td>
                <td>
                  <span className="badge b-a">Active</span>
                </td>
                <td className="mn" style={{ fontSize: "13px" }}>
                  Jun 9
                </td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm">
                    Repay
                  </button>
                </td>
              </tr>
              <tr>
                <td className="mn">#7</td>
                <td>
                  <span className="badge b-l">Lender</span>
                </td>
                <td className="mn">2,500 USDC</td>
                <td className="mn">—</td>
                <td className="mn">5.8%</td>
                <td>
                  <div className="hbar">
                    <div className="htrack">
                      <div className="hfill low" style={{ width: "35%" }} />
                    </div>
                    <span className="hval" style={{ color: "var(--bad)" }}>
                      Low
                    </span>
                  </div>
                </td>
                <td>
                  <span className="badge b-r">At risk</span>
                </td>
                <td className="mn" style={{ fontSize: "13px" }}>
                  Jun 12
                </td>
                <td>
                  <button type="button" className="btn btn-danger btn-sm">
                    Liquidate
                  </button>
                </td>
              </tr>
              <tr>
                <td className="mn">#3</td>
                <td>
                  <span className="badge b-l">Lender</span>
                </td>
                <td className="mn">10,000 USDC</td>
                <td className="mn">—</td>
                <td className="mn">7.1%</td>
                <td>
                  <div className="hbar">
                    <div className="htrack">
                      <div className="hfill" style={{ width: "85%" }} />
                    </div>
                    <span className="hval" style={{ color: "var(--ok)" }}>
                      2.2×
                    </span>
                  </div>
                </td>
                <td>
                  <span className="badge b-a">Active</span>
                </td>
                <td className="mn" style={{ fontSize: "13px" }}>
                  Jul 1
                </td>
                <td>
                  <button type="button" className="btn btn-primary btn-sm">
                    Claim
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="help">
        <strong style={{ color: "var(--text)" }}>Repay</strong> pays down your debt. <strong style={{ color: "var(--text)" }}>Claim</strong> pulls your share of repayments as a lender.{" "}
        <strong style={{ color: "var(--text)" }}>Liquidate</strong> is available to others if a loan is below its required safety — it repays part of the debt and takes collateral with a
        small incentive.
      </p>
    </section>
  );
}

function PrivaLendLogo() {
  return (
    <svg width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0%" stopColor="#6d28d9" />
          <stop offset="100%" stopColor="#1e3a5f" />
        </linearGradient>
      </defs>
      <polygon points="20,2 35,11 35,29 20,38 5,29 5,11" fill="url(#lg)" stroke="rgba(167,139,250,.5)" strokeWidth="1" />
      <rect x="11.5" y="13" width="3.5" height="14" rx="1" fill="rgba(255,255,255,.92)" />
      <path d="M15 13 Q22.5 13 22.5 17.5 Q22.5 22 15 22" stroke="rgba(255,255,255,.92)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="24" y="15" width="3" height="11" rx="1" fill="#34d399" />
      <rect x="24" y="23" width="6.5" height="3" rx="1" fill="#34d399" />
    </svg>
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
