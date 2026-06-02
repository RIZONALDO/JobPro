import { useState, useMemo, useEffect, useRef } from "react";
import { Calendar, ChevronLeft, ChevronRight, X, Clock, ArrowLeft, ChevronUp, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Button } from "./button";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  withTime?: boolean;
  minDate?: string;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const WEEK   = ["D","S","T","Q","Q","S","S"];

function toStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseToLocal(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function display(v: string, withTime?: boolean) {
  if (!v) return "";
  const d = parseToLocal(v);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yyyy = d.getFullYear();
  if (withTime) return `${dd}/${mm}/${yyyy} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${dd}/${mm}/${yyyy}`;
}
function calDays(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const out: (Date | null)[] = Array(first).fill(null);
  for (let i = 1; i <= total; i++) out.push(new Date(year, month, i));
  return out;
}
function parseParts(value: string) {
  if (!value) return { date: "", time: "08:00" };
  const d = parseToLocal(value);
  if (!d) return { date: "", time: "08:00" };
  return {
    date: toStr(d),
    time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`,
  };
}
function labelDate(s: string) {
  if (!s) return "";
  const [y,m,d] = s.split("-");
  return `${parseInt(d)} de ${MONTHS[parseInt(m)-1]} de ${y}`;
}
function localTzOffset() {
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
}

// ── Máscara ──────────────────────────────────────────────────────────────────

function applyMask(raw: string, withTime?: boolean) {
  const digits = raw.replace(/\D/g, "").slice(0, withTime ? 12 : 8);
  let r = "";
  if (digits.length >= 1) r += digits[0];
  if (digits.length >= 2) r += digits[1];
  if (digits.length >= 2) r += "/";
  if (digits.length >= 3) r += digits[2];
  if (digits.length >= 4) r += digits[3];
  if (digits.length >= 4) r += "/";
  for (let i = 4; i < Math.min(8, digits.length); i++) r += digits[i];
  if (withTime && digits.length >= 8) {
    r += " ";
    if (digits.length >= 9)  r += digits[8];
    if (digits.length >= 10) r += digits[9];
    if (digits.length >= 10) r += ":";
    if (digits.length >= 11) r += digits[10];
    if (digits.length >= 12) r += digits[11];
  }
  return r;
}

function parseFromMask(masked: string, withTime?: boolean, minDate?: string): string | null {
  const digits = masked.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const dd = digits.slice(0,2), mm = digits.slice(2,4), yyyy = digits.slice(4,8);
  const day = parseInt(dd), month = parseInt(mm), year = parseInt(yyyy);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2020 || year > 2099) return null;
  const check = new Date(year, month-1, day);
  if (check.getDate() !== day || check.getMonth() !== month-1) return null;
  const dateStr = `${yyyy}-${mm}-${dd}`;
  if (minDate && dateStr < minDate) return null;
  if (withTime) {
    if (digits.length < 12) return null;
    const hh = digits.slice(8,10), min = digits.slice(10,12);
    if (parseInt(hh) > 23 || parseInt(min) > 59) return null;
    return `${dateStr}T${hh}:${min}:00${localTzOffset()}`;
  }
  return dateStr;
}

// ── TimeDrum ─────────────────────────────────────────────────────────────────

function TimeDrum({ value, label, onUp, onDown }: { value: string; label: string; onUp: () => void; onDown: () => void }) {
  const [dir, setDir] = useState(0);
  function up()   { setDir(1);  onUp();   }
  function down() { setDir(-1); onDown(); }
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" onClick={up} className="h-8 w-10 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
        <ChevronUp className="h-4 w-4" />
      </button>
      <div className="h-12 w-10 overflow-hidden flex items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value}
            initial={{ y: dir * -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: dir * 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 600, damping: 32 }}
            className="text-2xl font-bold text-[hsl(var(--foreground))] tabular-nums select-none">
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
      <button type="button" onClick={down} className="h-8 w-10 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
        <ChevronDown className="h-4 w-4" />
      </button>
      <span className="text-[9px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/50 mt-0.5">{label}</span>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function DatePicker({ value, onChange, placeholder, withTime, minDate, className }: Props) {
  const today    = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toStr(today), [today]);

  const [open,    setOpen]    = useState(false);
  const [step,    setStep]    = useState<"date"|"time">("date");
  const [viewY,   setViewY]   = useState(() => { const { date } = parseParts(value); return date ? parseInt(date.slice(0,4)) : today.getFullYear(); });
  const [viewM,   setViewM]   = useState(() => { const { date } = parseParts(value); return date ? parseInt(date.slice(5,7))-1 : today.getMonth(); });
  const [selDate, setSelDate] = useState(() => parseParts(value).date);
  const [selH,    setSelH]    = useState(() => parseInt(parseParts(value).time.slice(0,2)));
  const [selMin,  setSelMin]  = useState(() => parseInt(parseParts(value).time.slice(3,5)));
  const [inputVal, setInputVal] = useState(() => display(value, withTime));

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setInputVal(display(value, withTime)); }, [value, withTime]);

  const days = useMemo(() => calDays(viewY, viewM), [viewY, viewM]);
  const canGoPrev = useMemo(() => {
    if (!minDate) return true;
    return toStr(new Date(viewY, viewM, 0)) >= minDate;
  }, [viewY, viewM, minDate]);

  function isDisabled(d: Date) { return !!minDate && toStr(d) < minDate; }
  function prev() { if (!canGoPrev) return; viewM === 0 ? (setViewM(11), setViewY(y => y-1)) : setViewM(m => m-1); }
  function next() { viewM === 11 ? (setViewM(0), setViewY(y => y+1)) : setViewM(m => m+1); }

  function openPopover() {
    const { date, time } = parseParts(value);
    setSelDate(date);
    setSelH(parseInt(time.slice(0,2)));
    setSelMin(parseInt(time.slice(3,5)));
    setStep("date");
    if (date) { setViewY(parseInt(date.slice(0,4))); setViewM(parseInt(date.slice(5,7))-1); }
    setOpen(true);
  }
  function handleOpenChange(v: boolean) { if (!v) setStep("date"); setOpen(v); }

  function pickDay(d: Date) {
    if (isDisabled(d)) return;
    setSelDate(toStr(d));
    if (withTime) { setStep("time"); }
    else { const v = toStr(d); onChange(v); setInputVal(display(v, false)); setOpen(false); }
  }

  function confirm() {
    if (!selDate) return;
    const hh = String(selH).padStart(2,"0"), mm = String(selMin).padStart(2,"0");
    const v = withTime ? `${selDate}T${hh}:${mm}:00${localTzOffset()}` : selDate;
    onChange(v);
    setInputVal(display(v, withTime));
    setOpen(false);
    setStep("date");
  }

  // Edição direta via máscara (só quando já tem valor)
  function handleTyping(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = applyMask(e.target.value, withTime);
    setInputVal(masked);
    const digits = masked.replace(/\D/g, "");
    const needed = withTime ? 12 : 8;
    if (digits.length === needed) {
      const parsed = parseFromMask(masked, withTime, minDate);
      if (parsed) { onChange(parsed); }
    } else {
      onChange(""); // limpa enquanto edita parcialmente
    }
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(""); setInputVal(""); setSelDate(""); setSelH(8); setSelMin(0);
  }

  // Estilos compartilhados do campo
  const fieldCls = [
    "flex items-center h-9 w-full rounded-xl border bg-[hsl(var(--background))] px-3 gap-2 transition-all",
    open ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]/15"
         : "border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40",
    className,
  ].filter(Boolean).join(" ");

  // Calendário e hora (shared)
  const popoverBody = (
    <PopoverContent className="p-3 overflow-hidden" style={{ width: 240 }} align="start">
      <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}>
        <AnimatePresence mode="wait" initial={false}>
          {step === "date" && (
            <motion.div key="date" initial={{ x: -18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -18, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={prev} disabled={!canGoPrev}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${canGoPrev ? "hover:bg-[hsl(var(--muted))]" : "opacity-25 cursor-not-allowed"}`}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-semibold">{MONTHS[viewM]} {viewY}</span>
                <button type="button" onClick={next} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {WEEK.map((w,i) => <div key={i} className="text-center text-[9px] font-bold text-[hsl(var(--muted-foreground))]/40 uppercase py-1">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {days.map((d,i) => {
                  if (!d) return <div key={i} />;
                  const s = toStr(d); const sel = s === selDate; const tod = s === todayStr; const dis = isDisabled(d);
                  return (
                    <button key={i} type="button" onClick={() => pickDay(d)} disabled={dis}
                      className={["h-7 w-full rounded-lg text-[11px] font-medium transition-all",
                        dis ? "text-[hsl(var(--muted-foreground))]/25 cursor-not-allowed"
                        : sel ? "bg-[hsl(var(--primary))] text-white shadow-sm"
                        : tod ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-bold"
                               : "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"].join(" ")}>
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
          {step === "time" && (
            <motion.div key="time" initial={{ x: 18, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 18, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }} className="space-y-4">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setStep("date")} className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors shrink-0">
                  <ArrowLeft className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                </button>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                  <span className="text-xs font-semibold">{labelDate(selDate)}</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 py-1">
                <TimeDrum value={String(selH).padStart(2,"0")} label="hora" onUp={() => setSelH(h => (h+1)%24)} onDown={() => setSelH(h => (h+23)%24)} />
                <span className="text-3xl font-bold text-[hsl(var(--muted-foreground))]/40 mb-4 select-none">:</span>
                <TimeDrum value={String(selMin).padStart(2,"0")} label="min" onUp={() => setSelMin(m => (m+5)%60)} onDown={() => setSelMin(m => (m+55)%60)} />
              </div>
              <Button type="button" size="sm" className="w-full h-8 text-xs" onClick={confirm}>
                Confirmar {String(selH).padStart(2,"0")}:{String(selMin).padStart(2,"0")}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </PopoverContent>
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>

      {!value ? (
        /* ── Vazio: campo inteiro abre o popover ── */
        <PopoverTrigger asChild>
          <button type="button" onClick={openPopover} className={fieldCls}>
            <Calendar className="h-3.5 w-3.5 text-[hsl(var(--primary))] shrink-0" />
            <span className="flex-1 text-sm text-[hsl(var(--muted-foreground))]/50">
              {placeholder ?? (withTime ? "__/__/____ __:__" : "__/__/____")}
            </span>
          </button>
        </PopoverTrigger>
      ) : (
        /* ── Preenchido: ícone abre popover, texto editável ── */
        <div className={fieldCls}>
          <PopoverTrigger asChild>
            <button type="button" onClick={openPopover}
              className="shrink-0 flex items-center justify-center h-5 w-5 hover:opacity-70 transition-opacity">
              <Calendar className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
            </button>
          </PopoverTrigger>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={inputVal}
            onChange={handleTyping}
            className="flex-1 min-w-0 text-sm bg-transparent outline-none"
          />
          <button type="button" onClick={clear}
            className="h-4 w-4 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {popoverBody}
    </Popover>
  );
}
