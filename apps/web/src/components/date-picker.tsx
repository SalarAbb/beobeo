"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** A local calendar date as YYYY-MM-DD. `toISOString()` is the UTC date,
 * already tomorrow on a US evening, and the calendar disables future days. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A typed date as a local Date: 2024-10-01, 10/1/2024, 10/1/24 (US order) or
 * "Oct 1, 2024". Null when it isn't a real day (Feb 31) or is in the future.
 */
export function parseTypedDate(text: string, today: Date = new Date()): Date | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3]) + (us[3]!.length === 2 ? 2000 : 0)];
  else if (/[a-z]/i.test(s) && !Number.isNaN(Date.parse(s))) {
    const t = new Date(s);
    [y, m, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  } else return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (y < 1900 || localIsoDate(date) > localIsoDate(today)) return null;
  return date;
}

/**
 * A date field bound to an ISO date string (YYYY-MM-DD): type it, or pick it
 * from the calendar behind the icon, whose month/year dropdowns make far-back
 * dates (old buys) quick to reach. Typing came after setup asked when a
 * holding was bought: clicking a calendar back two years read as slow to a
 * keyboard user (hermione, mission 90).
 */
export function DatePicker({
  value,
  onChange,
  className,
  label = "Date",
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  /** The field's accessible name (the visible label isn't tied to it). */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // What's being typed; null shows the value formatted.
  const [draft, setDraft] = useState<string | null>(null);
  // A local date: the calendar works in local time, and noon UTC is already
  // tomorrow east of UTC+12.
  const [y, m, d] = value.split("-").map(Number);
  const selected =
    /^\d{4}-\d{2}-\d{2}$/.test(value) && y && m && d
      ? new Date(y, m - 1, d)
      : undefined;

  const typed = draft === null ? null : parseTypedDate(draft);
  // Commit a valid typed date; anything else goes back to the saved value.
  function commit() {
    if (typed) onChange(localIsoDate(typed));
    setDraft(null);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("w-full", className)}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              aria-label={label}
              aria-invalid={draft !== null && draft.trim() !== "" && !typed}
              placeholder="MM/DD/YYYY"
              className="pl-9"
              value={draft ?? (selected ? fmt.format(selected) : "")}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                // Enter takes the date instead of submitting the form around it.
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Pick from a calendar"
                className="absolute top-1/2 left-1 size-7 -translate-y-1/2 text-muted-foreground"
              >
                <CalendarIcon className="size-4 opacity-60" />
              </Button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        {/* Echo what the typing reads as: "Oct 2024" saved as Oct 1 with
            nothing on screen to audit it (hermione, mission 91). */}
        {draft !== null && draft.trim() !== "" && (
          <p className={cn("mt-1 text-xs", typed ? "text-muted-foreground" : "text-destructive")}>
            {typed ? `Reads as ${fmt.format(typed)}` : "Not a date yet: try 10/1/2024"}
          </p>
        )}
      </div>
      {/* Focus lands on the selected day, not the previous-month button, so
          arrow keys move the date right away. It's moved here, once the
          popover's focus scope is active: the day button's own focus fires
          first and a surrounding dialog's focus trap pulled it back to the
          trigger. */}
      <PopoverContent
        className="w-auto p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('button[data-day][tabindex="0"]')
            ?.focus();
        }}
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
              onChange(localIsoDate(d));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
