"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
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
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  function reset() {
    setStep("upload");
    setCsvText("");
    setPresetLabel(null);
    setParsed(null);
    setMapping({});
    setAiSummary(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const importer = detectImporter(text);
    if (importer) {
      setPresetLabel(importer.label);
      setParsed(importer.parse(text));
      setStep("preview");
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
        setParsed(parseGenericCsv(text, aiMapping));
        setPresetLabel("AI-mapped");
        setStep("preview");
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
    setParsed(parseGenericCsv(csvText, m));
    setStep("preview");
  }

  async function runImport() {
    if (!parsed || !accountId) {
      toast.error("Select a destination account");
      return;
    }
    setImporting(true);
    try {
      // Resolve each unique symbol to an asset id.
      const names = new Map<string, string>();
      for (const t of parsed.transactions) {
        const key = `${t.symbol}|${t.assetClass ?? "stock"}`;
        if (t.name && !names.has(key)) names.set(key, t.name);
      }
      const symbols = [...new Set(parsed.transactions.map((t) => `${t.symbol}|${t.assetClass ?? "stock"}`))];
      const assetIds = new Map<string, string>();
      for (const key of symbols) {
        const [symbol, cls] = key.split("|") as [string, "stock" | "etf" | "fund" | "crypto"];
        const asset = await ensureAsset.mutateAsync({
          symbol,
          name: names.get(key) ?? symbol,
          class: cls,
        });
        assetIds.set(key, asset.id);
      }

      const { inserted, skipped } = await bulkCreate.mutateAsync({
        transactions: parsed.transactions.map((t) => ({
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
      toast.success(
        skipped > 0
          ? `Imported ${inserted} transactions · skipped ${skipped} already in this account`
          : `Imported ${inserted} transactions`,
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
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
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
            </div>

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
                    <TableHead>Date</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.transactions.slice(0, 50).map((t, i) => (
                    <TableRow key={i}>
                      <TableCell>{t.tradedAt.toISOString().slice(0, 10)}</TableCell>
                      <TableCell className="font-medium">{t.symbol}</TableCell>
                      <TableCell>{t.type}</TableCell>
                      <TableCell className="data text-right">{t.quantity}</TableCell>
                      <TableCell className="data text-right">
                        {t.pricePerUnit ?? "—"}
                      </TableCell>
                      <TableCell className="data text-right">{t.fees}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-end gap-3">
              <div className="grid flex-1 gap-1.5">
                <Label className="text-xs">Into account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
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
              </div>
              <Button
                onClick={runImport}
                disabled={importing || parsed.transactions.length === 0}
              >
                {importing
                  ? "Importing…"
                  : `Import ${parsed.transactions.length} transactions`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
