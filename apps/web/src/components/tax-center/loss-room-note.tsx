"use client";

import { useQuery } from "@tanstack/react-query";
import { usePortfolio } from "@/components/portfolio-context";
import { useIncome } from "@/components/tax-center/use-income";
import { LOSS_DEDUCTION_CAP, type LossRoom } from "@/lib/loss-room";
import { useTRPC } from "@/lib/trpc";
import { fmtUsd } from "@/lib/viz";

const cap = fmtUsd(LOSS_DEDUCTION_CAP, 0);

/**
 * One sentence on how much of the year's $3,000 loss deduction is used and
 * what a loss taken now would do, plus, when the Dashboard's all-time "Gain
 * from sales" differs from this year's, that it counts every year: petyr read
 * his −$1,523 (all 2025 sales) as this year's and the page's $0 as wrong
 * (`tax-profile-ytd-zero-conflicts-with-dashboard`, `tax-center-loss-cap-room-missing`).
 * Shown on Harvest Losses and under Tax Profile's "This year so far".
 */
export function LossRoomNote({ room, taxYear }: { room: LossRoom; taxYear: number }) {
  const what = room.hasCarryforward
    ? `Your ${taxYear} sales and past years' losses`
    : `Your ${taxYear} sales`;
  return (
    <div className="grid max-w-2xl gap-1 text-sm text-muted-foreground">
      <p>
        {room.netGainUsd >= 0.5 ? (
          <>
            {what} net a gain of <span className="data">{fmtUsd(room.netGainUsd, 0)}</span>. A
            loss you take now cancels that first, then up to{" "}
            <span className="data">{cap}</span> more comes off your pay.
          </>
        ) : room.netLossUsd < 0.5 ? (
          <>
            {room.hasCarryforward ? what : `Your ${taxYear} sales so far`} net to about $0, so
            all <span className="data">{cap}</span> of the yearly loss deduction is unused: up
            to that much in losses can come off your pay this year.
          </>
        ) : room.leftUsd >= 0.5 ? (
          <>
            {what} net a loss of <span className="data">{fmtUsd(room.netLossUsd, 0)}</span>,
            which uses that much of the <span className="data">{cap}</span> a year that can
            come off your pay: <span className="data">{fmtUsd(room.leftUsd, 0)}</span> left.
          </>
        ) : (
          <>
            {what} net a loss of <span className="data">{fmtUsd(room.netLossUsd, 0)}</span>,
            so all <span className="data">{cap}</span> that can come off your pay is used
            {room.carriesUsd >= 0.5 && (
              <>
                {" "}
                and <span className="data">{fmtUsd(room.carriesUsd, 0)}</span> carries to next
                year
              </>
            )}
            . Another loss would carry forward too.
          </>
        )}
      </p>
      <AllTimeTie taxYear={taxYear} />
    </div>
  );
}

/** The Dashboard's all-time figure, named only when it differs from this year's. */
function AllTimeTie({ taxYear }: { taxYear: number }) {
  const trpc = useTRPC();
  const { portfolioId } = usePortfolio();
  const { complete: income } = useIncome();
  // The page prefetches this exact input, so it's usually already cached.
  const now = useQuery(trpc.tax.now.queryOptions({ portfolioId: portfolioId ?? undefined, income }));
  const r = now.data?.dashboardRealized;
  if (!r || Math.abs(r.allTime - r.thisYear) < 1) return null;
  return (
    <p>
      The Dashboard&apos;s Gain from sales, <span className="data">{fmtUsd(r.allTime, 0)}</span>,
      counts every year
      {Math.abs(r.thisYear) >= 1 ? (
        <>
          {" "}
          (<span className="data">{fmtUsd(r.thisYear, 0)}</span> in {taxYear}, retirement
          accounts included)
        </>
      ) : (
        <>, and none of it is from {taxYear}</>
      )}
      . Only this year&apos;s sales in taxable accounts count toward this year&apos;s tax.
    </p>
  );
}
