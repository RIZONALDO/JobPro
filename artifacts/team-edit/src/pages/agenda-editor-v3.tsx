import { useState, useEffect, useRef, useCallback } from "react";
import { animate } from "framer-motion";
import { useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";
import { todayStr, toLocalDateStr, parseDate } from "@/lib/date";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import { AgendaDragModal } from "@/components/AgendaDragModal";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ScheduleSlot {
  taskId:      number;
  taskCode:    string;
  taskTitle:   string;
  client:      string | null;
  startTime:   string | null;
  endTime:     string | null;
  hours:       number | null;
  status:      string;
  description: string | null;
  priority:    string | null;
  coordinator: { id: number; name: string; avatarUrl: string | null } | null;
}
interface ScheduleDay { date: string; slots: ScheduleSlot[]; }
interface EditorInfo   { id: number; name: string; login: string; avatarUrl: string | null; role: string; }

interface ResizeDrag {
  slotIdx: number;
  side:    "left" | "right";
  fixed:   number;
  current: number;
}

interface BlockDragState {
  slot:        ScheduleSlot;
  fromDate:    string;
  durationMin: number;
  offsetMin:   number;
  curDate:     string;
  curStartMin: number;
  fits:        boolean;
  clickX:      number;
  clickY:      number;
}

interface SlotPopoverState {
  slot: ScheduleSlot;
  x:    number;
  y:    number;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const DOW_PT    = ["dom","seg","ter","qua","qui","sex","sáb"];
const DAY_START = 8  * 60;
const DAY_END_W = 18 * 60;
const DAY_END_S = 13 * 60;
const LUNCH_S   = 12 * 60;
const LUNCH_E   = 14 * 60;
const SNAP_MIN  = 30;

// ── Helpers ───────────────────────────────────────────────────────────────────

function snapToGrid(min: number, dayEnd: number): number {
  return Math.max(DAY_START, Math.min(dayEnd, Math.round(min / SNAP_MIN) * SNAP_MIN));
}
function xToMin(clientX: number, rect: DOMRect, dayEnd: number): number {
  const total = dayEnd - DAY_START;
  const x     = Math.max(0, Math.min(clientX - rect.left, rect.width));
  return snapToGrid(DAY_START + (x / rect.width) * total, dayEnd);
}
function xToMinHover(clientX: number, rect: DOMRect, dayEnd: number): number {
  const total = dayEnd - DAY_START;
  const x     = Math.max(0, Math.min(clientX - rect.left, rect.width));
  return Math.max(DAY_START, Math.min(dayEnd - SNAP_MIN, Math.floor((DAY_START + (x / rect.width) * total) / SNAP_MIN) * SNAP_MIN));
}
function effortFromRange(s: number, e: number, dow: number): number {
  if (e <= s) return 0;
  if (dow === 6) return (e - s) / 60;
  const ol = Math.max(0, Math.min(e, LUNCH_E) - Math.max(s, LUNCH_S));
  return Math.max(0, (e - s - ol) / 60);
}
function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function toMin(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function pct(min: number, total: number) { return Math.max(0, Math.min(100, (min / total) * 100)); }
function fmtH(h: number) {
  const t = Math.round(h * 60), hr = Math.floor(t / 60), mn = t % 60;
  if (hr === 0) return `${mn}min`; if (mn === 0) return `${hr}h`; return `${hr}h${mn}`;
}
function buildDates(from: string, n = 14) {
  const out: string[] = [], d = parseDate(from);
  for (let i = 0; i < n; i++) { out.push(toLocalDateStr(d)); d.setDate(d.getDate() + 1); }
  return out;
}
function dayEndFor(dow: number, isHoliday: boolean): number {
  return (dow === 6 && !isHoliday) ? DAY_END_S : DAY_END_W;
}

// ── Avatares ──────────────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl, size = 32 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="rounded-full object-cover w-full h-full" />;
  const bg = ["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"][name.charCodeAt(0) % 8];
  return (
    <div className="rounded-full flex items-center justify-center text-white font-black w-full h-full"
      style={{ background: bg, fontSize: size * 0.36 }}>{initials}</div>
  );
}
function CoordAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name} className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />;
  const bg = ["#6366f1","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#3b82f6","#22c55e","#ef4444"][name.charCodeAt(0) % 8];
  return (
    <div className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-white"
      style={{ background: bg, fontSize: 6, fontWeight: 900 }}>{initials}</div>
  );
}

// ── DayBar ────────────────────────────────────────────────────────────────────

