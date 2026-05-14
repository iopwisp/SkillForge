/**
 * DateTimePicker — popover-based date+time picker.
 *
 * Replaces `<input type="datetime-local">` in contest / exam forms.
 * The native input is awkward on most browsers (small caret targets,
 * different layout per OS, no preset support, no relative-duration
 * shortcuts). This component:
 *
 *   - shows a calendar (shadcn `Calendar` over `react-day-picker`)
 *     for the date,
 *   - has two number inputs (hours / minutes, step=5) for the time,
 *   - exposes optional preset chips and quick-duration buttons,
 *   - emits ISO strings via `onChange` so callers can store them as-is.
 *
 * The picker keeps its own working `Date` so date / time can be edited
 * independently without losing the other half. Whenever working
 * mutates, `onChange(working.toISOString())` fires so the parent stays
 * in sync.
 */
import * as React from "react";
import { Calendar as CalendarIcon, Clock, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/components/ui/utils";
import {
  addMinutes, formatDateTimeWithWeekday, nextRoundedFiveMinutes,
} from "~/lib/datetime";

export interface DateTimePreset {
  /** Label rendered on the chip (e.g. "В через час" / "In 1 hour"). */
  label: string;
  /** Returns the absolute date the chip should set on click. */
  getValue: () => Date;
}

export interface DateTimePickerProps {
  /** ISO string or null. Source of truth for the trigger label. */
  value: string | null;
  /** Fired with `working.toISOString()` (or null when cleared). */
  onChange: (iso: string | null) => void;
  /** Disable dates before this (inclusive of the same calendar day). */
  minDate?: Date;
  /** Disable dates after this. */
  maxDate?: Date;
  /** Optional quick-pick chips above the calendar. */
  presets?: DateTimePreset[];
  /**
   * If set, render "+30m / +1h / +2h / +3h / +1d / +1w" buttons under
   * the time inputs. Clicking sets `value = durationFromValue + delta`.
   * Used by the contest-end picker so instructors don't have to
   * re-type the start date.
   */
  durationFromValue?: string | null;
  placeholder?: string;
  label?: string;
  error?: string | null;
  disabled?: boolean;
  className?: string;
  /** Optional id for the trigger; forwarded to the label's `htmlFor`. */
  id?: string;
}

/** Strip time so calendar `disabled` matches by day, not by minute. */
function startOfDay(d: Date): Date {
  const next = new Date(d.getTime());
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Combine a calendar date (day) and a wall-clock time (h/m). */
function combineDateAndTime(day: Date, hours: number, minutes: number): Date {
  const next = new Date(day.getTime());
  next.setHours(hours, minutes, 0, 0);
  return next;
}

const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: "+30 мин",  minutes: 30 },
  { label: "+1 час",   minutes: 60 },
  { label: "+2 часа",  minutes: 120 },
  { label: "+3 часа",  minutes: 180 },
  { label: "+1 день",  minutes: 60 * 24 },
  { label: "+1 неделя",minutes: 60 * 24 * 7 },
];

