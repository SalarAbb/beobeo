"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  detectImporter,
  parseCsv,
  parseGenericCsv,
  type GenericMapping,
  type ParseResult,
} from "@beobeo/importers";
import { usePortfolio } from "@/components/portfolio-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";

type Step = "upload" | "map" | "preview";

/** "3 in Schwab Brokerage, 1 in Roth IRA" */
function matchedSummary(rows: { inAccountName: string | null; inAccountId: string | null }[]) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.inAccountId) continue;
    const name = r.inAccountName ?? "another account";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => `${n} in ${name}`).join(", ");
}

export function CsvImportDialog({
  onImported,
  defaultOpen = false,
}: {
  onImported?: () => void;
  /** Open on mount (the welcome flow links to /transactions?import=1). */
  defaultOpen?: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<Step>("upload");

  const [csvText, setCsvText] = useState("");
  const [presetLabel, setPresetLabel] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [accountId, setAccountId] = useState("");
  const [importing, setImporting] = useState(false);

  // generic mapping state
  const headers = useMemo(
    () => (csvText ? parseCsv(csvText).headers : []),
    [csvText],
  );
  const [mapping, setMapping] = useState<Partial<GenericMapping>>({});

  const { portfolioId } = usePortfolio();
  const accounts = useQuery(
    trpc.accounts.list.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );
  const ensureAsset = useMutation(trpc.assets.ensure.mutationOptions());
  const bulkCreate = useMutation(trpc.transactions.bulkCreate.mutationOptions());
  const suggestMapping = useMutation(trpc.importer.suggestMapping.mutationOptions());
  const previewImport = useMutation(trpc.transactions.previewImport.mutationOptions());
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  // Which account already holds each row, for exactly this file + account (a stale answer is
  // never shown against another account's choice).
  const [check, setCheck] = useState<{
    parsed: ParseResult;
    accountId: string;
    rows: { assetId: string | null; inAccountId: string | null; inAccountName: string | null }[];
  } | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  // Rows the user ticked or unticked; the rest follow `includedByDefault`.
  const [picked, setPicked] = useState<Map<number, boolean>>(new Map());
  // How many rows were already in the account the dialog picked for the user (null = they picked).
  const [autoPicked, setAutoPicked] = useState<number | null>(null);
  // Set once the user picks an account, so a check still in flight never overrides their choice.
  const userChose = useRef(false);

  function reset() {
    userChose.current = false;
    setPicked(new Map());
    setAutoPicked(null);
    setStep("upload");
    setCsvText("");
    setPresetLabel(null);
    setParsed(null);
    setMapping({});
    setAiSummary(null);
    setCheck(null);
  }

  function showPreview(result: ParseResult) {
    setParsed(result);
    setStep("preview");
    // With one account there's nothing to choose.
    const only = !accountId && accounts.data?.length === 1 ? accounts.data[0]!.id : null;
    if (only) setAccountId(only);
    runCheck(result, only ?? accountId);
  }

  async function runCheck(result: ParseResult, forAccount: string) {
    if (result.transactions.length === 0) return;
    setCheckFailed(false);
    try {
      const { rows } = await previewImport.mutateAsync({
        accountId: forAccount || undefined,
        rows: result.transactions.map((t) => ({
          symbol: t.symbol,
          assetClass: t.assetClass ?? "stock",
          type: t.type,
          quantity: t.quantity,
          pricePerUnit: t.pricePerUnit,
          fees: t.fees,
          tradedAt: t.tradedAt,
        })),
      });
      // No account chosen yet: the file most likely comes from the account most of its rows
      // are already in, so pick that one (and say so) and check again against it.
      const counts = new Map<string, number>();
      for (const r of rows) if (r.inAccountId) counts.set(r.inAccountId, (counts.get(r.inAccountId) ?? 0) + 1);
      const likely = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (!forAccount && !userChose.current && likely && accounts.data?.some((a) => a.id === likely[0])) {
        setAccountId(likely[0]);
        setAutoPicked(likely[1]);
        void runCheck(result, likely[0]);
        return;
      }
      setCheck({ parsed: result, accountId: forAccount, rows });
    } catch {
      setCheckFailed(true);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const importer = detectImporter(text);
    if (importer) {
      setPresetLabel(importer.label);
      showPreview(importer.parse(text));
      return;
    }

    // Unrecognized format → let AI infer the mapping from header + samples.
    setPresetLabel(null);
    setStep("map");
    const raw = parseCsv(text);
    if (raw.headers.length < 2 || raw.rows.length === 0) return;
    try {
      const suggestion = await suggestMapping.mutateAsync({
        headers: raw.headers,
        sampleRows: raw.rows
          .slice(0, 8)
          .map((row) => raw.headers.map((h) => row[h] ?? "")),
      });
      const aiMapping: GenericMapping = {
        dateColumn: suggestion.dateColumn,
        symbolColumn: suggestion.symbolColumn,
        typeColumn: suggestion.typeColumn,
        quantityColumn: suggestion.quantityColumn,
        priceColumn: suggestion.priceColumn ?? undefined,
        totalAmountColumn: suggestion.totalAmountColumn ?? undefined,
        feesColumn: suggestion.feesColumn ?? undefined,
        noteColumn: suggestion.noteColumn ?? undefined,
        assetClassColumn: suggestion.assetClassColumn ?? undefined,
        typeMap: suggestion.typeMapRecord,
        classMap: suggestion.classMapRecord,
        skipTypes: suggestion.skipTypes.map((s) => s.toLowerCase()),
      };
      setMapping(aiMapping);
      setAiSummary(suggestion.summary);
      if (suggestion.confidence === "high") {
        // Confident → parse straight to preview; mapping stays editable via Back.
        setPresetLabel("AI-mapped");
        showPreview(parseGenericCsv(text, aiMapping));
      }
    } catch {
      // AI unavailable → the manual mapping UI is already showing.
    }
  }

  function applyMapping() {
    const m = mapping as GenericMapping;
    if (!m.dateColumn || !m.symbolColumn || !m.typeColumn || !m.quantityColumn) {
      toast.error("Map the date, symbol, type, and quantity columns");
      return;
    }
    showPreview(parseGenericCsv(csvText, m));
  }

  // Derived at render: the check counts only for the file and account on screen.
  const checked = check && check.parsed === parsed && check.accountId === accountId ? check.rows : null;
  const isHere = (i: number) => !!checked?.[i]?.inAccountId && checked[i]!.inAccountId === accountId;
  const isElsewhere = (i: number) => !!checked?.[i]?.inAccountId && checked[i]!.inAccountId !== accountId;
  // Already in this account: always skipped. Found in another account: left out unless ticked,
  // since a trade recorded in the IRA rarely belongs in the taxable account too (petyr, mission 80).
  const isIncluded = (i: number) => !isHere(i) && (picked.get(i) ?? !isElsewhere(i));
  const rowCount = parsed?.transactions.length ?? 0;
  const skipCount = checked ? checked.filter((_, i) => isHere(i)).length : 0;
  const elsewhereCount = checked ? checked.filter((_, i) => isElsewhere(i)).length : 0;
  const elsewhereIncluded = checked ? checked.filter((_, i) => isElsewhere(i) && isIncluded(i)).length : 0;
  const includedCount = checked ? checked.filter((_, i) => isIncluded(i)).length : rowCount;
  const accountName = accounts.data?.find((a) => a.id === accountId)?.name;
  // Import waits for the check (a click mid-check would bring in everything), unless it failed.
  const ready = !!accountId && (!!checked || checkFailed);

  async function runImport() {
    if (!parsed || !accountId) {
      toast.error("Select a destination account");
      return;
    }
    setImporting(true);
    try {
      // Resolve each unique symbol to an asset id: the preview's pick of an existing asset
      // (the user's own QQQ ETF for a file that calls it a stock), else create it.
      const names = new Map<string, string>();
      const assetIds = new Map<string, string>();
      parsed.transactions.forEach((t, i) => {
        const key = `${t.symbol}|${t.assetClass ?? "stock"}`;
        if (t.name && !names.has(key)) names.set(key, t.name);
        const known = check?.parsed === parsed ? check.rows[i]?.assetId : null;
        if (known) assetIds.set(key, known);
      });
      const symbols = [...new Set(parsed.transactions.map((t) => `${t.symbol}|${t.assetClass ?? "stock"}`))];
      for (const key of symbols.filter((k) => !assetIds.has(k))) {
        const [symbol, cls] = key.split("|") as [string, "stock" | "etf" | "fund" | "crypto"];
        const asset = await ensureAsset.mutateAsync({
          symbol,
          name: names.get(key) ?? symbol,
          class: cls,
        });
        assetIds.set(key, asset.id);
      }

      const { inserted, skipped } = await bulkCreate.mutateAsync({
        transactions: parsed.transactions.filter((_, i) => !checked || isIncluded(i)).map((t) => ({
          accountId,
          assetId: assetIds.get(`${t.symbol}|${t.assetClass ?? "stock"}`)!,
          type: t.type,
          quantity: t.quantity,
          pricePerUnit: t.pricePerUnit,
          fees: t.fees,
          tradedAt: t.tradedAt,
          note: t.note,
          source: `csv:${presetLabel ?? "generic"}`,
        })),
      });
      await queryClient.invalidateQueries();
      const alreadyHere = skipCount + skipped;
      const leftOut = checked ? rowCount - includedCount - skipCount : 0;
      toast.success(
        [
          `Imported ${inserted} transaction${inserted === 1 ? "" : "s"} into ${accountName ?? "the account"}`,
          alreadyHere > 0 && `skipped ${alreadyHere} already there`,
          leftOut > 0 && `left out ${leftOut} you didn't tick`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setOpen(false);
      reset();
      onImported?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const mapField = (key: keyof GenericMapping, label: string, required = false) => (
    <div className="grid gap-1.5">
      <Label className="text-xs">
        {label}
        {required && " *"}
      </Label>
      <Select
        value={(mapping[key] as string) ?? ""}
        onValueChange={(v) => setMapping((m) => ({ ...m, [key]: v }))}
      >
        <SelectTrigger className="h-8">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog
      open={open}
      // Closing keeps the preview, so the list behind can be checked and the dialog reopened
      // where it was; "Choose another file" starts over.
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-1 size-4" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import transactions</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="grid gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              Drop any broker or portfolio-app export (Robinhood, Coinbase,
              Delta, Schwab, …). Known formats are detected instantly; anything
              else is mapped automatically by AI, with a preview before import.
            </p>
            <p className="text-sm text-muted-foreground">
              The preview marks trades you already have. Ones already in the
              account you import into are skipped. A file goes into one
              account, so import each account&apos;s export on its own.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5"
            />
          </div>
        )}

        {step === "map" && (
          <div className="grid gap-4">
            {suggestMapping.isPending ? (
              <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Reading your file — AI is working out the column mapping…
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {aiSummary
                  ? `AI suggestion: ${aiSummary} Review and adjust below.`
                  : "Unrecognized format — map your columns:"}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              {mapField("dateColumn", "Date", true)}
              {mapField("symbolColumn", "Symbol", true)}
              {mapField("typeColumn", "Type", true)}
              {mapField("quantityColumn", "Quantity", true)}
              {mapField("priceColumn", "Price")}
              {mapField("feesColumn", "Fees")}
            </div>
            <Button onClick={applyMapping} disabled={suggestMapping.isPending}>
              Preview
            </Button>
          </div>
        )}

        {step === "preview" && parsed && (
          <div className="grid gap-4">
            <div className="flex items-center gap-2 text-sm">
              {presetLabel === "AI-mapped" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-muted-foreground"
                  onClick={() => setStep("map")}
                >
                  <ArrowLeft className="mr-1 size-3.5" /> Mapping
                </Button>
              )}
              {presetLabel && <Badge variant="secondary">{presetLabel}</Badge>}
              <span>{parsed.transactions.length} transactions</span>
              {parsed.skipped > 0 && (
                <span className="text-muted-foreground">
                  · {parsed.skipped} non-asset rows skipped
                </span>
              )}
              {parsed.issues.length > 0 && (
                <Badge variant="destructive">{parsed.issues.length} issues</Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-1.5 text-muted-foreground"
                onClick={reset}
              >
                Choose another file
              </Button>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Into account</Label>
              <Select
                value={accountId}
                onValueChange={(id) => {
                  userChose.current = true;
                  setAccountId(id);
                  setAutoPicked(null);
                  setPicked(new Map());
                  runCheck(parsed, id);
                }}
              >
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {autoPicked !== null && accountName && (
                <p className="text-xs text-muted-foreground">
                  Picked {accountName} because {autoPicked} of these rows are
                  already there. Change it if the file is from another account.
                </p>
              )}
            </div>

            <p className="text-sm" aria-live="polite">
              {parsed.transactions.length === 0 ? null : checkFailed ? (
                <span className="text-muted-foreground">
                  Couldn&apos;t check for trades you already have. Ones already
                  in the account are still skipped when you import.
                </span>
              ) : !checked ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Checking which of these you already have…
                </span>
              ) : !accountId ? (
                checked.some((r) => r.inAccountId) ? (
                  <>
                    {checked.filter((r) => r.inAccountId).length} of these are
                    already recorded ({matchedSummary(checked)}). Pick the
                    account this file is from.
                  </>
                ) : (
                  <>None of these are recorded yet. Pick the account they go into.</>
                )
              ) : (
                <>
                  <span className="font-medium">
                    {includedCount} to import into {accountName ?? "this account"}
                  </span>
                  {skipCount > 0 && <> · {skipCount} already there, skipped</>}
                  {elsewhereCount > 0 && (
                    <>
                      {" · "}
                      {elsewhereCount} already recorded in another account
                      {elsewhereIncluded === 0
                        ? ", left out (tick one to add it here too)"
                        : elsewhereIncluded < elsewhereCount
                          ? `, ${elsewhereIncluded} of them ticked to add here too`
                          : ", all ticked to add here too"}
                    </>
                  )}
                </>
              )}
            </p>

            {parsed.issues.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                {parsed.issues.map((issue, i) => (
                  <p key={i}>
                    Row {issue.row}: {issue.message}
                  </p>
                ))}
              </div>
            )}

            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <span className="sr-only">Import</span>
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Fees</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.transactions.slice(0, 50).map((t, i) => {
                    const where = checked?.[i];
                    const here = isHere(i);
                    const included = isIncluded(i);
                    const date = t.tradedAt.toISOString().slice(0, 10);
                    return (
                      <TableRow key={i} className={!included && checked ? "text-muted-foreground" : undefined}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="size-4 accent-primary align-middle disabled:opacity-40"
                            aria-label={`Import ${t.symbol} ${t.type} on ${date}`}
                            checked={checked ? included : true}
                            disabled={!checked || !accountId || here}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setPicked((m) => new Map(m).set(i, on));
                            }}
                          />
                        </TableCell>
                        <TableCell>{date}</TableCell>
                        <TableCell className="font-medium">{t.symbol}</TableCell>
                        <TableCell>{t.type}</TableCell>
                        <TableCell className="data text-right">{t.quantity}</TableCell>
                        <TableCell className="data text-right">
                          {t.pricePerUnit ?? "—"}
                        </TableCell>
                        <TableCell className="data hidden text-right sm:table-cell">{t.fees}</TableCell>
                        <TableCell className="text-xs">
                          {!where ? (
                            <span className="text-muted-foreground">…</span>
                          ) : here ? (
                            "Already here, skipped"
                          ) : where.inAccountId ? (
                            <span className="text-warn">In {where.inAccountName ?? "another account"}</span>
                          ) : (
                            <span className="text-muted-foreground">New</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {parsed.transactions.length > 50 && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Showing the first 50 of {parsed.transactions.length}.
              </p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={runImport}
                disabled={importing || !ready || includedCount === 0}
              >
                {importing
                  ? "Importing…"
                  : !accountId
                    ? "Pick an account first"
                    : !ready
                      ? "Checking…"
                      : includedCount === 0
                        ? "Nothing to import"
                        : `Import ${includedCount} transaction${includedCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
