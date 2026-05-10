import { formatUnits, parseUnits } from "viem";

export const FALLBACK_DEBT_DECIMALS = 6;
export const FALLBACK_COLLATERAL_DECIMALS = 18;

export function parseHumanAmount(value: string, decimals: number): bigint | null {
  const normalized = normalizeDecimalInput(value);
  if (!normalized || Number(normalized) <= 0) return null;

  try {
    return parseUnits(normalized, decimals);
  } catch {
    return null;
  }
}

export function formatBaseUnits(value: bigint, decimals: number, maxFractionDigits = 4) {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatTokenAmount(value: bigint, decimals: number, symbol: string, maxFractionDigits = 4) {
  return `${formatBaseUnits(value, decimals, maxFractionDigits)} ${symbol}`;
}

export function parseRatePercent(value: string): number | null {
  const normalized = normalizeDecimalInput(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) return null;
  return parsed / 100;
}

export function formatRateFraction(rate: number, fractionDigits = 2) {
  if (!Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(fractionDigits)}%`;
}

export function formatRateWad(rateWad: bigint, fractionDigits = 2) {
  return formatRateFraction(Number(formatUnits(rateWad, 18)), fractionDigits);
}

export function normalizeRateString(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
    throw new Error("Rate must be a decimal fraction between 0 and 1");
  }

  return rate.toLocaleString("en-US", {
    maximumFractionDigits: 18,
    minimumFractionDigits: 0,
    useGrouping: false,
  });
}

export function rateToWad(rate: number): bigint {
  return BigInt(Math.round(rate * 1e18));
}

function normalizeDecimalInput(value: string) {
  return value.replace(/,/g, "").trim();
}
