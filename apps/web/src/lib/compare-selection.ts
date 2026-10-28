/**
 * Which benchmarks the Compare page shows, shared by the page and the nav's
 * hover prefetch so both ask `compare.dca` with the exact same input.
 */
export interface BenchAsset {
  id: string;
  symbol: string;
  name: string;
  class: string;
}

export const COMPARE_KEYS = {
  selected: "beobeo.compare.selected", // string[] | null, null → the first preset
  custom: "beobeo.compare.custom", // BenchAsset[]
  scope: (portfolioId: string | null) => `beobeo.compare.scope.${portfolioId ?? "all"}`, // asset ids, [] = whole portfolio
};

/** Presets first, then custom picks that aren't presets. */
export function benchmarkChips(presets: BenchAsset[], custom: BenchAsset[]): BenchAsset[] {
  const seen = new Set(presets.map((p) => p.id));
  return [...presets, ...custom.filter((c) => !seen.has(c.id))];
}

/**
 * The remembered picks that still have a chip, else the first preset. A
 * remembered pick of a since-removed preset (VOO, which just duplicated SPY)
 * must not linger in the chart with no way to turn it off.
 */
export function activeBenchmarkIds(
  presets: BenchAsset[],
  chips: BenchAsset[],
  selected: string[] | null,
): string[] {
  const remembered = (selected ?? []).filter((id) => chips.some((c) => c.id === id));
  if (remembered.length > 0) return remembered;
  return presets[0] ? [presets[0].id] : [];
}

export function dcaInput(benchmarkIds: string[], scopeIds: string[], portfolioId: string | null) {
  return {
    benchmarkIds,
    scopeAssetIds: scopeIds.length > 0 ? scopeIds : undefined,
    portfolioId: portfolioId ?? undefined,
  };
}
