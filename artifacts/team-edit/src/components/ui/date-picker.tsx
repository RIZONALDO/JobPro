import { useState, useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight, X, Clock, ArrowLeft, ChevronUp, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  value: string;           // YYYY-MM-DD | YYYY-MM-DDTHH:MM | ""
  onChange: (v: string) => void;
  placeholder?: string;
  withTime?: boolean;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const WEEK   = ["D","S","T","Q","Q","S","S"];

function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function display(v: string, withTime?: boolean): string {
  if (!v) return "";
  const [dp, tp] = v.split("T");
  const [y,m,d] = dp.split("-");
  return withTime && tp ? `${d}/${m}/${y} ${tp.slice(0,5)}` : `${d}/${m}/${y}`;
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
function labelDate(s: string): string {
  if (!s) return "";
  const [y,m,d] = s.split("-");
  return `${parseInt(d)} de ${MONTHS[parseInt(m)-1]} de ${y}`;
}

// ── Animated time drum ───────────────────────────────────────────────────────

function TimeDrum({ value, label, onUp, onDown }: {
  value: string; label: string;
  onUp: () => void; onDown: () => void;
}) {
  const [dir, setDir] = useState(0); // 1 = up, -1 = down

  function up()   { setDir(1);  onUp();   }
  function down() { setDir(-1); onDown(); }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" onClick={up}
        className="h-8 w-10 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
        <ChevronUp className="h-4 w-4" />
      </button>

      <div className="h-12 w-10 overflow-hidden flex items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: dir * -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: dir * 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 32 }}
            className="text-2xl font-bold text-[hsl(var(--foreground))] tabular-nums select-none"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>

      <button type="button" onClick={down}
        className="h-8 w-10 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
        <ChevronDown className="h-4 w-4" />
      </button>

      <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mt-0.5">
        {label}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DatePicker({ value, onChange, placeholder = "Selecionar data", withTime, className }: Props) {
  const today    = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toStr(today), [today]);

  const [open,    setOpen]    = useState(false);
  const [step,    setStep]    = useState<"date"|"time">("date");
  const [viewY,   setViewY]   = useState(() => { const { date } = parseParts(value); return date ? parseInt(date.slice(0,4)) : today.getFullYear(); });
  const [viewM,   setViewM]   = useState(() => { const { date } = parseParts(value); return date ? parseInt(date.slice(5,7))-1 : today.getMonth(); });
  const [selDate, setSelDate] = useState(() => parseParts(value).date);
  const [selH,    setSelH]    = useState(() => parseInt(parseParts(value).time.slice(0,2)));
  const [selMin,  setSelMin]  = useState(() => parseInt(parseParts(value).time.slice(3,5)));

  const days = useMemo(() => calDays(viewY, viewM), [viewY, viewM]);

  function prev() { viewM === 0 ? (setViewM(11), setViewY(y => y-1)) : setViewM(m => m-1); }
  function next() { viewM === 11 ? (setViewM(0),  setViewY(y => y+1)) : setViewM(m => m+1); }

  function pickDay(d: Date) {
    setSelDate(toStr(d));
    if (withTime) { setStep("time"); }
    else { onChange(toStr(d)); setOpen(false); }
  }

  function confirm() {
    if (!selDate) return;
    const t = `${String(selH).padStart(2,"0")}:${String(selMin).padStart(2,"0")}`;
    onChange(withTime ? `${selDate}T${t}` : selDate);
    setOpen(false);
    setStep("date");
  }

  function handleOpen(v: boolean) {
    if (v) {
      const { date, time } = parseParts(value);
      setSelDate(date);
      setSelH(parseInt(time.slice(0,2)));
      setSelMin(parseInt(time.slice(3,5)));
      setStep("date");
      if (date) { setViewY(parseInt(date.slice(0,4))); setViewM(parseInt(date.slice(5,7))-1); }
    } else {
      setStep("date");
    }
    setOpen(v);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
    setSelDate("");
    setSelH(8);
    setSelMin(0);
  }

  const hStr   = String(selH).padStart(2,"0");
  const minStr = String(selMin).padStart(2,"0");

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={[
          "flex items-center h-9 w-full rounded-xl border bg-[hsl(var(--background))] px-3 gap-2 transition-all text-left",
          open ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]/15"
               : "border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40",
          className,
        ].filter(Boolean).join(" ")}>
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

      <PopoverContent className="p-3 overflow-hidden" style={{ width: 240 }} align="start">

        {/* Bounce na abertura */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
        >
          <AnimatePresence mode="wait" initial={false}>

            {/* ── Etapa 1: Calendário ── */}
            {step === "date" && (
              <motion.div key="date"
                initial={{ x: -18, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -18, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
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
              </motion.div>
            )}

            {/* ── Etapa 2: Horário ── */}
            {step === "time" && (
              <motion.div key="time"
                initial={{ x: 18, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 18, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="space-y-4"
              >
                {/* Header */}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setStep("date")}
                    className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
                    <ArrowLeft className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                    <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
                      {labelDate(selDate)}
                    </span>
                  </div>
                </div>

                {/* Drums */}
                <div className="flex items-center justify-center gap-2 py-1">
                  <TimeDrum
                    value={hStr} label="hora"
                    onUp={() => setSelH(h => (h+1) % 24)}
                    onDown={() => setSelH(h => (h+23) % 24)}
                  />
                  <span className="text-3xl font-bold text-[hsl(var(--muted-foreground))]/40 mb-4 select-none">:</span>
                  <TimeDrum
                    value={minStr} label="min"
                    onUp={() => setSelMin(m => (m+5) % 60)}
                    onDown={() => setSelMin(m => (m+55) % 60)}
                  />
                </div>

                <Button type="button" size="sm" className="w-full h-8 text-xs" onClick={confirm}>
                  Confirmar {hStr}:{minStr}
                </Button>
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>

      </PopoverContent>
    </Popover>
  );
}
