"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * Calendar popover bound to an ISO date string (YYYY-MM-DD). Month/year
 * dropdowns make far-back dates (old buys) quick to reach.
 */
export function DatePicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // A local date: the calendar works in local time, and noon UTC is already
  // tomorrow east of UTC+12.
  const [y, m, d] = value.split("-").map(Number);
  const selected =
    /^\d{4}-\d{2}-\d{2}$/.test(value) && y && m && d
      ? new Date(y, m - 1, d)
      : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 size-4 opacity-60" />
          {selected ? fmt.format(selected) : "Pick a date"}
        </Button>
      </PopoverTrigger>
      {/* Focus lands on the selected day, not the previous-month button, so
          arrow keys move the date right away. */}
      <PopoverContent
        className="w-auto p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Calendar
          mode="single"
          autoFocus
          captionLayout="dropdown"
          selected={selected}
          defaultMonth={selected}
          startMonth={new Date(2000, 0)}
          endMonth={new Date()}
          disabled={{ after: new Date() }}
          onSelect={(d) => {
            if (d) {
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              onChange(iso);
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
