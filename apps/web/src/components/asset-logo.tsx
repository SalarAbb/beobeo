"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Deterministic monogram background per symbol (chart palette hues, muted).
const MONOGRAM_BG = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
];

const hashSymbol = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/**
 * Company/coin logo from the Parqet asset CDN (keyless), falling back to a
 * colored monogram when no logo exists. Purely decorative — identity is
 * always carried by the adjacent symbol text.
 */
export function AssetLogo({
  symbol,
  assetClass,
  size = 24,
  className,
}: {
  symbol: string;
  assetClass: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const src =
    assetClass === "crypto"
      ? `https://assets.parqet.com/logos/crypto/${encodeURIComponent(symbol.toUpperCase())}?format=png&size=${size * 2}`
      : `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol.toUpperCase())}?format=png&size=${size * 2}`;

  if (failed) {
    const bg = MONOGRAM_BG[Math.abs(hashSymbol(symbol)) % MONOGRAM_BG.length];
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
          bg,
          className,
        )}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny external CDN icons; next/image gains nothing here
    <img
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-white object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
