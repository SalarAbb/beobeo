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

export function AddTransactionDialog({
  onCreated,
  onSaving,
  defaultOpen = false,
  defaultType = "buy",
  trigger,
}: {
  onCreated?: () => void;
  /** Called with what's being saved ("VOO buy") when Save is pressed, and
   *  with null if the save fails (the welcome step says so on the page). */
  onSaving?: (what: string | null) => void;
  /** What opens the dialog (default: the "Add transaction" button). */
  trigger?: React.ReactNode;
  /** Open on mount (the welcome flow links to /transactions?add=1). */
  defaultOpen?: boolean;
  /** Preselected type (the dashboard's Dividends tile links to ?add=dividend). */
  defaultType?: TxnType;
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
  // A payout opened from the dashboard is one total: 1 × the amount received.
  const [quantity, setQuantity] = useState(defaultType === "dividend" ? "1" : "");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [entry, setEntry] = useState<"price" | "total">("price");
  const [totalInput, setTotalInput] = useState("");
  const [fees, setFees] = useState("");
  const [date, setDate] = useState(() => localIsoDate());
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
  const qtyNum = Number(quantity);
  const feesNum = Number(fees) || 0;
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
    quantity !== "" &&
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
    const what = `${asset.symbol} ${type.replace("_", " ")}`;
    setSaving(true);
    setOpen(false);
    const toastId = toast.loading(`Saving ${what}…`);
    onSaving?.(what);
    try {
      let acctId = effectiveAccountId;
      if (!acctId) {
        const acct = await createAccount.mutateAsync({
          name: "Default",
          currency: "USD",
          portfolioId: portfolioId ?? undefined,
        });
        acctId = acct.id;
        void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
      }
      await createTxn.mutateAsync({
        accountId: acctId,
        assetId: asset.id,
        type,
        quantity,
        pricePerUnit:
          needsPrice(type) || type === "dividend" || type.startsWith("transfer")
            ? effectivePrice || null
            : null,
        fees: fees || "0",
        tradedAt: new Date(`${date}T12:00:00Z`),
        note: note || undefined,
        source: "manual",
      });
      toast.success(`${what} recorded`, { id: toastId });
      resetForm();
      onCreated?.();
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
              <Label>Date</Label>
              <DatePicker value={date} onChange={setDate} />
            </div>
          </div>

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
              <div className="flex items-baseline justify-between gap-1">
                <Label>{type === "dividend" ? "Amount" : byTotal ? "Total" : "Price"}</Label>
                {needsPrice(type) && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setEntry(byTotal ? "price" : "total")}
                  >
                    {byTotal ? "Enter price" : "Enter total"}
                  </button>
                )}
              </div>
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

          {/* Summary strip: price provenance + live total, fixed height so the
              grid above never shifts. */}
          <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3.5 py-2.5">
            <span className="text-xs text-muted-foreground">
              {byTotal
                ? derivedPrice
                  ? `Works out to $${Number(derivedPrice).toLocaleString("en-US", { maximumFractionDigits: Number(derivedPrice) >= 1 ? 4 : 8 })} per unit${feesNum ? " (fees counted in the total)" : ""}`
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
                <Input value="Default" disabled />
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
