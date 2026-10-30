"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Section } from "@/components/page-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";

const TYPE_LABEL = {
  taxable: "Taxable",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  other_tax_advantaged: "Other tax-advantaged",
} as const;

const TYPE_OPTIONS = Object.entries(TYPE_LABEL);
type AccountType = keyof typeof TYPE_LABEL;

export default function AccountsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const accounts = useQuery(trpc.accounts.list.queryOptions({}));
  const portfolios = useQuery(trpc.portfolios.list.queryOptions());
  const update = useMutation(
    trpc.accounts.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.accounts.list.queryOptions({}).queryKey,
        });
      },
    }),
  );

  const portfolioName = new Map((portfolios.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-12">
      <PageHeader
        title="Accounts"
        subtitle={
          "Flag which accounts are taxable brokerages vs. tax-advantaged (IRA, 401k) — " +
          "the Tax Center only sells from taxable accounts, and checks every account " +
          "here for a recent buy that would stop a loss from counting."
        }
      />

      <Section title="Your accounts">
          {accounts.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : accounts.data && accounts.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-1">Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Institution</TableHead>
                  <TableHead className="hidden sm:table-cell">Portfolio</TableHead>
                  <TableHead className="pr-1 text-right">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-1 font-medium">{a.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {a.institution ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {a.portfolioId ? (portfolioName.get(a.portfolioId) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="pr-1 text-right">
                      <Select
                        value={a.accountType}
                        onValueChange={(accountType) =>
                          update.mutate({ id: a.id, accountType: accountType as AccountType })
                        }
                      >
                        <SelectTrigger size="sm" className="ml-auto w-40 sm:w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          {TYPE_OPTIONS.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No accounts yet — add one from the transaction form.
            </p>
          )}
      </Section>
    </div>
  );
}
