"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Loading and failure states, born in the Tax Center tabs and now used app-wide. A bare grey
 * skeleton read as "broken" (gilderoy, barristan), and a failed query used to leave it up
 * forever (or, on the dashboard, read as "No holdings yet"), so pages say what they're doing
 * and offer a retry when it couldn't. DB requests time out (`@beobeo/db` fetch-timeout), so a
 * stalled query now reaches this state instead of hanging.
 */
export function TabLoading({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 rounded-md bg-accent/60 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function TabError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-y py-8 text-sm">
      <span>Couldn&apos;t load {what}. Your data is fine; the request didn&apos;t finish.</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
