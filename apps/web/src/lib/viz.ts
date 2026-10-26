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

// Neutrals (surface/text/grid) follow the app's cool identity tokens in
// globals.css; series and gain/loss hues are the validated palette — keep them.
export const VIZ: { light: VizTheme; dark: VizTheme } = {
  light: {
    surface: "#ffffff",
    textPrimary: "#15171c",
    textSecondary: "#4a4e59",
    muted: "#8a8f9c",
    grid: "#e3e5ea",
    baseline: "#c9ccd4",
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
    surface: "#161920",
    textPrimary: "#eceef3",
    textSecondary: "#b4b9c5",
    muted: "#7d8392",
    grid: "#262a33",
    baseline: "#3a3f4a",
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

/** The mono face for canvas charts (lightweight-charts can't resolve CSS variables). Client-only: call in effects. */
export const chartFont = () =>
  `${getComputedStyle(document.documentElement).getPropertyValue("--font-data").trim() || "ui-monospace"}, ui-monospace, monospace`;

export const fmtUsd = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: digits,
        minimumFractionDigits: digits > 2 ? 2 : digits,
        // A value that rounds to zero prints "$0.00", never "-$0.00" (read as a bug).
        signDisplay: "negative",
      });

export const fmtCompactUsd = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    // Compact from $1,000 so an axis never mixes "$8,000" with "$12K" (and mono labels stay narrow).
    notation: Math.abs(v) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 0,
  });

export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export const fmtQty = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 8 });

/** Zero (to the cent) is neutral: a green "$0.00" reads as good news that isn't there. */
export const gainClass = (v: number | null | undefined) =>
  v === null || v === undefined || Math.abs(v) < 0.005
    ? "text-muted-foreground"
    : v > 0
      ? "text-gain"
      : "text-loss";
