"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BenchAsset } from "@/lib/compare-selection";

const PresetsContext = createContext<BenchAsset[] | undefined>(undefined);

/** Compare's preset benchmarks as the server layout resolved them, so the
 *  page's comparison query can start without a presets round trip first. */
export function ComparePresetsProvider({ presets, children }: { presets?: BenchAsset[]; children: ReactNode }) {
  return <PresetsContext.Provider value={presets}>{children}</PresetsContext.Provider>;
}

export const useServerPresets = () => useContext(PresetsContext);
