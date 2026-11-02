"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/components/portfolio-context";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";

/**
 * What retirement accounts hold, and why the tab leaves it out. Without it a
 * holding in an IRA just isn't there: petyr (missions 110, 104) looked for his
 * BND loss on All Lots, Raise Cash and Harvest and read it as missing data.
 * `lots`: All Lots. `cash`: Raise Cash plans taxable sales only. `harvest`:
 * names each retirement holding that's below what was paid, since a loss
 * there can't be deducted.
 */
export function RetirementNote({ tab }: { tab: "lots" | "cash" | "harvest" }) {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const holdings = useQuery(
    trpc.accounts.holdings.queryOptions({ portfolioId: portfolioId ?? undefined }),
  );
  const untaxed = (holdings.data ?? [])
    .filter((a) => !a.taxed && a.holdings.length > 0)
    .sort((a, b) => b.value - a.value);
  if (untaxed.length === 0) return null;

  const held = untaxed.map((a, i) => (
    <span key={a.accountId}>
      {i > 0 && "; "}
      {a.holdings.map((h) => h.symbol).join(", ")} in {a.accountName} (
      <span className="data">{fmtUsd(a.value)}</span>)
    </span>
  ));
  const onAccounts = (
    <>
      They&apos;re on{" "}
      <Link href="/accounts" className="text-primary hover:underline">
        Accounts
      </Link>
      .
    </>
  );

  if (tab === "harvest") {
    // Each retirement holding below what was paid, biggest loss first.
    const losses = untaxed
      .flatMap((a) =>
        a.holdings
          .filter((h) => h.gain !== null && h.gain <= -0.005)
          .map((h) => ({ ...h, accountName: a.accountName, loss: -(h.gain ?? 0) })),
      )
      .sort((a, b) => b.loss - a.loss);
    return (
      <p className="text-sm text-muted-foreground">
        {losses.length > 0 && (
          <>
            {losses.map((h, i) => (
              <span key={`${h.accountName}-${h.assetId}`}>
                {i > 0 && (i === losses.length - 1 ? " and " : ", ")}
                {h.symbol} in {h.accountName} is{" "}
                <span className="data">{fmtUsd(h.loss)}</span> below what you paid
              </span>
            ))}
            , but a loss inside a retirement account can&apos;t be deducted, so{" "}
            {losses.length === 1 ? "it isn't" : "they aren't"} here.{" "}
          </>
        )}
        {losses.length > 0
          ? "Nothing in a retirement account is listed, since selling there isn't taxed: "
          : "Only taxable accounts are listed, since selling inside a retirement account isn't taxed: "}
        {held}. {onAccounts}
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {tab === "cash"
        ? "Plans sell only from taxable accounts, since selling inside a retirement account isn't taxed. Left out: "
        : "Not listed, since selling inside a retirement account isn't taxed: "}
      {held}. {onAccounts}
    </p>
  );
}
