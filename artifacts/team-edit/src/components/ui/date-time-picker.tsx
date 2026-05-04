import { useState, useEffect } from "react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { format, parse, isValid } from "date-fns";
import { Calendar, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import "react-day-picker/style.css";

function pad(n: number) { return String(n).padStart(2, "0"); }

function hexRgba(hex: string, a: number) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return `rgba(99,102,241,${a})`;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function parseIso(val: string) {
  if (!val) return { date: undefined, h: 0, m: 0 };

  // Always use the date-string portion directly so the calendar highlights the right day
  // even for UTC-midnight values (avoids local/UTC day-boundary mismatch).
  const [dp, tp = ""] = val.split("T");
  const d = parse(dp, "yyyy-MM-dd", new Date());

  let h = 0, m = 0;
  if (tp) {
    // Detect any timezone indicator: "Z", "+HH:MM", "-HH:MM", "+HHMM", "-HHMM"
    const hasTZ = tp.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(tp);
    if (hasTZ) {
      // Convert the UTC/timezone-aware instant to the browser's local hours/minutes.
      const dt = new Date(val);
      if (!isNaN(dt.getTime())) {
        h = dt.getHours();
        m = dt.getMinutes();
      }
    } else {
      // Naive datetime — hours/minutes are already in local time.
      [h = 0, m = 0] = tp.split(":").map(Number);
    }
  }

  return { date: isValid(d) ? d : undefined, h, m };
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  min?: string;
  max?: string;
  withTime?: boolean;
  placeholder?: string;
  className?: string;
}

export function DateTimePicker({
  value, onChange, min, max, withTime = false,
  placeholder = "Selecionar data", className,
}: Props) {
  const { settings } = useSettings();
  const color = settings.primary_color || "#6366f1";
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState({ h: 0, m: 0 });

  // Sync time inputs when value changes externally (e.g. form reset, edit load)
  useEffect(() => {
    const { h, m } = parseIso(value);
    setTime({ h, m });
  }, [value]);

  const { date: selectedDate } = parseIso(value);

  const minDate = min ? parse(min.split("T")[0], "yyyy-MM-dd", new Date()) : null;
  const maxDate = max ? parse(max.split("T")[0], "yyyy-MM-dd", new Date()) : null;
  const disabled = (date: Date) => {
    if (minDate && isValid(minDate) && date < minDate) return true;
    if (maxDate && isValid(maxDate) && date > maxDate) return true;
    return false;
  };

  function handleDay(day: Date | undefined) {
    if (!day) return;
    if (withTime) {
      // Build a local datetime and emit as UTC ISO so the server is timezone-agnostic.
      const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m, 0);
      onChange(dt.toISOString());
    } else {
      // Date-only: send a plain YYYY-MM-DD string.
      onChange(format(day, "yyyy-MM-dd"));
      setOpen(false);
    }
  }

  function handleTime(type: "h" | "m", raw: string) {
    const n = Math.max(0, Math.min(type === "h" ? 23 : 59, parseInt(raw, 10) || 0));
    const next = { ...time, [type]: n };
    setTime(next);
    if (selectedDate) {
      // Emit as UTC ISO — parseIso will convert back to local on next render.
      const dt = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), next.h, next.m, 0);
      onChange(dt.toISOString());
    }
  }

  // Display derived from value prop (not state) so it's always in sync
  const { date: dispDate, h: dispH, m: dispM } = parseIso(value);
  const display = dispDate
    ? format(dispDate, "dd/MM/yyyy") + (withTime ? `  ${pad(dispH)}:${pad(dispM)}` : "")
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 w-full h-9 px-3 rounded-lg border text-sm transition-all bg-[hsl(var(--background))]",
            !display && "text-[hsl(var(--muted-foreground))]",
            className
          )}
          style={{
            borderColor: open ? color : undefined,
            boxShadow: open ? `0 0 0 3px ${hexRgba(color, 0.15)}` : undefined,
          }}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0" style={{ color: display ? color : undefined }} />
          <span className="flex-1 text-left font-medium">{display ?? placeholder}</span>
          {display && (
            <span
              role="button"
              onMouseDown={e => { e.stopPropagation(); onChange(""); setOpen(false); }}
              className="flex items-center justify-center h-4 w-4 rounded-full hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-0 w-auto">
        <DayPicker
          mode="single"
          selected={selectedDate}
          onSelect={handleDay}
          disabled={!min && !max ? undefined : disabled}
          locale={ptBR}
          weekStartsOn={1}
          showOutsideDays
          className="p-2"
          style={{
            "--rdp-accent-color": color,
            "--rdp-accent-background-color": hexRgba(color, 0.15),
            "--rdp-today-color": color,
            "--rdp-day-height": "30px",
            "--rdp-day-width": "30px",
            "--rdp-day_button-height": "28px",
            "--rdp-day_button-width": "28px",
            fontSize: "13px",
            "--rdp-nav-height": "2rem",
            "--rdp-nav_button-height": "1.75rem",
            "--rdp-nav_button-width": "1.75rem",
          } as React.CSSProperties}
        />

        {withTime && (
          <div className="border-t px-3 pb-3 pt-2 space-y-2">
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ backgroundColor: hexRgba(color, 0.07) }}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" style={{ color }} />
              <span className="text-xs text-[hsl(var(--muted-foreground))] flex-1">Horário</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0} max={23} value={pad(time.h)}
                  onChange={e => handleTime("h", e.target.value)}
                  className="w-10 h-7 text-center text-sm font-bold rounded-lg border-2 bg-[hsl(var(--background))] outline-none"
                  style={{ borderColor: hexRgba(color, 0.4), color }}
                />
                <span className="text-sm font-black" style={{ color }}>:</span>
                <input
                  type="number" min={0} max={59} value={pad(time.m)}
                  onChange={e => handleTime("m", e.target.value)}
                  className="w-10 h-7 text-center text-sm font-bold rounded-lg border-2 bg-[hsl(var(--background))] outline-none"
                  style={{ borderColor: hexRgba(color, 0.4), color }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={!selectedDate}
              className="w-full text-xs py-1.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: color }}
            >
              Aplicar
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
