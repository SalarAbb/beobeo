"use client";

import { useSyncExternalStore } from "react";

/**
 * Validated dataviz palette (see dataviz skill reference instance).
 * Light: worst adjacent CVD ΔE 24.2 (pass). Dark: 10.3 (floor band) —
 * charts using >3 series must direct-label or gap marks, which ours do.
 */
export interface VizTheme {
  surface: string;
  textPrimary: string;
  textSecondary: string;
  muted: string;
  grid: string;
  baseline: string;
  series: readonly string[];
  gain: string;
  loss: string;
  areaTop: string;
  areaBottom: string;
}

export const VIZ: { light: VizTheme; dark: VizTheme } = {
  light: {
    surface: "#fcfcfb",
    textPrimary: "#0b0b0b",
    textSecondary: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    baseline: "#c3c2b7",
    series: [
      "#2a78d6", // blue
      "#1baf7a", // aqua
      "#eda100", // yellow
      "#008300", // green
      "#4a3aa7", // violet
      "#e34948", // red
      "#e87ba4", // magenta
      "#eb6834", // orange
    ],
    gain: "#0ca30c",
    loss: "#d03b3b",
    areaTop: "rgba(42, 120, 214, 0.18)",
    areaBottom: "rgba(42, 120, 214, 0.02)",
  },
  dark: {
    surface: "#1a1a19",
    textPrimary: "#ffffff",
    textSecondary: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    baseline: "#383835",
    series: [
      "#3987e5",
      "#199e70",
      "#c98500",
      "#008300",
      "#9085e9",
      "#e66767",
      "#d55181",
      "#d95926",
    ],
    gain: "#0ca30c",
    loss: "#e66767",
    areaTop: "rgba(57, 135, 229, 0.22)",
    areaBottom: "rgba(57, 135, 229, 0.03)",
  },
};

function subscribeToScheme(callback: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeToScheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false, // SSR default: light
  );
}

export function useVizTheme(): VizTheme {
  return usePrefersDark() ? VIZ.dark : VIZ.light;
}

export const fmtUsd = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: digits,
        minimumFractionDigits: digits > 2 ? 2 : digits,
      });

export const fmtCompactUsd = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(v) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(v) >= 10000 ? 1 : 0,
  });

export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export const fmtQty = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 8 });

export const gainClass = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "text-muted-foreground"
    : v >= 0
      ? "text-gain"
      : "text-loss";
