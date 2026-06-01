import { useState, useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight, X, Clock, ArrowLeft } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";

interface Props {
  value: string;           // YYYY-MM-DD | YYYY-MM-DDTHH:MM | ""
  onChange: (v: string) => void;
  placeholder?: string;
  withTime?: boolean;
  className?: string;
}

const MONTHS     = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MONTHS_SH  = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const WEEK       = ["D","S","T","Q","Q","S","S"];

function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function display(v: string, withTime?: boolean): string {
  if (!v) return "";
  const [datePart, timePart] = v.split("T");
  const [y, m, d] = datePart.split("-");
  const dateStr = `${d}/${m}/${y}`;
  if (withTime && timePart) return `${dateStr} ${timePart.slice(0,5)}`;
  return dateStr;
}
function calDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const out: (Date | null)[] = Array(first).fill(null);
  for (let i = 1; i <= total; i++) out.push(new Date(year, month, i));
  return out;
}
function parseParts(value: string) {
  if (!value) return { date: "", time: "08:00" };
  const [d, t] = value.split("T");
  return { date: d ?? "", time: t ? t.slice(0,5) : "08:00" };
}
function labelDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(d)} de ${MONTHS[parseInt(m)-1]} de ${y}`;
}

export function DatePicker({ value, onChange, placeholder = "Selecionar data", withTime, className }: Props) {
  const today    = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toStr(today), [today]);

  const [open,    setOpen]    = useState(false);
  const [step,    setStep]    = useState<"date"|"time">("date");
  const [viewY,   setViewY]   = useState(() => { const { date } = parseParts(value); return date ? parseInt(date.slice(0,4)) : today.getFullYear(); });
  const [viewM,   setViewM]   = useState(() => { const { date } = parseParts(value); return date ? parseInt(date.slice(5,7)) - 1 : today.getMonth(); });
  const [selDate, setSelDate] = useState(() => parseParts(value).date);
  const [selTime, setSelTime] = useState(() => parseParts(value).time);

  const days = useMemo(() => calDays(viewY, viewM), [viewY, viewM]);

  function prev() { viewM === 0 ? (setViewM(11), setViewY(y => y-1)) : setViewM(m => m-1); }
  function next() { viewM === 11 ? (setViewM(0),  setViewY(y => y+1)) : setViewM(m => m+1); }

  function pickDay(d: Date) {
    const s = toStr(d);
    setSelDate(s);
    if (withTime) {
      setStep("time");   // fecha calendário, abre seletor de hora
    } else {
      onChange(s);
      setOpen(false);
    }
  }

  function confirm() {
    if (!selDate) return;
    onChange(withTime ? `${selDate}T${selTime}` : selDate);
    setOpen(false);
    setStep("date");
  }

  function handleOpen(v: boolean) {
    if (v) {
      const { date, time } = parseParts(value);
      setSelDate(date);
      setSelTime(time);
      setStep("date");
      if (date) { setViewY(parseInt(date.slice(0,4))); setViewM(parseInt(date.slice(5,7)) - 1); }
    } else {
      setStep("date");
    }
    setOpen(v);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    setSelDate("");
    setSelTime("08:00");
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={[
            "flex items-center h-9 w-full rounded-xl border bg-[hsl(var(--background))] px-3 gap-2 transition-all text-left",
            open
              ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]/15"
              : "border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40",
            className,
          ].filter(Boolean).join(" ")}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className={`flex-1 text-sm ${value ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"}`}>
            {value ? display(value, withTime) : placeholder}
          </span>
          {value && (
            <span role="button" onClick={clear}
              className="h-4 w-4 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors shrink-0">
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-60 p-3" align="start">

        {/* ── Etapa 1: Calendário ── */}
        {step === "date" && (
          <>
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={prev}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold">{MONTHS[viewM]} {viewY}</span>
              <button type="button" onClick={next}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {WEEK.map((w, i) => (
                <div key={i} className="text-center text-[9px] font-bold text-[hsl(var(--muted-foreground))]/40 uppercase py-1">{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px">
              {days.map((d, i) => {
                if (!d) return <div key={i} />;
                const s   = toStr(d);
                const sel = s === selDate;
                const tod = s === todayStr;
                return (
                  <button key={i} type="button" onClick={() => pickDay(d)}
                    className={[
                      "h-7 w-full rounded-lg text-[11px] font-medium transition-all",
                      sel ? "bg-[hsl(var(--primary))] text-white shadow-sm"
                          : tod ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-bold"
                               : "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                    ].join(" ")}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── Etapa 2: Horário ── */}
        {step === "time" && (
          <div className="space-y-4">

            {/* Referência da data selecionada */}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setStep("date")}
                className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
                <ArrowLeft className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
              </button>
              <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
                {labelDate(selDate)}
              </span>
            </div>

            {/* Seletor de hora */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Horário
                </span>
              </div>
              <input
                type="time"
                value={selTime}
                onChange={e => setSelTime(e.target.value)}
                autoFocus
                className="w-full h-10 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 text-sm text-center font-semibold tracking-widest focus:outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary))]/15 transition-all"
              />
            </div>

            <Button type="button" size="sm" className="w-full h-8 text-xs" onClick={confirm}>
              Confirmar
            </Button>
          </div>
        )}

      </PopoverContent>
    </Popover>
  );
}