export function DateTimePicker({
  value,
  onChange,
  minDate,
  maxDate,
  presets,
  durationFromValue,
  placeholder = "Выберите дату и время",
  label,
  error,
  disabled,
  className,
  id,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Working state. When `value` is non-null, this mirrors it. When the
  // popover opens with null value, we seed it with "now + 1h" so the
  // user has something to tweak rather than an empty calendar.
  const [working, setWorking] = React.useState<Date | null>(
    value ? new Date(value) : null,
  );

  // Keep working in sync with prop changes from outside (e.g. a preset
  // applied by the parent, or a different form being loaded).
  React.useEffect(() => {
    setWorking(value ? new Date(value) : null);
  }, [value]);

  // When the popover opens with no value, seed the working state.
  // This does NOT call onChange — the parent's null stays null until
  // the user actually picks something. The calendar still gets a
  // visible default month / time.
  React.useEffect(() => {
    if (open && !value && !working) {
      setWorking(addMinutes(new Date(), 60));
    }
  }, [open, value, working]);

  // Effective Date used by the calendar / time inputs while editing.
  const effective: Date = working ?? new Date();
  const hours = effective.getHours();
  const minutes = effective.getMinutes();

  function commit(next: Date) {
    setWorking(next);
    onChange(next.toISOString());
  }

  function onCalendarSelect(day: Date | undefined) {
    if (!day) return;
    commit(combineDateAndTime(day, hours, minutes));
  }

  function onHoursChange(raw: string) {
    if (raw === "") return;
    let h = parseInt(raw, 10);
    if (Number.isNaN(h)) return;
    h = Math.max(0, Math.min(23, h));
    commit(combineDateAndTime(effective, h, minutes));
  }

  function onMinutesChange(raw: string) {
    if (raw === "") return;
    let m = parseInt(raw, 10);
    if (Number.isNaN(m)) return;
    m = Math.max(0, Math.min(59, m));
    commit(combineDateAndTime(effective, hours, m));
  }

  function onMinutesBlur(raw: string) {
    if (raw === "") return;
    let m = parseInt(raw, 10);
    if (Number.isNaN(m)) return;
    m = Math.max(0, Math.min(59, m));
    // Round to nearest 5 on blur so the typed value matches the
    // step= the up/down buttons enforce.
    const rounded = Math.round(m / 5) * 5 % 60;
    if (rounded !== minutes) {
      commit(combineDateAndTime(effective, hours, rounded));
    }
  }

  function applyPreset(getDate: () => Date) {
    commit(getDate());
  }

  function applyDuration(deltaMinutes: number) {
    if (!durationFromValue) return;
    const base = new Date(durationFromValue);
    if (Number.isNaN(base.getTime())) return;
    commit(addMinutes(base, deltaMinutes));
  }

  function onNow() {
    commit(nextRoundedFiveMinutes());
  }

  function onClear() {
    setWorking(null);
    onChange(null);
  }

  const calendarDisabled = React.useCallback(
    (date: Date) => {
      if (minDate && startOfDay(date).getTime() < startOfDay(minDate).getTime()) return true;
      if (maxDate && startOfDay(date).getTime() > startOfDay(maxDate).getTime()) return true;
      return false;
    },
    [minDate, maxDate],
  );

  const triggerLabel = value ? formatDateTimeWithWeekday(value) : placeholder;

  return (
    <div className={cn("flex flex-col", className)}>
      {label && (
        <Label htmlFor={id} className="mb-1.5">{label}</Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-invalid={!!error}
            aria-haspopup="dialog"
            data-slot="datetime-picker-trigger"
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-input-background px-3 py-1 text-sm text-left transition-[color,box-shadow] outline-none",
              "dark:bg-input/30",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-destructive ring-destructive/20 ring-[3px]",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">{triggerLabel}</span>
            <Clock className="size-4 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0"
          align="start"
          sideOffset={4}
        >
          <div className="flex flex-col">
            {presets && presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2.5">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset(p.getValue)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            )}

            <Calendar
              mode="single"
              selected={working ?? undefined}
              defaultMonth={effective}
              onSelect={onCalendarSelect}
              disabled={calendarDisabled}
              autoFocus
            />

            <div className="border-t border-border px-3 py-2.5 flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor={`${id ?? "dtp"}-hours`} className="text-xs text-muted-foreground mb-1">
                  Час
                </Label>
                <Input
                  id={`${id ?? "dtp"}-hours`}
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={String(hours).padStart(2, "0")}
                  onChange={(e) => onHoursChange(e.target.value)}
                  className="text-center tabular-nums"
                />
              </div>
              <div className="text-lg font-medium pb-1.5 text-muted-foreground">:</div>
              <div className="flex-1">
                <Label htmlFor={`${id ?? "dtp"}-minutes`} className="text-xs text-muted-foreground mb-1">
                  Мин
                </Label>
                <Input
                  id={`${id ?? "dtp"}-minutes`}
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={String(minutes).padStart(2, "0")}
                  onChange={(e) => onMinutesChange(e.target.value)}
                  onBlur={(e) => onMinutesBlur(e.target.value)}
                  className="text-center tabular-nums"
                />
              </div>
            </div>

            {durationFromValue && (
              <div className="border-t border-border px-3 py-2.5">
                <div className="text-xs text-muted-foreground mb-1.5">
                  Длительность от начала
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((d) => (
                    <Button
                      key={d.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyDuration(d.minutes)}
                    >
                      {d.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-border px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={onNow}>
                  Сейчас
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                  <X className="size-3.5" /> Очистить
                </Button>
              </div>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Готово
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </div>
  );
}
