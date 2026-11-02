"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DatePicker, localIsoDate } from "@/components/date-picker";
import { usePortfolio } from "@/components/portfolio-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";
import { AssetPicker, type PickedAsset } from "./asset-picker";

const TYPES = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
  { value: "split", label: "Split" },
  { value: "transfer_in", label: "Transfer in" },
  { value: "transfer_out", label: "Transfer out" },
] as const;

type TxnType = (typeof TYPES)[number]["value"];

const needsPrice = (t: TxnType) => t === "buy" || t === "sell";

const TOTAL_LABEL: Partial<Record<TxnType, string>> = {
  buy: "Total cost",
  sell: "Net proceeds",
  dividend: "Amount received",
  transfer_in: "Value",
  transfer_out: "Value",
};

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** How a sale of a holding bought on `date` would be taxed: at the lower
 *  (long-term) rate from the day after its anniversary, like the Tax Center's
 *  lots. Plain words, no "long-term": luna found it nerdy (missions 125, 129). */
function heldNote(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "Roughly is fine (10/1/2024, or just Oct 2024). Things you've owned over a year are taxed less when you sell.";
  if (date >= today) return "Bought earlier? Type or pick roughly when. Things you've owned over a year are taxed less when you sell.";
  const ltOn = new Date(Date.UTC(y + 1, m - 1, d + 1));
  return ltOn.toISOString().slice(0, 10) <= today
    ? "Owned over a year, so a sale gets the lower tax rate."
    : `Owned under a year. From ${dayFmt.format(ltOn)}, a sale gets the lower tax rate.`;
}

/** The saved holding in one line, for setup's confirmation: "50 VOO, $25,000.00
 *  in all, bought Oct 1, 2024, in IBKR. Owned over a year, so a sale gets the
 *  lower tax rate." A bare "recorded" left hermione unable to check the units, cost
 *  and holding period before the dashboard opened (mission 115). */
function savedSummary(
  qty: string,
  symbol: string,
  total: number | null,
  date: string,
  today: string,
  account: string | undefined,
): string {
  const [y, m, d] = date.split("-").map(Number);
  const ltOn = new Date(Date.UTC(y! + 1, m! - 1, d! + 1));
  const term =
    ltOn.toISOString().slice(0, 10) <= today
      ? "Owned over a year, so a sale gets the lower tax rate."
      : `From ${dayFmt.format(ltOn)}, a sale gets the lower tax rate.`;
  return `${qty} ${symbol}${total !== null ? `, ${fmtUsd(total)} in all` : ""}, bought ${dayFmt.format(
    new Date(`${date}T12:00:00Z`),
  )}${account ? `, in ${account}` : ""}. ${term}`;
}