interface DayBarProps {
  slots:             ScheduleSlot[];
  dow:               number;
  isHoliday:         boolean;
  isDraggable?:      boolean;
  onDragSelect?:     (st: string, et: string, eh: number) => void;
  onSlotResize?:     (slot: ScheduleSlot, ns: string, ne: string, nh: number) => void;
  onBlockDragStart?: (slot: ScheduleSlot, offsetMin: number, slotStartMin: number, slotEndMin: number, clientX: number, clientY: number) => void;
  onSlotClick?:      (slot: ScheduleSlot, clientX: number, clientY: number) => void;
  onBarRef?:         (el: HTMLDivElement | null) => void;
  blockDropPreview?: { startMin: number; endMin: number; fits: boolean; taskId: number } | null;
}

function DayBar({ slots, dow, isHoliday, isDraggable, onDragSelect, onSlotResize,
                  onBlockDragStart, onSlotClick, onBarRef, blockDropPreview }: DayBarProps) {
  const barRef                      = useRef<HTMLDivElement>(null);
  const [drag, setDrag]             = useState<{ anchor: number; cur: number } | null>(null);
  const [hoverMin, setHoverMin]     = useState<number | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);

  const isSun    = dow === 0 || isHoliday;
  const isSat    = dow === 6 && !isHoliday;
  const dayEnd   = dayEndFor(dow, isHoliday);
  const total    = dayEnd - DAY_START;
  const hasLunch = !isSat && !isSun;
  const ticks    = Array.from({ length: total / 60 + 1 }, (_, i) => DAY_START / 60 + i);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggable || !barRef.current) return;
    e.preventDefault();
    const min = xToMin(e.clientX, barRef.current.getBoundingClientRect(), dayEnd);
    barRef.current.setPointerCapture(e.pointerId);
    setDrag({ anchor: min, cur: min });
  }, [isDraggable, dayEnd]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    const min = xToMin(e.clientX, barRef.current.getBoundingClientRect(), dayEnd);
    if (resizeDrag) {
      setResizeDrag(prev => prev ? { ...prev, current: min } : null);
    } else if (drag) {
      setDrag(prev => prev ? { ...prev, cur: min } : null);
    } else if (isDraggable) {
      setHoverMin(xToMinHover(e.clientX, barRef.current.getBoundingClientRect(), dayEnd));
    }
  }, [drag, resizeDrag, dayEnd, isDraggable]);

  // Calcula os limites reais do resize considerando slots vizinhos
  const getResizeClamped = useCallback((rd: ResizeDrag): { newStart: number; newEnd: number } => {
    const others = slots.filter((_, j) => j !== rd.slotIdx);
    if (rd.side === "left") {
      // handle esquerdo: fixed = endTime do slot; current = startTime sendo arrastado
      // limite: não pode cruzar o fim do slot mais próximo à esquerda
      const leftBarrier = others
        .filter(s => s.endTime && toMin(s.endTime) <= rd.fixed)
        .reduce((max, s) => Math.max(max, toMin(s.endTime!)), DAY_START);
      const clamped = Math.max(leftBarrier, Math.min(rd.current, rd.fixed - SNAP_MIN));
      return { newStart: clamped, newEnd: rd.fixed };
    } else {
      // handle direito: fixed = startTime do slot; current = endTime sendo arrastado
      // limite: não pode cruzar o início do slot mais próximo à direita
      const rightBarrier = others
        .filter(s => s.startTime && toMin(s.startTime) >= rd.fixed)
        .reduce((min, s) => Math.min(min, toMin(s.startTime!)), dayEnd);
      const clamped = Math.min(rightBarrier, Math.max(rd.current, rd.fixed + SNAP_MIN));
      return { newStart: rd.fixed, newEnd: clamped };
    }
  }, [slots, dayEnd]);

  const handlePointerUp = useCallback(() => {
    if (resizeDrag) {
      const slot = slots[resizeDrag.slotIdx];
      if (slot && slot.startTime && slot.endTime) {
        const { newStart, newEnd } = getResizeClamped(resizeDrag);
        const originalStart = toMin(slot.startTime);
        const originalEnd   = toMin(slot.endTime);
        const changed = newStart !== originalStart || newEnd !== originalEnd;
        if (changed) {
          const newHours = effortFromRange(newStart, newEnd, dow);
          if (newHours > 0) onSlotResize?.(slot, minToTime(newStart), minToTime(newEnd), newHours);
        }
      }
      setResizeDrag(null);
      return;
    }
    if (!drag) return;
    const s = Math.min(drag.anchor, drag.cur), e = Math.max(drag.anchor, drag.cur);
    if (e - s >= SNAP_MIN) {
      const effort = effortFromRange(s, e, dow);
      if (effort > 0) onDragSelect?.(minToTime(s), minToTime(e), effort);
    }
    setDrag(null);
  }, [drag, resizeDrag, dow, slots, onDragSelect, onSlotResize]);

  if (isSun) return (
    <div className="h-10 rounded-md flex items-center justify-center gap-2"
      style={{
        background: isHoliday ? "#fef3c720" : "hsl(var(--muted)/0.2)",
        border: isHoliday ? "1px solid #fde68a50" : "1px dashed hsl(var(--border)/0.4)",
      }}>
      <span className="text-[9px] font-black uppercase tracking-widest"
        style={{ color: isHoliday ? "#d97706" : "hsl(var(--muted-foreground)/0.25)" }}>
        {isHoliday ? "feriado" : "fechado"}
      </span>
    </div>
  );

  // Ghost criação de nova tarefa
  const ghost = drag ? (() => {
    const s = Math.min(drag.anchor, drag.cur), e = Math.max(drag.anchor, drag.cur);
    const left = pct(s - DAY_START, total), width = pct(e - s, total);
    const effort = effortFromRange(s, e, dow);
    return (
      <div className="absolute top-0 bottom-0 pointer-events-none select-none"
        style={{ left: `${left}%`, width: `${width}%`,
                 background: "hsl(var(--primary)/0.18)", border: "1.5px solid hsl(var(--primary)/0.55)", zIndex: 10 }}>
        {width > 5 && (
          <div className="absolute inset-0 flex items-center justify-center gap-0.5 px-1 overflow-hidden">
            <span className="text-[9px] font-black shrink-0" style={{ color: "hsl(var(--primary))" }}>{minToTime(s)}</span>
            {width > 14 && <>
              <span className="text-[9px] shrink-0" style={{ color: "hsl(var(--primary)/0.4)" }}>–</span>
              <span className="text-[9px] font-black shrink-0" style={{ color: "hsl(var(--primary))" }}>{minToTime(e)}</span>
              {effort > 0 && <span className="text-[9px] shrink-0 ml-1" style={{ color: "hsl(var(--primary)/0.65)" }}>· {fmtH(effort)}</span>}
            </>}
          </div>
        )}
      </div>
    );
  })() : null;

  return (
    <div>
      <div
        ref={el => { (barRef as React.MutableRefObject<HTMLDivElement | null>).current = el; onBarRef?.(el); }}
        className="relative h-20 max-h-20 rounded-md overflow-hidden select-none"
        style={{
          background: "hsl(var(--muted)/0.4)",
          border:     "1px solid hsl(var(--border)/0.6)",
          cursor:     isDraggable ? "crosshair" : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { setDrag(null); setHoverMin(null); setResizeDrag(null); }}
        onPointerLeave={() => { if (!drag && !resizeDrag) setHoverMin(null); }}
      >
        {/* Lunch */}
        {hasLunch && (
          <div className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${pct(LUNCH_S - DAY_START, total)}%`, width: `${pct(LUNCH_E - LUNCH_S, total)}%`,
              backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 10px, hsl(var(--border)/0.4) 10px, hsl(var(--border)/0.4) 11px)",
              backgroundColor: "hsl(var(--muted)/0.2)",
              borderLeft: "1px solid hsl(var(--border))", borderRight: "1px solid hsl(var(--border))", zIndex: 3,
            }} />
        )}

        {/* Slots */}
        {slots.map((slot, i) => {
          if (!slot.startTime || !slot.endTime) return null;
          const isResizing    = resizeDrag?.slotIdx === i;
          const isDraggingThis = blockDropPreview?.taskId === slot.taskId;

          const { newStart: displayStart, newEnd: displayEnd } = isResizing
            ? getResizeClamped(resizeDrag)
            : { newStart: toMin(slot.startTime), newEnd: toMin(slot.endTime) };

          const left  = pct(displayStart - DAY_START, total);
          const width = pct(displayEnd - displayStart, total);

          return (
            <div key={i}
              className="group absolute top-2 bottom-2 flex flex-col justify-center px-3 overflow-hidden gap-0.5"
              style={{
                left:       `calc(${left}% + 4px)`,
                width:      `calc(${width}% - 8px)`,
                background: isResizing ? "hsl(var(--primary)/0.35)" : "hsl(var(--primary)/0.25)",
                border:     isResizing ? "1.5px solid hsl(var(--primary)/0.8)" : "1px solid hsl(var(--primary)/0.4)",
                cursor:     "default",
                opacity:    isDraggingThis ? 0.35 : 1,
                zIndex:     2,
                transition: isResizing ? "none" : "opacity 0.15s",
              }}
              onPointerDown={ev => {
                ev.stopPropagation();
                if (!slot.startTime || !slot.endTime || !barRef.current) return;
                const rect     = barRef.current.getBoundingClientRect();
                const tot      = dayEnd - DAY_START;
                const x        = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
                const clickMin = DAY_START + (x / rect.width) * tot;
                const startMin = toMin(slot.startTime);
                const offsetMin = clickMin - startMin;
                onBlockDragStart?.(slot, offsetMin, startMin, toMin(slot.endTime), ev.clientX, ev.clientY);
              }}
              onMouseEnter={ev => {
                if (isResizing) return;
                (ev.currentTarget as HTMLElement).style.background = "hsl(var(--primary)/0.45)";
                (ev.currentTarget as HTMLElement).style.borderColor = "hsl(var(--primary)/0.7)";
              }}
              onMouseLeave={ev => {
                if (isResizing) return;
                (ev.currentTarget as HTMLElement).style.background = "hsl(var(--primary)/0.25)";
                (ev.currentTarget as HTMLElement).style.borderColor = "hsl(var(--primary)/0.4)";
              }}>

              {/* Handle esquerdo — resize */}
              <div className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center
                              opacity-0"
                style={{ cursor: "ew-resize", zIndex: 4 }}
                onPointerDown={ev => {
                  ev.stopPropagation();
                  if (!slot.startTime || !slot.endTime) return;
                  barRef.current?.setPointerCapture(ev.pointerId);
                  setResizeDrag({ slotIdx: i, side: "left", fixed: toMin(slot.endTime), current: toMin(slot.startTime) });
                }}>
                <div className="w-px h-5 rounded-full pointer-events-none"
                  style={{ background: "hsl(var(--primary))" }} />
              </div>

              {/* Handle direito — resize */}
              <div className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center
                              opacity-0"
                style={{ cursor: "ew-resize", zIndex: 4 }}
                onPointerDown={ev => {
                  ev.stopPropagation();
                  if (!slot.startTime || !slot.endTime) return;
                  barRef.current?.setPointerCapture(ev.pointerId);
                  setResizeDrag({ slotIdx: i, side: "right", fixed: toMin(slot.startTime), current: toMin(slot.endTime) });
                }}>
                <div className="w-px h-5 rounded-full pointer-events-none"
                  style={{ background: "hsl(var(--primary))" }} />
              </div>

              {width > 8 && (
                isResizing ? (
                  <div className="flex items-center justify-center gap-1 select-none pointer-events-none">
                    <span className="text-[10px] font-black" style={{ color: "hsl(var(--primary))" }}>
                      {minToTime(displayStart)}
                    </span>
                    <span className="text-[10px]" style={{ color: "hsl(var(--primary)/0.5)" }}>–</span>
                    <span className="text-[10px] font-black" style={{ color: "hsl(var(--primary))" }}>
                      {minToTime(displayEnd)}
                    </span>
                    {width > 14 && (
                      <span className="text-[9px] ml-1" style={{ color: "hsl(var(--primary)/0.7)" }}>
                        · {fmtH(effortFromRange(displayStart, displayEnd, dow))}
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-black font-mono shrink-0" style={{ color: "hsl(var(--primary)/0.7)" }}>{slot.taskCode}</span>
                      <span
                        className="text-[11px] font-black truncate cursor-pointer hover:underline"
                        style={{ color: "hsl(var(--foreground))" }}
                        onClick={ev => { ev.stopPropagation(); onSlotClick?.(slot, ev.clientX, ev.clientY); }}>
                        {slot.taskTitle}
                      </span>
                    </div>
                    {slot.coordinator && (
                      <div className="flex items-center gap-1 min-w-0">
                        <CoordAvatar name={slot.coordinator.name} avatarUrl={slot.coordinator.avatarUrl} />
                        <span className="text-[9px] font-medium truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {slot.coordinator.name.split(" ")[0]}
                        </span>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          );
        })}

        {/* Preview de destino do block drag */}
        {blockDropPreview && (
          <div className="absolute top-2 bottom-2 rounded-none pointer-events-none"
            style={{
              left:       `calc(${pct(blockDropPreview.startMin - DAY_START, total)}% + 4px)`,
              width:      `calc(${pct(blockDropPreview.endMin - blockDropPreview.startMin, total)}% - 8px)`,
              background: blockDropPreview.fits ? "hsl(var(--primary)/0.22)" : "#ef444420",
              border:     `1.5px dashed ${blockDropPreview.fits ? "hsl(var(--primary)/0.7)" : "#ef4444"}`,
              zIndex:     8,
            }}
          />
        )}

        {/* Hover cell — só em células sem tarefa */}
        {isDraggable && !drag && !resizeDrag && hoverMin !== null && (() => {
          const cellEnd  = hoverMin + SNAP_MIN;
          const occupied = slots.some(s => {
            if (!s.startTime || !s.endTime) return false;
            return toMin(s.startTime) < cellEnd && toMin(s.endTime) > hoverMin;
          });
          if (occupied) return null;
          return (
            <div className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: `${pct(hoverMin - DAY_START, total)}%`, width: `${pct(SNAP_MIN, total)}%`,
                       background: "hsl(var(--primary)/0.12)", zIndex: 1 }} />
          );
        })()}

        {ghost}
      </div>

      {/* Ticks */}
      <div className="relative h-4 mt-0.5 mx-0.5">
        {ticks.map(h => (
          <span key={h} className="absolute text-[8px] font-mono -translate-x-1/2 select-none"
            style={{ left: `${pct((h * 60) - DAY_START, total)}%`, color: "hsl(var(--muted-foreground)/0.3)" }}>
            {h % 2 === 0 ? `${h}h` : "·"}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function AgendaEditorV3() {
  const params   = useParams<{ id: string }>();
  const editorId = parseInt(params.id ?? "", 10);
  const { user } = useAuth();

  const [editor,     setEditor]     = useState<EditorInfo | null>(null);
  const [schedule,   setSchedule]   = useState<ScheduleDay[]>([]);
  const [holidays,   setHolidays]   = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const todayRef = useRef<HTMLDivElement>(null);

  // Criar nova tarefa via drag na barra
  const [dragModal, setDragModal] = useState<{
    date: string; startTime: string; endTime: string; effortHours: number;
  } | null>(null);

  // Block drag — mover slot existente
  const [blockDrag,    setBlockDrag]    = useState<BlockDragState | null>(null);
  const [dragPos,      setDragPos]      = useState({ x: 0, y: 0 });
  const [slotPopover,  setSlotPopover]  = useState<SlotPopoverState | null>(null);
  const blockDragRef     = useRef<BlockDragState | null>(null);
  const blockDragMoved   = useRef(false);
  const barRefs          = useRef<Map<string, HTMLDivElement>>(new Map());
  const holidaysRef      = useRef<Set<string>>(new Set());
  const scheduleRef      = useRef<Map<string, ScheduleSlot[]>>(new Map());

  const isCoordinator = user?.role === "coordinator" || user?.role === "admin";
  const today         = todayStr();
  const fromStr       = toLocalDateStr(new Date(parseDate(today).getTime() - 7  * 86_400_000));
  const toStr         = toLocalDateStr(new Date(parseDate(today).getTime() + 29 * 86_400_000));

  // Mantém refs sincronizados para uso em closures dos event listeners
  useEffect(() => { holidaysRef.current = holidays; }, [holidays]);
  useEffect(() => { scheduleRef.current = new Map(schedule.map(d => [d.date, d.slots])); }, [schedule]);

  usePageTitle(editor ? editor.name.split(" ")[0] : "Agenda");

  useEffect(() => {
    if (isNaN(editorId)) return;
    setLoading(true);
    Promise.all([
      apiFetch<EditorInfo[]>("/api/users").then(u => u.find(x => x.id === editorId) ?? null),
      apiFetch<ScheduleDay[]>(`/api/escala/editor/${editorId}/schedule?from=${fromStr}&to=${toStr}`),
      apiFetch<{ holidays: string[] }>("/api/calendar-config").then(d => new Set(d.holidays ?? [])),
    ]).then(([ed, sched, hols]) => { setEditor(ed); setSchedule(sched); setHolidays(hols); })
      .catch(() => {}).finally(() => {
        setLoading(false);
        setTimeout(() => {
          const el = todayRef.current;
          if (!el) return;
          let container: HTMLElement | null = el.parentElement;
          while (container) {
            const { overflowY } = getComputedStyle(container);
            if (overflowY === "auto" || overflowY === "scroll") break;
            container = container.parentElement;
          }
          if (!container) return;
          const target = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
          animate(container.scrollTop, target, {
            duration: 0.7, ease: [0.25, 0.1, 0.25, 1],
            onUpdate: v => { container!.scrollTop = v; },
          });
        }, 100);
      });
  }, [editorId, refreshKey]);

  // Drag criar tarefa
  const handleDragSelect = useCallback((date: string, startTime: string, endTime: string, effortHours: number) => {
    setDragModal({ date, startTime, endTime, effortHours });
  }, []);

  // Resize slot (handles de borda)
  const handleSlotResize = useCallback(async (
    slot: ScheduleSlot, date: string, newStart: string, newEnd: string, newHours: number,
  ) => {
    setSchedule(prev => prev.map(day =>
      day.date !== date ? day : {
        ...day,
        slots: day.slots.map(s =>
          s.taskId === slot.taskId ? { ...s, startTime: newStart, endTime: newEnd, hours: newHours } : s
        ),
      }
    ));
    try {
      await apiPost(`/api/escala/tasks/${slot.taskId}/resize-slot`, {
        workDate: date, startTime: newStart, endTime: newEnd, allocatedHours: newHours,
      });
      toast.success("Horário atualizado com sucesso");
    } catch {
      toast.error("Erro ao redimensionar slot");
      setRefreshKey(k => k + 1);
    }
  }, []);

  // Block drag — iniciar
  const handleBlockDragStart = useCallback((
    slot: ScheduleSlot, date: string, offsetMin: number, slotStartMin: number, slotEndMin: number,
    clientX: number, clientY: number,
  ) => {
    if (!isCoordinator) return;
    blockDragMoved.current = false;
    setDragPos({ x: clientX, y: clientY });
    const state: BlockDragState = {
      slot, fromDate: date,
      durationMin: slotEndMin - slotStartMin,
      offsetMin,
      curDate: date, curStartMin: slotStartMin, fits: true,
      clickX: clientX, clickY: clientY,
    };
    blockDragRef.current = state;
    setBlockDrag(state);
  }, [isCoordinator]);

  // Window listeners para block drag
  useEffect(() => {
    if (!blockDrag) return;

    const onMove = (e: PointerEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      const cur = blockDragRef.current;
      if (!cur) return;

      // Encontra a barra sob o cursor
      let targetDate: string | null = null;
      let targetRect: DOMRect | null = null;
      for (const [date, barEl] of barRefs.current) {
        const rect = barEl.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          targetDate = date; targetRect = rect; break;
        }
      }
      if (!targetDate || !targetRect) return;

      const d        = parseDate(targetDate);
      const dow      = d.getDay();
      const hols     = holidaysRef.current;
      if (dow === 0 || hols.has(targetDate) || targetDate < today) return;

      const dEnd     = dayEndFor(dow, hols.has(targetDate));
      const total    = dEnd - DAY_START;
      const x        = Math.max(0, Math.min(e.clientX - targetRect.left, targetRect.width));
      const cursorMin = DAY_START + (x / targetRect.width) * total;

      // Posição snapped levando em conta onde o usuário clicou dentro do bloco
      let startMin = Math.round((cursorMin - cur.offsetMin) / SNAP_MIN) * SNAP_MIN;
      startMin = Math.max(DAY_START, Math.min(dEnd - cur.durationMin, startMin));
      const endMin = startMin + cur.durationMin;

      // Verifica se encaixa (check local, sem API)
      const daySlots = scheduleRef.current.get(targetDate) ?? [];
      const fits = !daySlots.some(s => {
        if (s.taskId === cur.slot.taskId) return false;
        if (!s.startTime || !s.endTime) return false;
        return toMin(s.startTime) < endMin && toMin(s.endTime) > startMin;
      });

      if (!blockDragMoved.current) {
        blockDragMoved.current = true;
        document.body.style.cursor = "grabbing";
      }
      const updated = { ...cur, curDate: targetDate, curStartMin: startMin, fits };
      blockDragRef.current = updated;
      setBlockDrag(updated);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      const cur = blockDragRef.current;
      if (cur && cur.fits) {
        const originalStart = toMin(cur.slot.startTime ?? "08:00");
        const moved = cur.curDate !== cur.fromDate || cur.curStartMin !== originalStart;
        if (moved) {
          const newStart = minToTime(cur.curStartMin);
          const newEnd   = minToTime(cur.curStartMin + cur.durationMin);
          const dow      = parseDate(cur.curDate).getDay();
          const newHours = effortFromRange(cur.curStartMin, cur.curStartMin + cur.durationMin, dow);
          if (newHours > 0) handleBlockMove(cur.slot, cur.fromDate, cur.curDate, newStart, newEnd, newHours);
        }
      }
      setBlockDrag(null);
      blockDragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [blockDrag]);

  // Popover de detalhes — abre ao clicar no título
  const handleSlotClick = useCallback((slot: ScheduleSlot, clientX: number, clientY: number) => {
    const pw = 256, ph = 240, margin = 8;
    const x = Math.max(margin, Math.min(clientX - pw / 2, window.innerWidth - pw - margin));
    const y = clientY - ph - 12 > margin ? clientY - ph - 12 : clientY + 12;
    setSlotPopover({ slot, x, y });
  }, []);

  // Block drag — confirmar movimento
  const handleBlockMove = useCallback(async (
    slot: ScheduleSlot, fromDate: string, toDate: string,
    newStart: string, newEnd: string, newHours: number,
  ) => {
    // Optimistic update
    setSchedule(prev => {
      const without = prev.map(day =>
        day.date !== fromDate ? day : {
          ...day,
          slots: day.slots.filter(s => !(s.taskId === slot.taskId && s.startTime === slot.startTime)),
        }
      );
      const moved = { ...slot, startTime: newStart, endTime: newEnd, hours: newHours };
      const toDay  = without.find(d => d.date === toDate);
      if (toDay) {
        return without.map(day =>
          day.date !== toDate ? day : { ...day, slots: [...day.slots, moved] }
        );
      }
      return [...without, { date: toDate, slots: [moved] }];
    });

    try {
      await apiPost(`/api/escala/tasks/${slot.taskId}/resize-slot`, {
        workDate:       fromDate,
        newWorkDate:    toDate !== fromDate ? toDate : undefined,
        startTime:      newStart,
        endTime:        newEnd,
        allocatedHours: newHours,
      });
      toast.success(toDate !== fromDate ? "Tarefa movida para outro dia" : "Tarefa reposicionada");
    } catch {
      toast.error("Erro ao mover tarefa");
      setRefreshKey(k => k + 1);
    }
  }, []);

  const scheduleMap = new Map(schedule.map(d => [d.date, d.slots]));
  const allDates    = buildDates(fromStr, 37);

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>

      {/* Top bar */}
      <div className="sticky top-0 z-20 px-5 py-3.5 flex items-center gap-3"
        style={{ background: "hsl(var(--background)/0.88)", backdropFilter: "blur(16px)", borderBottom: "1px solid hsl(var(--border))" }}>
        <button onClick={() => history.back()}
          className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest transition-opacity hover:opacity-50"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          <ArrowLeft className="h-3.5 w-3.5" /> agenda
        </button>
        {editor && (
          <>
            <div className="w-px h-4 mx-1" style={{ background: "hsl(var(--border))" }} />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0">
                <Avatar name={editor.name} avatarUrl={editor.avatarUrl} size={24} />
              </div>
              <span className="text-sm font-black">{editor.name.split(" ")[0]}</span>
            </div>
            {isCoordinator && (
              <span className="ml-auto text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
                arrastar para alocar
              </span>
            )}
          </>
        )}
      </div>

      {/* Days */}
      <div className="px-5 py-6 max-w-2xl mx-auto space-y-7">
        {loading
          ? [...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-20 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
                <div className="h-11 rounded-2xl animate-pulse" style={{ background: "hsl(var(--muted))" }} />
              </div>
            ))
          : allDates.map(date => {
              const d         = parseDate(date);
              const dow       = d.getDay();
              const isToday   = date === today;
              const isHoliday = holidays.has(date);
              const isPast    = date < today;
              const slots     = scheduleMap.get(date) ?? [];
              const day       = String(d.getDate()).padStart(2, "0");
              const mon       = String(d.getMonth() + 1).padStart(2, "0");
              const draggable = isCoordinator && !isPast && !isHoliday && dow !== 0;

              // Preview do block drag neste dia
              const dropPreview = (blockDrag && blockDrag.curDate === date)
                ? {
                    startMin: blockDrag.curStartMin,
                    endMin:   blockDrag.curStartMin + blockDrag.durationMin,
                    fits:     blockDrag.fits,
                    taskId:   blockDrag.slot.taskId,
                  }
                : null;

              return (
                <div key={date} ref={isToday ? todayRef : undefined} className="group"
                  style={isPast ? { opacity: 0.2 } : undefined}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full"
                      style={isToday
                        ? { background: "hsl(var(--primary))", color: "white" }
                        : isHoliday
                          ? { background: "#fef3c7", color: "#d97706" }
                          : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      {isToday ? "hoje" : DOW_PT[dow]}
                    </span>
                    <span className="text-sm font-black"
                      style={{ color: isToday ? "hsl(var(--primary))" : isHoliday ? "#d97706" : "hsl(var(--muted-foreground)/0.5)" }}>
                      {day}/{mon}
                    </span>
                    {isHoliday && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ background: "#fef3c7", color: "#d97706" }}>feriado</span>
                    )}
                  </div>
                  <DayBar
                    slots={slots} dow={dow} isHoliday={isHoliday}
                    isDraggable={draggable}
                    onDragSelect={(st, et, eh) => handleDragSelect(date, st, et, eh)}
                    onSlotResize={(slot, st, et, h) => handleSlotResize(slot, date, st, et, h)}
                    onBlockDragStart={(slot, off, sMin, eMin, cx, cy) => handleBlockDragStart(slot, date, off, sMin, eMin, cx, cy)}
                    onSlotClick={(slot, cx, cy) => handleSlotClick(slot, cx, cy)}
                    onBarRef={el => { if (el) barRefs.current.set(date, el); else barRefs.current.delete(date); }}
                    blockDropPreview={dropPreview}
                  />
                </div>
              );
            })
        }
      </div>

      {/* Ghost do block drag */}
      {blockDrag && (
        <div className="fixed pointer-events-none z-50 select-none"
          style={{ left: dragPos.x + 10, top: dragPos.y - 18 }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black shadow-xl"
            style={{
              background: blockDrag.fits ? "hsl(var(--primary))" : "#ef4444",
              color: "white", maxWidth: 200,
              transition: "background 0.1s",
            }}>
            <span className="font-mono opacity-75 shrink-0">{blockDrag.slot.taskCode}</span>
            <span className="truncate">{blockDrag.slot.taskTitle}</span>
            {!blockDrag.fits && (
              <span className="shrink-0 opacity-80 ml-1">bloqueado</span>
            )}
          </div>
        </div>
      )}

      {/* Popover de detalhes do slot */}
      {slotPopover && (() => {
        const s    = slotPopover.slot;
        const prio = s.priority;
        const prioLabel = prio === "high" ? "Alta" : prio === "medium" ? "Média" : prio === "low" ? "Baixa" : null;
        const prioColor = prio === "high" ? "#f87171" : prio === "medium" ? "#fbbf24" : "#4ade80";
        const prioBg    = prio === "high" ? "#f8717120" : prio === "medium" ? "#fbbf2420" : "#4ade8020";
        return (
          <>
            <div className="fixed inset-0 z-40" onPointerDown={() => setSlotPopover(null)} />
            <div className="fixed z-50 w-64 rounded-2xl overflow-hidden shadow-2xl"
              style={{
                left:       slotPopover.x,
                top:        slotPopover.y,
                background: "#111215",
                border:     "1px solid rgba(255,255,255,0.08)",
              }}>
              <div className="px-4 pt-4 pb-5 space-y-3.5">

                {/* Código + título */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest mb-1"
                    style={{ color: "rgba(255,255,255,0.3)" }}>tarefa</p>
                  <p className="text-sm font-black leading-snug" style={{ color: "white" }}>
                    {s.taskTitle}
                  </p>
                  <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {s.taskCode}
                  </p>
                </div>

                {/* Cliente */}
                {s.client && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-0.5"
                      style={{ color: "rgba(255,255,255,0.3)" }}>cliente</p>
                    <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.85)" }}>
                      {s.client}
                    </p>
                  </div>
                )}

                {/* Briefing */}
                {s.description && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-0.5"
                      style={{ color: "rgba(255,255,255,0.3)" }}>briefing</p>
                    <p className="text-xs leading-relaxed line-clamp-4"
                      style={{ color: "rgba(255,255,255,0.6)" }}>
                      {s.description}
                    </p>
                  </div>
                )}

                {/* Prioridade */}
                {prioLabel && (
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-black uppercase tracking-widest"
                      style={{ color: "rgba(255,255,255,0.3)" }}>prioridade</p>
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: prioBg, color: prioColor }}>
                      {prioLabel}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Modal criar tarefa por drag */}
      {dragModal && editor && (
        <AgendaDragModal
          open={!!dragModal}
          onClose={() => setDragModal(null)}
          onCreated={() => { setDragModal(null); setRefreshKey(k => k + 1); }}
          editorId={editorId}
          editorName={editor.name}
          editorAvatar={editor.avatarUrl}
          date={dragModal.date}
          startTime={dragModal.startTime}
          endTime={dragModal.endTime}
          effortHours={dragModal.effortHours}
        />
      )}
    </div>
  );
}
