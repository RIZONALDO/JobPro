import { useState, useEffect } from "react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { format, parse, isValid } from "date-fns";
import { Calendar, Clock, X, ChevronLeft, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import "react-day-picker/style.css";

const PANEL_W = 280;

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
  const [dp, tp = ""] = val.split("T");
  const d = parse(dp, "yyyy-MM-dd", new Date());
  let h = 0, m = 0;
  if (tp) {
    const hasTZ = tp.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(tp);
    if (hasTZ) {
      const dt = new Date(val);
      if (!isNaN(dt.getTime())) { h = dt.getHours(); m = dt.getMinutes(); }
    } else {
      [h = 0, m = 0] = tp.split(":").map(Number);
    }
  }
  return { date: isValid(d) ? d : undefined, h, m };
}

// ── TimeSpinner ───────────────────────────────────────────────────────────────

function TimeSpinner({
  value, max, label, onAdjust, onInput, color,
}: {
  value: number; max: number; label: string;
  onAdjust: (delta: number) => void;
  onInput: (val: string) => void;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => onAdjust(1)}
        className="h-7 w-14 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <input
        type="number"
        min={0}
        max={max}
        value={pad(value)}
        onChange={e => onInput(e.target.value)}
        className="w-14 h-14 text-center text-3xl font-bold rounded-xl border-2 bg-[hsl(var(--background))] outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        style={{ borderColor: hexRgba(color, 0.35), color }}
      />
      <button
        type="button"
        onClick={() => onAdjust(-1)}
        className="h-7 w-14 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]/40 mt-0.5">
        {label}
      </span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

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
  const [step, setStep] = useState<"calendar" | "time">("calendar");
  const [time, setTime] = useState({ h: 0, m: 0 });

  useEffect(() => {
    const { h, m } = parseIso(value);
    setTime({ h, m });
  }, [value]);

  // Reset to calendar after popover closes (after transition)
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setStep("calendar"), 320);
      return () => clearTimeout(t);
    }
  }, [open]);

  const { date: selectedDate } = parseIso(value);

  const minDate = min ? parse(min.split("T")[0], "yyyy-MM-dd", new Date()) : null;
  const maxDate = max ? parse(max.split("T")[0], "yyyy-MM-dd", new Date()) : null;
  const isDisabled = (date: Date) => {
    if (minDate && isValid(minDate) && date < minDate) return true;
    if (maxDate && isValid(maxDate) && date > maxDate) return true;
    return false;
  };

  function commit(date: Date, h: number, m: number) {
    const dt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0);
    onChange(dt.toISOString());
  }

  function handleDay(day: Date | undefined) {
    if (!day) return;
    if (withTime) {
      commit(day, time.h, time.m);
      // Short delay so the selected-day highlight renders before sliding
      setTimeout(() => setStep("time"), 80);
    } else {
      onChange(format(day, "yyyy-MM-dd"));
      setOpen(false);
    }
  }

  function adjustTime(type: "h" | "m", delta: number) {
    const wrap = type === "h" ? 24 : 60;
    const next = { ...time, [type]: (time[type] + delta + wrap) % wrap };
    setTime(next);
    if (selectedDate) commit(selectedDate, next.h, next.m);
  }

  function handleTimeInput(type: "h" | "m", raw: string) {
    const max = type === "h" ? 23 : 59;
    const n = Math.max(0, Math.min(max, parseInt(raw, 10) || 0));
    const next = { ...time, [type]: n };
    setTime(next);
    if (selectedDate) commit(selectedDate, next.h, next.m);
  }

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

      <PopoverContent className="p-0 overflow-hidden" style={{ width: PANEL_W }}>
        {/* Sliding wrapper — two panels side by side */}
        <div
          className="flex"
          style={{
            width: PANEL_W * 2,
            transform: step === "time" ? `translateX(-${PANEL_W}px)` : "translateX(0)",
            transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >

          {/* ── Panel 1: Calendar ── */}
          <div style={{ width: PANEL_W, flexShrink: 0 }}>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDay}
              disabled={!min && !max ? undefined : isDisabled}
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
            {/* Quick-jump to time if date already chosen */}
            {withTime && selectedDate && (
              <div className="px-3 pb-2.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep("time")}
                  className="flex items-center gap-1 text-[11px] font-semibold opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color }}
                >
                  <Clock className="h-3 w-3" />
                  Ajustar horário
                </button>
              </div>
            )}
          </div>

          {/* ── Panel 2: Time ── */}
          <div style={{ width: PANEL_W, flexShrink: 0 }} className="flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[hsl(var(--border))]">
              <button
                type="button"
                onClick={() => setStep("calendar")}
                className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex-1 flex items-center justify-center gap-1.5">
                <Calendar className="h-3 w-3" style={{ color }} />
                <span className="text-xs font-semibold" style={{ color }}>
                  {dispDate ? format(dispDate, "dd 'de' MMM", { locale: ptBR }) : ""}
                </span>
              </div>
              <Clock className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50" />
            </div>

            {/* Spinners */}
            <div className="flex items-center justify-center gap-3 py-6">
              <TimeSpinner
                value={time.h} max={23} label="hora"
                onAdjust={d => adjustTime("h", d)}
                onInput={v => handleTimeInput("h", v)}
                color={color}
              />
              <span className="text-3xl font-black pb-5 select-none" style={{ color }}>:</span>
              <TimeSpinner
                value={time.m} max={59} label="min"
                onAdjust={d => adjustTime("m", d)}
                onInput={v => handleTimeInput("m", v)}
                color={color}
              />
            </div>

            {/* Confirm */}
            <div className="px-3 pb-3 mt-auto">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!selectedDate}
                className="w-full text-xs py-2 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: color }}
              >
                Confirmar
              </button>
            </div>
          </div>

        </div>
      </PopoverContent>
    </Popover>
  );
}