export function AddTransactionDialog({
  onCreated,
  onSaving,
  onSaved,
  accountsPending,
  defaultOpen = false,
  defaultType = "buy",
  defaultEntry = "price",
  owned = false,
  trigger,
}: {
  /** Gets the saved row, so a list can point at it. */
  onCreated?: (txn: { id: string; assetId: string; accountId: string }) => void;
  /** Accounts still being created (welcome step 2): the form opens at once,
   *  and a Save that beats them waits for them instead of making "Default". */
  accountsPending?: Promise<unknown> | null;
  /** Called with what's being saved ("VOO buy") when Save is pressed, and
   *  with null if the save fails (the welcome step says so on the page). */
  onSaving?: (what: string | null) => void;
  /** With `owned`, called once the holding is in with what was saved in
   *  words (units, cost, date, account, holding period) and what it was
   *  ("VOO buy"). */
  onSaved?: (summary: string, what: string) => void;
  /** What opens the dialog (default: the "Add transaction" button). */
  trigger?: React.ReactNode;
  /** Open on mount (the welcome flow links to /transactions?add=1). */
  defaultOpen?: boolean;
  /** Preselected type (the dashboard's Dividends tile links to ?add=dividend). */
  defaultType?: TxnType;
  /** "total" opens buys/sells on the total field: setup's holding is something
   *  already owned, whose statement shows what was paid in all, and a
   *  prefilled market price had to be switched away from (mission 42). */
  defaultEntry?: "price" | "total";
  /** Setup's holding is already owned: the date is asked as "When you bought
   *  it" and says how a sale would be taxed. Left on today, hermione's
   *  long-held VOO read as a short-term gain taxed at 32% (mission 87). */
  owned?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);

  const { portfolioId } = usePortfolio();
  const accounts = useQuery(
    trpc.accounts.list.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );
  const createAccount = useMutation(trpc.accounts.create.mutationOptions());
  const createTxn = useMutation(trpc.transactions.create.mutationOptions());

  const [accountId, setAccountId] = useState<string>("");
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [type, setType] = useState<TxnType>(defaultType);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [entry, setEntry] = useState<"price" | "total">(defaultEntry);
  const [totalInput, setTotalInput] = useState("");
  const [fees, setFees] = useState("");
  // Something already owned starts with no date: today was wrong for nearly
  // every setup holding and still had to be changed (mission 92).
  const [date, setDate] = useState(() => (owned ? "" : localIsoDate()));
  const [today] = useState(() => localIsoDate());
  const [note, setNote] = useState("");

  // Account is optional: preselect the first account; if the user has none,
  // one named "Default" is created silently on save.
  const effectiveAccountId = accountId || accounts.data?.[0]?.id || "";

  // Suggested price for asset + date: live quote when today, else that day's
  // close. Derived at render — fills the field until the user types their own.
  const suggestPrice = needsPrice(type);
  const priceSuggestion = useQuery({
    ...trpc.assets.priceOn.queryOptions({ assetId: asset?.id ?? "", date }),
    enabled: suggestPrice && !!asset && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 60_000,
  });
  // At most 2 decimals; sub-$1 assets (small crypto) keep enough significant
  // digits that the suggestion isn't rounded to $0.00.
  const suggestedPrice = priceSuggestion.data
    ? Number(priceSuggestion.data.price) >= 1
      ? Number(priceSuggestion.data.price).toFixed(2)
      : String(Number(Number(priceSuggestion.data.price).toPrecision(4)))
    : null;
  // A payout is one total, as the statement shows it: saved as 1 × the
  // amount received. Asking for shares × a per-share figure made olenna
  // work out 31 ÷ 103.5468 and still miss her $31.00 (mission 112).
  const isDividend = type === "dividend";
  const effectiveQuantity = isDividend ? "1" : quantity;
  const qtyNum = Number(effectiveQuantity);
  const feesNum = isDividend ? 0 : Number(fees) || 0;
  const outflow = type === "sell" || type === "transfer_out";

  // Buys and sells can be entered by what the broker statement shows in all
  // (fees included) instead of a per-unit price; the price is derived from it
  // to 10 decimals (the column's scale), so the cost basis lands on the cent.
  const byTotal = entry === "total" && needsPrice(type);
  const totalNum = Number(totalInput);
  const derivedPriceNum =
    byTotal && totalInput !== "" && Number.isFinite(totalNum) && qtyNum > 0
      ? (outflow ? totalNum + feesNum : totalNum - feesNum) / qtyNum
      : null;
  const derivedPrice =
    derivedPriceNum !== null && Number.isFinite(derivedPriceNum) && derivedPriceNum > 0
      ? String(Number(derivedPriceNum.toFixed(10)))
      : "";

  const effectivePrice = byTotal
    ? derivedPrice
    : !priceTouched && suggestPrice && suggestedPrice !== null
      ? suggestedPrice
      : price;

  // Live total (display-only float math).
  const priceNum = Number(effectivePrice);
  const totalLabel = TOTAL_LABEL[type];
  const hasTotal =
    totalLabel !== undefined &&
    effectiveQuantity !== "" &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    effectivePrice !== "" &&
    Number.isFinite(priceNum) &&
    priceNum > 0;
  const total = hasTotal
    ? byTotal
      ? totalNum
      : outflow
        ? qtyNum * priceNum - feesNum
        : qtyNum * priceNum + feesNum
    : null;

  function resetForm() {
    setQuantity("");
    setPrice("");
    setPriceTouched(false);
    setTotalInput("");
    setFees("");
    setNote("");
  }

  // The form closes the moment Save is pressed and a toast carries the save:
  // a button sitting on "Saving…" through a slow round trip read as a hang
  // (hermione, barristan). The values stay in state until the save lands, so
  // a failure reopens the form exactly as it was.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!asset) {
      toast.error("Pick an asset");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error(owned ? "Add roughly when you bought it" : "Pick a date");
      return;
    }
    const what = `${asset.symbol} ${type.replace("_", " ")}`;
    setSaving(true);
    setOpen(false);
    const toastId = toast.loading(`Saving ${what}…`);
    onSaving?.(what);
    try {
      let acctId = effectiveAccountId;
      let acctName = accounts.data?.find((a) => a.id === acctId)?.name;
      if (!acctId && accountsPending) {
        await accountsPending.catch(() => {});
        const list = await queryClient.fetchQuery(
          trpc.accounts.list.queryOptions({ portfolioId: portfolioId ?? undefined }),
        );
        acctId = list[0]?.id ?? "";
        acctName = list[0]?.name;
      }
      if (!acctId) {
        const acct = await createAccount.mutateAsync({
          name: "Default",
          currency: "USD",
          portfolioId: portfolioId ?? undefined,
        });
        acctId = acct.id;
        acctName = acct.name;
        void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
      }
      const created = await createTxn.mutateAsync({
        accountId: acctId,
        assetId: asset.id,
        type,
        quantity: effectiveQuantity,
        pricePerUnit:
          needsPrice(type) || type === "dividend" || type.startsWith("transfer")
            ? effectivePrice || null
            : null,
        fees: isDividend ? "0" : fees || "0",
        tradedAt: new Date(`${date}T12:00:00Z`),
        note: note || undefined,
        source: "manual",
      });
      // Names the account: a setup user wanted to see VOO landed in IBKR, not
      // just that something saved (hermione, mission 46).
      // The amount and date too: a backdated payout lands below newer rows, and
      // olenna couldn't tell hers had gone in (missions 112, 113).
      // Setup's holding says everything that was saved, here and on the
      // dashboard the toast follows the user to.
      const summary = owned
        ? savedSummary(effectiveQuantity, asset.symbol, total, date, today, undefined)
        : null;
      toast.success(`${what} recorded${acctName ? ` in ${acctName}` : ""}`, {
        id: toastId,
        description:
          summary ??
          `${total !== null ? `${fmtUsd(total)} on ` : ""}${dayFmt.format(new Date(`${date}T12:00:00Z`))}`,
        ...(summary && { duration: 10_000 }),
      });
      // The toast's title already names the account; the page line doesn't.
      if (summary)
        onSaved?.(savedSummary(effectiveQuantity, asset.symbol, total, date, today, acctName), what);
      resetForm();
      // Setup can add another holding: it starts blank, not on the last one's
      // ticker and date.
      if (owned) {
        setAsset(null);
        setDate("");
      }
      onCreated?.(created);
    } catch (err) {
      onSaving?.(null);
      toast.error(`Couldn't save the ${what}: ${(err as Error).message}`, {
        id: toastId,
        duration: 10_000,
        action: { label: "Open it again", onClick: () => setOpen(true) },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-1 size-4" /> Add transaction
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        // Guard against losing a half-filled form: outside clicks don't close.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-5">
          <div className="grid gap-1.5">
            <Label>Asset</Label>
            <AssetPicker
              value={asset}
              autoOpen={owned}
              onChange={(a) => {
                setAsset(a);
                setPriceTouched(false); // fresh asset → fresh suggestion
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid content-start gap-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TxnType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid content-start gap-1.5">
              <Label>{owned && type === "buy" ? "When you bought it" : "Date"}</Label>
              <DatePicker
                value={date}
                onChange={setDate}
                label={owned && type === "buy" ? "When you bought it" : "Date"}
              />
              {owned && type === "buy" && (
                <p className="text-xs text-muted-foreground">{heldNote(date, today)}</p>
              )}
            </div>
          </div>

          {isDividend ? (
            <div className="grid content-start gap-1.5 sm:max-w-[66%]">
              <Label htmlFor="dividend-amount">Amount received</Label>
              <Input
                id="dividend-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                The whole payout in dollars, as on your statement. No share count needed.
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="grid content-start gap-1.5">
              <Label>{type === "split" ? "Ratio" : "Quantity"}</Label>
              <Input
                inputMode="decimal"
                placeholder={type === "split" ? "4 = 4-for-1" : "0"}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div className="grid content-start gap-1.5">
              {/* The label says which mode is on and the link under the field
                  offers the other: a bare "Enter price" while in total mode
                  read as the current state (hermione, mission 40). Beside
                  the label, the link wrapped it on a phone and dropped this
                  field below its neighbours. */}
              <Label className="whitespace-nowrap">{byTotal ? totalLabel : "Price"}</Label>
              {byTotal ? (
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={totalLabel}
                  value={totalInput}
                  onChange={(e) => setTotalInput(e.target.value)}
                  required
                />
              ) : (
                <Input
                  inputMode="decimal"
                  placeholder={priceSuggestion.isFetching ? "…" : "0.00"}
                  value={effectivePrice}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceTouched(true);
                  }}
                  disabled={type === "split"}
                  required={needsPrice(type)}
                />
              )}
              {needsPrice(type) && (
                <button
                  type="button"
                  className="justify-self-start text-xs text-primary hover:underline"
                  onClick={() => setEntry(byTotal ? "price" : "total")}
                >
                  {byTotal ? "Enter the price each instead" : "Enter total"}
                </button>
              )}
            </div>
            <div className="grid content-start gap-1.5">
              <Label>Fees</Label>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                disabled={type === "split"}
              />
            </div>
          </div>
          )}

          {/* Summary strip: price provenance + live total, fixed height so the
              grid above never shifts. */}
          <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3.5 py-2.5">
            <span className="text-xs text-muted-foreground">
              {byTotal
                ? derivedPrice
                  ? // Cents, like any price (the stored price keeps 10 decimals, so
                    // the cost still lands on the typed total); "per unit" read as
                    // nerdy to luna (missions 125, 129).
                    `That's $${Number(derivedPrice).toLocaleString(
                      "en-US",
                      Number(derivedPrice) >= 1
                        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                        : { maximumFractionDigits: 8 },
                    )} each${feesNum ? ", with fees in the total" : ""}`
                  : "Enter quantity and what it came to in all"
                : suggestPrice && priceSuggestion.data && !priceTouched
                ? priceSuggestion.data.source === "quote"
                  ? "Using live market price — edit if your fill differed"
                  : `Using close from ${priceSuggestion.data.asOf}`
                : type === "split"
                  ? "Splits carry no cash amount"
                  : " "}
            </span>
            {totalLabel && (
              <span className="shrink-0 text-right whitespace-nowrap">
                <span className="mr-2 text-xs text-muted-foreground">{totalLabel}</span>
                <span className="text-base font-semibold data">
                  {total !== null ? fmtUsd(total) : "—"}
                </span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid content-start gap-1.5">
              <Label className="text-muted-foreground">
                Account <span className="font-normal">(optional)</span>
              </Label>
              {(accounts.data?.length ?? 0) > 0 ? (
                <Select value={effectiveAccountId} onValueChange={setAccountId}>
                  <SelectTrigger className="w-full min-w-0 overflow-hidden">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.data!.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.institution ? ` · ${a.institution}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={accountsPending ? "Adding your accounts…" : "Default"} disabled />
              )}
            </div>
            <div className="grid content-start gap-1.5">
              <Label className="text-muted-foreground">
                Note <span className="font-normal">(optional)</span>
              </Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !asset}>
              {saving
                ? "Saving…"
                : total !== null
                  ? `Save · ${fmtUsd(total)}`
                  : "Save transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
