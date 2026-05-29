import { useState, useEffect, useMemo } from "react";
import { DayPicker, DateRange } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { format, parse, isValid, isBefore, startOfDay } from "date-fns";
import { Calendar, Clock, X, ChevronLeft, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/contexts/SettingsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import "react-day-picker/style.css";

const PANEL_W = 296;

function pad(n: number) { return String(n).padStart(2, "0"); }

function hexRgba(hex: string, a: number) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return `rgba(99,102,241,${a})`;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function parseEndTime(val: string): { h: number; m: number } {
  if (!val || !val.includes("T")) return { h: 18, m: 0 };
  const hasTZ = val.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(val);
  if (hasTZ) {
    const dt = new Date(val);
    if (!isNaN(dt.getTime())) return { h: dt.getHours(), m: dt.getMinutes() };
  }
  const tp = val.split("T")[1] || "";
  const [h = 18, m = 0] = tp.split(":").map(Number);
  return { h, m };
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
  /** Data de início do intervalo — só data "yyyy-MM-dd" (opcional) */
  startDate: string;
  /** Data de entrega — ISO string com hora, ou "yyyy-MM-dd" sem hora */
  endDate: string;
  onChangeStart: (v: string) => void;
  onChangeEnd: (v: string) => void;
  /** Se true, exibe spinner de hora para a data de entrega */
  withEndTime?: boolean;
  placeholder?: string;
  className?: string;
}

export function DateRangePicker({
  startDate, endDate, onChangeStart, onChangeEnd,
  withEndTime = false, placeholder = "Selecionar prazo", className,
}: Props) {
  const { settings } = useSettings();
  const color = settings.primary_color || "#6366f1";
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"calendar" | "time">("calendar");

  // Hoje sem horas — para bloquear datas passadas
  const today = useMemo(() => startOfDay(new Date()), []);

  // Draft state — só commitado ao clicar Aplicar
  const [range, setRange] = useState<DateRange>({});
  const [time, setTime] = useState({ h: 18, m: 0 });

  // Dia sob o cursor — para preview animado do range
  const [hoveredDay, setHoveredDay] = useState<Date | undefined>();

  // Range exibido no calendário: inclui preview hover quando só "from" está selecionado
  const displayRange = useMemo((): DateRange => {
    if (range.from && !range.to && hoveredDay) {
      const [a, b] = range.from <= hoveredDay
        ? [range.from, hoveredDay]
        : [hoveredDay, range.from];
      return { from: a, to: b };
    }
    return range;
  }, [range, hoveredDay]);

  // Sync draft com props ao abrir
  useEffect(() => {
    if (!open) return;
    // Extrai só "yyyy-MM-dd" de ambos — o banco devolve ISO timestamps
    const startStr = startDate ? startDate.split("T")[0] : undefined;
    const endStr   = endDate   ? endDate.split("T")[0]   : undefined;
    const from = startStr ? parse(startStr, "yyyy-MM-dd", new Date()) : undefined;
    const to   = endStr   ? parse(endStr,   "yyyy-MM-dd", new Date()) : undefined;

    const validFrom = from && isValid(from) ? from : undefined;
    const validTo   = to   && isValid(to)   ? to   : undefined;

    setRange({
      // Fix 3: data única → from = to, para que o DayPicker destaque o dia corretamente
      from: validFrom ?? validTo,
      to: validTo,
    });
    setTime(parseEndTime(endDate));
    setStep("calendar");
    setHoveredDay(undefined);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reseta step após fechar
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setStep("calendar"), 320);
      return () => clearTimeout(t);
    }
  }, [open]);

  function handleSelect(r: DateRange | undefined) {
    // Quando o displayRange tem from+to (por causa do hover preview),
    // o react-day-picker entende que é um range completo e "reseta" ao próximo clique,
    // retornando { from: clickedDate, to: undefined }.
    // Detectamos esse caso e reconstruímos o range correto.
    if (range.from && !range.to && r?.from && !r?.to) {
      const d1 = range.from;
      const d2 = r.from;
      if (format(d1, "yyyy-MM-dd") === format(d2, "yyyy-MM-dd")) {
        // Mesma data → seleção de data única
        setRange({ from: d1, to: d1 });
      } else {
        const [from, to] = d1 <= d2 ? [d1, d2] : [d2, d1];
        setRange({ from, to });
      }
    } else {
      setRange(r ?? {});
    }
    setHoveredDay(undefined);
  }

  function adjustTime(type: "h" | "m", delta: number) {
    const wrap = type === "h" ? 24 : 60;
    setTime(prev => ({ ...prev, [type]: (prev[type] + delta + wrap) % wrap }));
  }

  function handleTimeInput(type: "h" | "m", raw: string) {
    const max = type === "h" ? 23 : 59;
    const n = Math.max(0, Math.min(max, parseInt(raw, 10) || 0));
    setTime(prev => ({ ...prev, [type]: n }));
  }

  function handleApply() {
    // Se o usuário clicou só uma vez, from existe mas to não — trata o dia como início e prazo
    const effectiveFrom = range.from;
    const effectiveTo   = range.to ?? range.from;

    if (!effectiveTo) {
      // Nada selecionado
      onChangeStart("");
      onChangeEnd("");
      setOpen(false);
      return;
    }

    // startDate = from (ou effectiveTo se não houver from explícito)
    onChangeStart(format(effectiveFrom ?? effectiveTo, "yyyy-MM-dd"));

    // endDate = to (com hora opcional)
    if (withEndTime) {
      const dt = new Date(
        effectiveTo.getFullYear(), effectiveTo.getMonth(), effectiveTo.getDate(),
        time.h, time.m, 0
      );
      onChangeEnd(dt.toISOString());
    } else {
      onChangeEnd(format(effectiveTo, "yyyy-MM-dd"));
    }

    setOpen(false);
  }

  function handleCalendarApply() {
    if (withEndTime && (range.from || range.to)) {
      setStep("time");
    } else {
      handleApply();
    }
  }

  // ── Display no botão trigger ──────────────────────────────────────────────
  // Extrai só a parte de data ("yyyy-MM-dd") antes de parsear — banco devolve ISO
  const fromTriggerStr = startDate ? startDate.split("T")[0] : null;
  const fromParsed = fromTriggerStr ? parse(fromTriggerStr, "yyyy-MM-dd", new Date()) : null;
  const toStr = endDate ? endDate.split("T")[0] : null;
  const toParsed = toStr ? parse(toStr, "yyyy-MM-dd", new Date()) : null;
  const { h: dH, m: dM } = parseEndTime(endDate);

  // Só mostra seta de range quando from e to são dias diferentes
  const fromToStr = fromParsed && isValid(fromParsed) ? format(fromParsed, "yyyy-MM-dd") : null;
  const toOnlyStr = toParsed  && isValid(toParsed)  ? format(toParsed,  "yyyy-MM-dd") : null;
  const isRange   = fromToStr && toOnlyStr && fromToStr !== toOnlyStr;
  const timeStr   = withEndTime && endDate?.includes("T") ? `  ${pad(dH)}:${pad(dM)}` : "";

  const display = toParsed && isValid(toParsed)
    ? (isRange
        ? `${format(fromParsed!, "dd/MM")} → ${format(toParsed, "dd/MM/yyyy")}${timeStr}`
        : `${format(toParsed, "dd/MM/yyyy")}${timeStr}`)
    : null;

  const endDisplayLabel =
    (range.to ?? range.from)
      ? format(range.to ?? range.from!, "dd 'de' MMM", { locale: ptBR })
      : "";

  const hasSelection = !!(range.from || range.to);

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
              onMouseDown={e => {
                e.stopPropagation();
                onChangeStart("");
                onChangeEnd("");
                setOpen(false);
              }}
              className="flex items-center justify-center h-4 w-4 rounded-full hover:bg-[hsl(var(--muted))] transition-colors text-[hsl(var(--muted-foreground))]"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-0 overflow-hidden" style={{ width: PANEL_W }}>
        {/* Painel deslizante — calendário | hora */}
        <div
          className="flex"
          style={{
            width: PANEL_W * 2,
            transform: step === "time" ? `translateX(-${PANEL_W}px)` : "translateX(0)",
            transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >

          {/* ── Painel 1: Calendário ── */}
          <div style={{ width: PANEL_W, flexShrink: 0 }} className="flex flex-col">
            <DayPicker
              mode="range"
              selected={displayRange}
              onSelect={handleSelect}
              locale={ptBR}
              weekStartsOn={1}
              showOutsideDays
              // Fix 2: bloquear datas passadas (antes de hoje)
              disabled={{ before: today }}
              className="p-2"
              style={{
                "--rdp-accent-color": color,
                // Fundo do range (meio do intervalo) — mais visível
                "--rdp-accent-background-color": hexRgba(color, 0.18),
                "--rdp-range_middle-background-color": hexRgba(color, 0.18),
                // Cores das extremidades (start / end)
                "--rdp-range_start-date-background-color": color,
                "--rdp-range_end-date-background-color": color,
                "--rdp-range_start-color": "#ffffff",
                "--rdp-range_end-color": "#ffffff",
                "--rdp-range_middle-color": color,
                // Hoje
                "--rdp-today-color": color,
                // Tamanhos
                "--rdp-day-height": "30px",
                "--rdp-day-width": "30px",
                "--rdp-day_button-height": "28px",
                "--rdp-day_button-width": "28px",
                fontSize: "13px",
                "--rdp-nav-height": "2rem",
                "--rdp-nav_button-height": "1.75rem",
                "--rdp-nav_button-width": "1.75rem",
                "--rdp-disabled-opacity": "0.25",
              } as React.CSSProperties}
              // Fix 1: rastrear hover para exibir preview animado do range
              onDayMouseEnter={(day) => {
                if (isBefore(day, today)) return;
                setHoveredDay(day);
              }}
              onDayMouseLeave={() => setHoveredDay(undefined)}
            />

            {/* Hint de seleção */}
            {range.from && !range.to && (
              <p className="px-3 pb-1 text-[11px] text-[hsl(var(--muted-foreground))] text-center">
                Aplicar usa só este dia · ou clique outra data para criar intervalo
              </p>
            )}

            {/* Botões Cancelar / Aplicar */}
            <div className="flex gap-2 px-3 pb-3 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 text-xs py-2 rounded-xl font-semibold border transition-colors hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCalendarApply}
                disabled={!hasSelection}
                className="flex-1 text-xs py-2 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: color }}
              >
                {withEndTime ? "Próximo →" : "Aplicar"}
              </button>
            </div>
          </div>

          {/* ── Painel 2: Hora de entrega ── */}
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
                  {endDisplayLabel}
                </span>
              </div>
              <Clock className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]/50" />
            </div>

            {/* Label hora de entrega */}
            <p className="text-center text-[11px] text-[hsl(var(--muted-foreground))] pt-3 pb-0">
              Horário de entrega
            </p>

            {/* Spinners */}
            <div className="flex items-center justify-center gap-3 py-5">
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

            {/* Botões Voltar / Aplicar */}
            <div className="flex gap-2 px-3 pb-3 mt-auto">
              <button
                type="button"
                onClick={() => setStep("calendar")}
                className="flex-1 text-xs py-2 rounded-xl font-semibold border transition-colors hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
              >
                ← Voltar
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="flex-1 text-xs py-2 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: color }}
              >
                Aplicar
              </button>
            </div>
          </div>

        </div>
      </PopoverContent>
    </Popover>
  );
}
