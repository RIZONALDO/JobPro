import { useState, useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight, X, Clock, ArrowLeft, ChevronUp, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";
import { motion, AnimatePresence } from "framer-motion";
import { parseDate, localTzOffset } from "@/lib/date";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  withTime?: boolean;
  /** "HH:MM" a aplicar quando o usuário escolhe uma data sem hora prévia. */
  defaultTime?: (dateStr: string) => string;
  minDate?: string;   // YYYY-MM-DD local
  className?: string;
}

const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const WEEK   = ["D","S","T","Q","Q","S","S"];

// ── Utilitários ────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" a partir de um Date local */
function toStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

/** Dias do mês no calendário (null = célula vazia) */
function calDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const out: (Date | null)[] = Array(first).fill(null);
  for (let i = 1; i <= total; i++) out.push(new Date(year, month, i));
  return out;
}

/**
 * Desmonta `value` em { date: "YYYY-MM-DD", time: "HH:MM" }.
 *
 * Casos tratados:
 *  - ""                          → { date: "", time: "08:00" }
 *  - "YYYY-MM-DD" (sem hora)     → { date, time: defaultTimeFn(date) ?? "18:00" }
 *  - "YYYY-MM-DDTHH:MM..." (ISO) → { date local, time local }
 */
function parseParts(value: string, defaultTimeFn?: (d: string) => string): { date: string; time: string } {
  if (!value) return { date: "", time: "08:00" };

  // Sem componente de hora — aplica defaultTime para não mostrar 12:00 (noon do parseDate)
  if (!value.includes("T")) {
    const parts = value.split("-").map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return { date: "", time: "08:00" };
    const [y, m, d] = parts;
    const ds = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return { date: ds, time: defaultTimeFn ? defaultTimeFn(ds) : "18:00" };
  }

  // ISO completo — extrai hora local via Date
  const dt = parseDate(value);
  if (isNaN(dt.getTime())) return { date: "", time: "08:00" };
  return {
    date: toStr(dt),
    time: `${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`,
  };
}

/**
 * Texto do trigger do DatePicker.
 *
 * Para value sem "T" (legado, sem hora definida):
 *  - sem withTime: "DD/MM/AAAA"
 *  - com withTime: "DD/MM/AAAA" também — sem hora porque não foi definida ainda
 *
 * Para ISO com hora:
 *  - usa hora local do Date
 */
