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

/** A month with no day ("Aug 2024", "August 2024", "8/2024"): people often
 *  know only the month they bought in (hermione mission 115, luna 125). */
const MONTH_ONLY_NUM = /^(\d{1,2})[/.-](\d{4})$/;
const MONTH_ONLY_WORD = /^[a-z]+\.?,?\s+\d{4}$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function isMonthOnly(text: string): boolean {
  const s = text.trim();
  return MONTH_ONLY_NUM.test(s) || MONTH_ONLY_WORD.test(s);
}

/** A month-only date whose month runs past its anniversary: taking the 1st
 *  could call a sale long-term weeks before it is. */
function nearAYear(d: Date, today: Date = new Date()): boolean {
  const days = (today.getTime() - d.getTime()) / 86_400_000;
  return days > 330 && days < 400;
}

/**
 * A typed date as a local Date: 2024-10-01, 10/1/2024, 10/1/24 (US order),
 * "Oct 1, 2024", or a month alone ("Oct 2024", "10/2024"), read as its 1st.
 * Null when it isn't a real day (Feb 31) or is in the future.
 */
export function parseTypedDate(text: string, today: Date = new Date()): Date | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s);
  const month = MONTH_ONLY_NUM.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3]) + (us[3]!.length === 2 ? 2000 : 0)];
  else if (month) [m, d, y] = [Number(month[1]), 1, Number(month[2])];
  else if (MONTH_ONLY_WORD.test(s)) {
    // By hand: not every browser's Date.parse reads "Aug 2024".
    const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
    if (i < 0) return null;
    [m, d, y] = [i + 1, 1, Number(/\d{4}$/.exec(s)![0])];
  }
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
  // The value a month-only entry committed: its "the 1st" note stays under
  // the field until the date changes, since a note shown only while typing
  // was gone by the time hermione looked (mission 126).
  const [monthOnly, setMonthOnly] = useState<string | null>(null);
  // Commit a valid typed date; anything else goes back to the saved value.
  function commit() {
    if (typed) {
      onChange(localIsoDate(typed));
      setMonthOnly(isMonthOnly(draft!) ? localIsoDate(typed) : null);
    }
    setDraft(null);
  }
  const monthNote = (d: Date) =>
    `Day assumed: the 1st, since none was given.${
      nearAYear(d) ? " Within a few weeks of a year ago, the exact day decides when a sale gets the lower tax rate." : ""
    }`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("w-full", className)}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              aria-label={label}
              aria-invalid={draft !== null && draft.trim() !== "" && !typed}
              placeholder="MM/DD/YYYY or Oct 2024"
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
        {draft !== null && draft.trim() !== "" ? (
          <p className={cn("mt-1 text-xs", typed ? "text-muted-foreground" : "text-destructive")}>
            {!typed
              ? "Not a date yet: try 10/1/2024 or Oct 2024"
              : isMonthOnly(draft)
                ? `Reads as ${fmt.format(typed)}. ${monthNote(typed)}`
                : `Reads as ${fmt.format(typed)}`}
          </p>
        ) : (
          draft === null &&
          selected &&
          monthOnly === value && (
            <p className="mt-1 text-xs text-muted-foreground">{monthNote(selected)}</p>
          )
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
            // Clicking the day already picked deselects it (d undefined):
            // keep the date and close, as picking it again means "this one"
            // (olenna, mission 112, had to press Escape).
            if (d) {
              onChange(localIsoDate(d));
              setMonthOnly(null);
            }
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
