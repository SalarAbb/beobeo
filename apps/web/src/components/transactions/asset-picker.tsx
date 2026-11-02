"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { searchPopular } from "@beobeo/market-data/popular";
import { AssetLogo } from "@/components/asset-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import { CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTRPC } from "@/lib/trpc";

export interface PickedAsset {
  id: string;
  symbol: string;
  name: string;
  class: string;
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const CLASS_LABEL: Record<string, string> = {
  stock: "Stock",
  etf: "ETF",
  fund: "Fund",
  crypto: "Crypto",
  cash: "Cash",
};

function AssetRow({
  symbol,
  name,
  assetClass,
  selected,
}: {
  symbol: string;
  name: string;
  assetClass: string;
  selected?: boolean;
}) {
  return (
    <>
      <AssetLogo symbol={symbol} assetClass={assetClass} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold">{symbol}</span>
          {selected && <Check className="size-3.5 text-muted-foreground" />}
        </span>
        <span className="truncate text-xs text-muted-foreground">{name}</span>
      </span>
      <Badge variant="outline" className="ml-2 shrink-0 text-[10px] uppercase">
        {CLASS_LABEL[assetClass] ?? assetClass}
      </Badge>
    </>
  );
}

export function AssetPicker({
  value,
  onChange,
  autoOpen = false,
}: {
  value: PickedAsset | null;
  onChange: (asset: PickedAsset) => void;
  /** Open the search, ready to type, once the form around it has opened
   *  (when nothing is picked yet). */
  autoOpen?: boolean;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // A blank setup form's first job is the ticker: luna typed NVDA straight
  // away and nothing took it, since the field was a button to click first
  // (missions 130, 131). Waits out the dialog's opening animation, so the
  // list lines up under the field instead of where the field was mid-zoom.
  const [startOpen] = useState(() => autoOpen && !value);
  useEffect(() => {
    if (!startOpen) return;
    const t = setTimeout(() => setOpen(true), 220);
    return () => clearTimeout(t);
  }, [startOpen]);
  const debouncedQuery = useDebounced(query.trim(), 200);

  // Famous tickers match synchronously on every keystroke — zero latency.
  // The server round-trip (user's own assets + provider search) fills in
  // behind them.
  // The user's own assets match synchronously too, from the first letter, and
  // come first: the server search waits for two letters, so olenna's "O"
  // listed Oracle and Microsoft and never her Realty Income (mission 113).
  // Loaded when the picker mounts, before anything is typed.
  const held = useQuery({
    ...trpc.transactions.assets.queryOptions({}),
    staleTime: 5 * 60_000,
  });
  const typedQuery = query.trim().toUpperCase();
  const heldRows = typedQuery
    ? (held.data ?? [])
        .filter(
          (a) =>
            a.symbol.toUpperCase().startsWith(typedQuery) ||
            (typedQuery.length >= 2 && a.name.toUpperCase().includes(typedQuery)),
        )
        .sort(
          (a, b) =>
            Number(b.symbol.toUpperCase() === typedQuery) -
              Number(a.symbol.toUpperCase() === typedQuery) ||
            a.symbol.localeCompare(b.symbol),
        )
        .slice(0, 6)
    : [];
  const heldSymbols = new Set(heldRows.map((a) => a.symbol));
  const popular = searchPopular(query.trim(), 6).filter((p) => !heldSymbols.has(p.symbol));

  const search = useQuery({
    ...trpc.assets.search.queryOptions({ query: debouncedQuery }),
    enabled: debouncedQuery.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const ensure = useMutation(trpc.assets.ensure.mutationOptions());
  // A popular/market pick needs a server round trip (find-or-create) before it
  // has an id. The list closes at once and the trigger shows the pick while it
  // lands: keeping the list open with every row disabled read as a broken
  // picker, and more clicks in it flipped the selection (hermione, mission 18).
  const [adding, setAdding] = useState<{ symbol: string; name: string; class: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);

  async function pickRemote(r: {
    symbol: string;
    name: string;
    class: "stock" | "etf" | "fund" | "crypto" | "cash";
    providerRef?: string;
  }) {
    if (adding) return;
    setOpen(false);
    setFailed(null);
    setAdding(r);
    try {
      const asset = await ensure.mutateAsync(r);
      onChange({ id: asset.id, symbol: asset.symbol, name: asset.name, class: asset.class });
    } catch {
      setFailed(r.symbol);
    } finally {
      setAdding(null);
    }
  }

  const shown = adding ?? value;

  const searching = search.isFetching || query.trim() !== debouncedQuery;

  // Rows never move once shown: the synchronous Popular rows stay on top and
  // later sections only add rows below them. When the user already has a
  // popular asset, its Popular row picks that asset instead of being swapped
  // for a "Your assets" row; the swap remounted the row under the cursor and
  // shifted the list 400px, so clicks missed (luna, hermione, barristan,
  // missions 27–29).
  const allLocal = search.data?.local ?? [];
  const localByKey = new Map(allLocal.map((a) => [`${a.symbol}:${a.class}`, a]));
  const popularRows = popular;
  const seen = new Set(
    [...heldRows, ...popularRows].map((p) => `${p.symbol}:${p.class}`),
  );
  // Only assets you've traded are "Your assets". Others come from the shared
  // table and list with the market results, minus a same-ticker twin of a
  // Popular or owned row (a brand-new user saw "VOO · Stock" under Your
  // assets next to the VOO ETF, missions 37 and 39; then crypto tokens
  // called VOO under Markets, mission 40).
  const local = allLocal.filter(
    (a) => a.mine && !heldSymbols.has(a.symbol) && !seen.has(`${a.symbol}:${a.class}`),
  );
  for (const a of local) seen.add(`${a.symbol}:${a.class}`);
  const taken = new Set([...heldRows, ...popularRows, ...local].map((a) => a.symbol));
  const known = allLocal.filter(
    (a) => !a.mine && !taken.has(a.symbol) && !seen.has(`${a.symbol}:${a.class}`),
  );
  for (const a of known) seen.add(`${a.symbol}:${a.class}`);
  const remoteRows = (search.data?.remote ?? []).filter(
    (r) => !taken.has(r.symbol) && !seen.has(`${r.symbol}:${r.class}`),
  );
  const hasResults =
    heldRows.length > 0 ||
    local.length > 0 ||
    popularRows.length > 0 ||
    known.length > 0 ||
    remoteRows.length > 0;
  // Once the typed ticker itself is listed, the wider search can only add
  // lesser matches below it, so it runs quietly: an "updating…" row under the
  // VOO someone was about to tap read as "not ready yet" (hermione, missions 55–57).
  const typed = query.trim().toUpperCase();
  const exactShown = [...heldRows, ...popularRows, ...local].some(
    (a) => a.symbol.toUpperCase() === typed,
  );

  function pickLocal(a: PickedAsset) {
    setFailed(null);
    onChange({ id: a.id, symbol: a.symbol, name: a.name, class: a.class });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between font-normal"
          // Typing on the closed field opens the search with that letter in it.
          onKeyDown={(e) => {
            if (e.key.length !== 1 || e.key === " " || e.metaKey || e.ctrlKey || e.altKey)
              return;
            e.preventDefault();
            setQuery(e.key);
            setOpen(true);
          }}
        >
          {failed && !adding ? (
            <span className="text-destructive">Couldn&apos;t add {failed}. Try again</span>
          ) : shown ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <AssetLogo symbol={shown.symbol} assetClass={shown.class} size={22} />
              <span className="font-semibold">{shown.symbol}</span>
              <span className="truncate text-muted-foreground">{shown.name}</span>
              {adding && (
                <Loader2
                  className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                  aria-label="Adding"
                />
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Search symbol or name…</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="AAPL, Meta, bitcoin…"
            value={query}
            onValueChange={setQuery}
          />
          {/* A fixed height while searching: near the bottom of the screen the list
              opens upward, so growing as results arrive pushed every row up. */}
          <CommandList className={query.trim() ? "h-[300px]" : undefined}>
            {query.trim().length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type a ticker or company name
              </p>
            ) : (
              <>
                {!hasResults && (
                  <CommandEmpty>
                    {searching ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-3.5 animate-spin" /> Searching…
                      </span>
                    ) : (
                      "No matches"
                    )}
                  </CommandEmpty>
                )}
                {heldRows.length > 0 && (
                  <CommandGroup heading="Your assets">
                    {heldRows.map((a) => (
                      <CommandItem
                        key={`held-${a.id}`}
                        value={`held-${a.id}`}
                        className="gap-2.5 py-2"
                        onSelect={() => pickLocal(a)}
                      >
                        <AssetRow
                          symbol={a.symbol}
                          name={a.name}
                          assetClass={a.class}
                          selected={value?.id === a.id}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {popularRows.length > 0 && (
                  <CommandGroup heading="Popular">
                    {popularRows.map((r) => {
                      const mine = localByKey.get(`${r.symbol}:${r.class}`);
                      return (
                        <CommandItem
                          key={`pop-${r.symbol}:${r.class}`}
                          value={`pop-${r.symbol}-${r.class}`}
                          className="gap-2.5 py-2"
                          onSelect={() => (mine ? pickLocal(mine) : void pickRemote(r))}
                        >
                          <AssetRow
                            symbol={r.symbol}
                            name={r.name}
                            assetClass={r.class}
                            selected={!!mine && value?.id === mine.id}
                          />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
                {local.length > 0 && (
                  <CommandGroup heading="Your assets">
                    {local.map((a) => (
                      <CommandItem
                        key={a.id}
                        value={`local-${a.id}`}
                        className="gap-2.5 py-2"
                        onSelect={() => pickLocal(a)}
                      >
                        <AssetRow
                          symbol={a.symbol}
                          name={a.name}
                          assetClass={a.class}
                          selected={value?.id === a.id}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {known.length + remoteRows.length > 0 && (
                  <CommandGroup heading="Markets">
                    {known.map((a) => (
                      <CommandItem
                        key={a.id}
                        value={`known-${a.id}`}
                        className="gap-2.5 py-2"
                        onSelect={() => pickLocal(a)}
                      >
                        <AssetRow
                          symbol={a.symbol}
                          name={a.name}
                          assetClass={a.class}
                          selected={value?.id === a.id}
                        />
                      </CommandItem>
                    ))}
                    {remoteRows.map((r, i) => (
                      <CommandItem
                        key={`${r.symbol}:${r.class}:${i}`}
                        value={`remote-${r.symbol}-${r.class}-${i}`}
                        className="gap-2.5 py-2"
                        onSelect={() => void pickRemote(r)}
                      >
                        <AssetRow symbol={r.symbol} name={r.name} assetClass={r.class} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {hasResults && searching && !exactShown && (
                  <p className="flex items-center justify-center gap-2 border-t py-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Looking for more matches…
                  </p>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