function formatDisplay(v: string, withTime?: boolean, defaultTimeFn?: (d: string) => string): string {
  if (!v) return "";

  if (!v.includes("T")) {
    // Sem hora explícita
    const parts = v.split("-").map(Number);
    if (parts.length < 3) return "";
    const [y, m, d] = parts;
    const base = `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}/${y}`;
    if (!withTime) return base;
    // Com withTime: mostra hora do defaultTime se disponível, senão só data
    const t = defaultTimeFn ? defaultTimeFn(v) : null;
    return t ? `${base} ${t}` : base;
  }

  const dt = parseDate(v);
  if (isNaN(dt.getTime())) return "";
  const dd   = String(dt.getDate()).padStart(2,"0");
  const mm   = String(dt.getMonth()+1).padStart(2,"0");
  const yyyy = dt.getFullYear();
  if (!withTime) return `${dd}/${mm}/${yyyy}`;
  const hh  = String(dt.getHours()).padStart(2,"0");
  const min = String(dt.getMinutes()).padStart(2,"0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ── TimeDrum ──────────────────────────────────────────────────────────────────

function TimeDrum({ value, label, onUp, onDown }: {
  value: string; label: string; onUp: () => void; onDown: () => void;
}) {
  const [dir, setDir] = useState(0);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" onClick={() => { setDir(1); onUp(); }}
        className="h-8 w-10 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
        <ChevronUp className="h-4 w-4" />
      </button>
      <div className="h-12 w-10 overflow-hidden flex items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value}
            initial={{ y: dir * -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: dir * 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 32 }}
            className="text-2xl font-bold tabular-nums select-none text-[hsl(var(--foreground))]">
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
      <button type="button" onClick={() => { setDir(-1); onDown(); }}
        className="h-8 w-10 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
        <ChevronDown className="h-4 w-4" />
      </button>
      <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mt-0.5">{label}</span>
    </div>
  );
}

// ── DatePicker ────────────────────────────────────────────────────────────────

export function DatePicker({ value, onChange, placeholder, withTime, defaultTime, minDate, className }: Props) {
  const today    = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toStr(today), [today]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"date" | "time">("date");

  // Estado interno do picker — inicializado uma vez, sincronizado em handleOpen
  const initP = parseParts(value, defaultTime);
  const [viewY,   setViewY]   = useState(() => initP.date ? parseInt(initP.date.slice(0,4))   : today.getFullYear());
  const [viewM,   setViewM]   = useState(() => initP.date ? parseInt(initP.date.slice(5,7))-1 : today.getMonth());
  const [selDate, setSelDate] = useState(() => initP.date);
  const [selH,    setSelH]    = useState(() => parseInt(initP.time.slice(0,2)));
  const [selMin,  setSelMin]  = useState(() => parseInt(initP.time.slice(3,5)));

  const days = useMemo(() => calDays(viewY, viewM), [viewY, viewM]);

  const canGoPrev = useMemo(() => {
    if (!minDate) return true;
    return toStr(new Date(viewY, viewM, 0)) >= minDate;
  }, [viewY, viewM, minDate]);

  function handleOpen(v: boolean) {
    if (v) {
      // Sincroniza SEMPRE ao abrir — garante hora correta mesmo após carga async
      const { date, time } = parseParts(value, defaultTime);
      setSelDate(date);
      setSelH(parseInt(time.slice(0,2)));
      setSelMin(parseInt(time.slice(3,5)));
      setStep("date");
      if (date) {
        setViewY(parseInt(date.slice(0,4)));
        setViewM(parseInt(date.slice(5,7))-1);
      }
    } else {
      setStep("date");
    }
    setOpen(v);
  }

  function prev() { if (!canGoPrev) return; viewM === 0 ? (setViewM(11), setViewY(y => y-1)) : setViewM(m => m-1); }
  function next() { viewM === 11 ? (setViewM(0), setViewY(y => y+1)) : setViewM(m => m+1); }

  function isDisabled(d: Date) { return !!minDate && toStr(d) < minDate; }

  function pickDay(d: Date) {
    if (isDisabled(d)) return;
    const s = toStr(d);
    setSelDate(s);
    if (withTime) {
      // Sempre aplica defaultTime ao trocar de data, para não "herdar" hora de outra data
      if (defaultTime) {
        const t = defaultTime(s);
        setSelH(parseInt(t.slice(0, 2)));
        setSelMin(parseInt(t.slice(3, 5)));
      }
      setStep("time");
    } else {
      onChange(s);
      setOpen(false);
    }
  }

  function confirm() {
    if (!selDate) return;
    const hh = String(selH).padStart(2,"00");
    const mm = String(selMin).padStart(2,"00");
    // Emite ISO com offset local — alinhado com localISOString de @/lib/date
    onChange(`${selDate}T${hh}:${mm}:00${localTzOffset()}`);
    setOpen(false);
    setStep("date");
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
  }

  const displayed = formatDisplay(value, withTime, defaultTime);

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={[
            "flex items-center h-9 w-full rounded-xl border bg-[hsl(var(--background))] px-3 gap-2 text-left transition-all",
            open
              ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]/15"
              : "border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40",
            className,
          ].filter(Boolean).join(" ")}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />

          {displayed ? (
            <span className="flex-1 text-sm text-[hsl(var(--foreground))] truncate">{displayed}</span>
          ) : (
            <span className="flex-1 text-sm text-[hsl(var(--muted-foreground))]/50 tracking-wide font-normal">
              {placeholder ?? (withTime ? "DD/MM/AAAA HH:MM" : "DD/MM/AAAA")}
            </span>
          )}

          {value && (
            <span role="button" onClick={clear}
              className="h-4 w-4 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors shrink-0">
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-3 overflow-hidden" style={{ width: 240 }} align="start">
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
        >
          <AnimatePresence mode="wait" initial={false}>

            {/* ── Calendário ───────────────────────────────────────────── */}
            {step === "date" && (
              <motion.div key="date"
                initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -16, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}>

                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={prev} disabled={!canGoPrev}
                    className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${canGoPrev ? "hover:bg-[hsl(var(--muted))]" : "opacity-25 cursor-not-allowed"}`}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-semibold">{MONTHS[viewM]} {viewY}</span>
                  <button type="button" onClick={next}
                    className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-7 mb-1">
                  {WEEK.map((w,i) => (
                    <div key={i} className="text-center text-[9px] font-bold text-[hsl(var(--muted-foreground))]/40 uppercase py-1">{w}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-px">
                  {days.map((d, i) => {
                    if (!d) return <div key={i} />;
                    const s   = toStr(d);
                    const sel = s === selDate;
                    const tod = s === todayStr;
                    const dis = isDisabled(d);
                    return (
                      <button key={i} type="button" onClick={() => pickDay(d)} disabled={dis}
                        className={[
                          "h-7 w-full rounded-lg text-[11px] font-medium transition-all",
                          dis ? "text-[hsl(var(--muted-foreground))]/25 cursor-not-allowed"
                          : sel ? "bg-[hsl(var(--primary))] text-white shadow-sm"
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

            {/* ── Horário ───────────────────────────────────────────────── */}
            {step === "time" && (
              <motion.div key="time"
                initial={{ x: 16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 16, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="space-y-4">

                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setStep("date")}
                    className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
                    <ArrowLeft className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                  </button>
                  <Clock className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                  <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
                    {(() => { const [y,m,d] = selDate.split("-"); return `${parseInt(d)} de ${MONTHS[parseInt(m)-1]}`; })()}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-2 py-1">
                  <TimeDrum
                    value={String(selH).padStart(2,"0")} label="hora"
                    onUp={() => setSelH(h => (h+1)%24)} onDown={() => setSelH(h => (h+23)%24)}
                  />
                  <span className="text-3xl font-bold text-[hsl(var(--muted-foreground))]/40 mb-4 select-none">:</span>
                  <TimeDrum
                    value={String(selMin).padStart(2,"0")} label="min"
                    onUp={() => setSelMin(m => (m+5)%60)} onDown={() => setSelMin(m => (m+55)%60)}
                  />
                </div>

                <Button type="button" size="sm" className="w-full h-8 text-xs" onClick={confirm}>
                  Confirmar {String(selH).padStart(2,"0")}:{String(selMin).padStart(2,"0")}
                </Button>
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}
