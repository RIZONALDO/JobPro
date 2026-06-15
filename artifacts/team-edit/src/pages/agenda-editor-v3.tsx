import { useState, useEffect, useRef, useCallback } from "react";
import { animate } from "framer-motion";
import { useParams } from "wouter";
import { ArrowLeft, Trash2 } from "lucide-react";
import { apiFetch, apiPost, apiDelete } from "@/lib/api";
import { todayStr, toLocalDateStr, parseDate } from "@/lib/date";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import { AgendaDragModal } from "@/components/AgendaDragModal";
import { TaskFormModal } from "@/components/task-form-modal";
import { toast } from "sonner";
import {
  DndContext, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import type { DragStartEvent, DragMoveEvent, DragEndEvent } from "@dnd-kit/core";

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
  startDate:   string | null;
  dueDate:     string | null;
  coordinator: { id: number; name: string; avatarUrl: string | null; profileColor?: string | null } | null;
  slotIndex?:  number;
  totalSlots?: number;
}
interface ScheduleDay { date: string; slots: ScheduleSlot[]; }
interface EditorInfo   { id: number; name: string; login: string; avatarUrl: string | null; role: string; profileColor?: string | null; }

interface ResizeDrag {
  slotIdx: number;
  side:    "left" | "right";
  fixed:   number;
  current: number;
}

// Estado do drag ativo (block drag via @dnd-kit)
interface ActiveDrag {
  slot:        ScheduleSlot;
  fromDate:    string;
  durationMin: number;
  offsetMin:   number;
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

// ── SlotItem — useDraggable por slot ─────────────────────────────────────────

interface SlotItemProps {
  slot:             ScheduleSlot;
  i:                number;
  dow:              number;
  dayEnd:           number;
  total:            number;
  date:             string;
  isDraggable:      boolean;
  editorColor:      string | null;
  resizeDrag:       ResizeDrag | null;
  getResizeClamped: (rd: ResizeDrag) => { newStart: number; newEnd: number };
  onResizeStart:    (slotIdx: number, side: "left"|"right", fixed: number, current: number) => void;
  onSlotClick?:     (slot: ScheduleSlot) => void;
  onRemoveDay?:     (slot: ScheduleSlot, date: string) => void;
  blockDropPreview: { startMin: number; endMin: number; fits: boolean; taskId: number } | null | undefined;
  barRef:           React.RefObject<HTMLDivElement | null>;
  lastPointerDown:  React.MutableRefObject<{ clientX: number; clientY: number; date: string } | null>;
}

function SlotItem({
  slot, i, dow, dayEnd, total, date, isDraggable, editorColor, resizeDrag, getResizeClamped,
  onResizeStart, onSlotClick, onRemoveDay, blockDropPreview, barRef, lastPointerDown,
}: SlotItemProps) {
  const { user } = useAuth();
  // Coordenadores só podem mover/redimensionar as próprias tarefas
  const isOwner = user?.role === "admin"
    || !slot.coordinator?.id
    || slot.coordinator.id === user?.id;
  const canInteract = isDraggable && isOwner;
  // Cor do coordenador do slot (cada tarefa herda a cor de quem a criou)
  const coordColor = slot.coordinator?.profileColor ?? editorColor ?? null;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id:       `slot-${slot.taskId}-${date}`,
    data:     { slot, fromDate: date },
    disabled: !canInteract,
  });

  if (!slot.startTime || !slot.endTime) return null;

  const isResizing     = resizeDrag?.slotIdx === i;
  const isDraggingThis = isDragging || blockDropPreview?.taskId === slot.taskId;

  const { newStart: displayStart, newEnd: displayEnd } = isResizing
    ? getResizeClamped(resizeDrag!)
    : { newStart: toMin(slot.startTime), newEnd: toMin(slot.endTime) };

  const left  = pct(displayStart - DAY_START, total);
  const width = pct(displayEnd - displayStart, total);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className="group absolute top-2 bottom-2 flex flex-col justify-center px-3 gap-0.5"
      style={{
        left:        `calc(${left}% + 4px)`,
        width:       `calc(${width}% - 8px)`,
        background:  coordColor
          ? isResizing ? `${coordColor}55` : `${coordColor}33`
          : isResizing ? "hsl(var(--primary)/0.35)" : "hsl(var(--primary)/0.25)",
        border:      coordColor
          ? isResizing ? `1.5px solid ${coordColor}cc` : `1px solid ${coordColor}66`
          : isResizing ? "1.5px solid hsl(var(--primary)/0.8)" : "1px solid hsl(var(--primary)/0.4)",
        cursor:      isResizing ? "ew-resize" : "default",
        opacity:     isDraggingThis ? 0.35 : 1,
        zIndex:      2,
        transition:  isResizing ? "none" : "opacity 0.15s",
        touchAction: "none",
      }}
      onClick={() => onSlotClick?.(slot)}
      onPointerDown={ev => {
        ev.stopPropagation();
        if (!slot.startTime || !slot.endTime || !barRef.current) return;
        if (!canInteract) return; // tarefa de outro coordenador — só leitura
        const slotRect = ev.currentTarget.getBoundingClientRect();
        const relX     = ev.clientX - slotRect.left;
        const EDGE     = 12;
        if (relX <= EDGE) {
          barRef.current.setPointerCapture(ev.pointerId);
          onResizeStart(i, "left", toMin(slot.endTime), toMin(slot.startTime));
        } else if (relX >= slotRect.width - EDGE) {
          barRef.current.setPointerCapture(ev.pointerId);
          onResizeStart(i, "right", toMin(slot.startTime), toMin(slot.endTime));
        } else {
          // Block drag — @dnd-kit suprime o click subsequente se arrastar ≥ 8px
          lastPointerDown.current = { clientX: ev.clientX, clientY: ev.clientY, date };
          listeners?.onPointerDown?.(ev);
        }
      }}
      onMouseMove={ev => {
        if (isResizing || !canInteract) return;
        const r  = ev.currentTarget.getBoundingClientRect();
        const rx = ev.clientX - r.left;
        ev.currentTarget.style.cursor = (rx <= 12 || rx >= r.width - 12) ? "ew-resize" : "default";
      }}
      onMouseEnter={ev => {
        if (isResizing) return;
        (ev.currentTarget as HTMLElement).style.background = coordColor ? `${coordColor}77` : "hsl(var(--primary)/0.45)";
        (ev.currentTarget as HTMLElement).style.borderColor = coordColor ? `${coordColor}cc` : "hsl(var(--primary)/0.7)";
      }}
      onMouseLeave={ev => {
        if (isResizing) return;
        (ev.currentTarget as HTMLElement).style.background = coordColor ? `${coordColor}33` : "hsl(var(--primary)/0.25)";
        (ev.currentTarget as HTMLElement).style.borderColor = coordColor ? `${coordColor}66` : "hsl(var(--primary)/0.4)";
      }}
    >
      {/* Indicadores visuais de resize — só para tarefas do próprio coordenador */}
      {canInteract && <>
        <div className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center
                        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ zIndex: 4 }}>
          <div className="w-px h-5 rounded-full" style={{ background: "hsl(var(--primary))" }} />
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center
                        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ zIndex: 4 }}>
          <div className="w-px h-5 rounded-full" style={{ background: "hsl(var(--primary))" }} />
        </div>
        {onRemoveDay && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onRemoveDay(slot, date); }}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-red-500/20"
            style={{ zIndex: 20 }}
            title="Remover este dia"
          >
            <Trash2 className="h-3 w-3" style={{ color: "#ef4444" }} />
          </button>
        )}
      </>}

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
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className="text-[9px] font-black font-mono shrink-0" style={{ color: "hsl(var(--primary)/0.7)" }}>
                {slot.taskCode}
              </span>
              <span
                className="text-[11px] font-black truncate"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {slot.taskTitle}
              </span>
            </div>
            {slot.totalSlots && slot.totalSlots > 1 && (
              <span className="text-[8px] font-black uppercase tracking-wide px-1 py-px rounded shrink-0 self-start"
                style={{ background: coordColor ? `${coordColor}22` : "hsl(var(--primary)/0.12)", color: coordColor ?? "hsl(var(--primary)/0.7)" }}>
                {slot.slotIndex === slot.totalSlots ? "Etapa final" : `Etapa ${slot.slotIndex}/${slot.totalSlots}`}
              </span>
            )}
            {slot.coordinator && (
              <div className="flex items-center gap-1 overflow-hidden">
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
}

// ── DayBar ────────────────────────────────────────────────────────────────────

interface DayBarProps {
  slots:            ScheduleSlot[];
  dow:              number;
  isHoliday:        boolean;
  date:             string;
  isDraggable?:     boolean;
  editorColor?:     string | null;
  onDragSelect?:    (st: string, et: string, eh: number) => void;
  onSlotResize?:    (slot: ScheduleSlot, ns: string, ne: string, nh: number) => void;
  onSlotClick?:     (slot: ScheduleSlot) => void;
  onRemoveDay?:     (slot: ScheduleSlot, date: string) => void;
  onBarRef?:        (el: HTMLDivElement | null) => void;
  blockDropPreview?: { startMin: number; endMin: number; fits: boolean; taskId: number } | null;
  lastPointerDown:  React.MutableRefObject<{ clientX: number; clientY: number; date: string } | null>;
  onCrossDayResizeStart?: (slot: ScheduleSlot, fromDate: string, fromEndMin: number) => void;
}

function DayBar({ slots, dow, isHoliday, date, isDraggable, editorColor, onDragSelect, onSlotResize,
                  onSlotClick, onRemoveDay, onBarRef, blockDropPreview, lastPointerDown, onCrossDayResizeStart }: DayBarProps) {
  const { user }                    = useAuth();
  const myColor                     = (user as any)?.profileColor as string | null ?? null;
  const barRef                      = useRef<HTMLDivElement>(null);
  const [drag, setDrag]             = useState<{ anchor: number; cur: number } | null>(null);
  const [hoverMin, setHoverMin]     = useState<number | null>(null);
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);

  // Integração @dnd-kit: barra é uma zona droppável
  const { setNodeRef: setDropRef } = useDroppable({ id: date });

  const isSun    = dow === 0 || isHoliday;
  const isSat    = dow === 6 && !isHoliday;
  const dayEnd   = dayEndFor(dow, isHoliday);
  const total    = dayEnd - DAY_START;
  const hasLunch = !isSat && !isSun;
  const ticks    = Array.from({ length: total / 60 + 1 }, (_, i) => DAY_START / 60 + i);

  const isToday  = date === todayStr() && !isSun;

  // Minuto atual em tempo real — atualiza a cada 30s, só para a barra de hoje
  const getNowMin = () => {
    if (!isToday) return null;
    const n = new Date();
    return Math.max(DAY_START, Math.min(dayEnd, n.getHours() * 60 + n.getMinutes()));
  };
  const [nowMin, setNowMin] = useState<number | null>(getNowMin);

  useEffect(() => {
    if (!isToday) return;
    setNowMin(getNowMin()); // sync imediato ao montar/re-renderizar
    const id = setInterval(() => setNowMin(getNowMin()), 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, dayEnd]);

  const handleResizeStart = useCallback((slotIdx: number, side: "left"|"right", fixed: number, current: number) => {
    setResizeDrag({ slotIdx, side, fixed, current });
  }, []);

  const getResizeClamped = useCallback((rd: ResizeDrag): { newStart: number; newEnd: number } => {
    const others = slots.filter((_, j) => j !== rd.slotIdx);
    if (rd.side === "left") {
      // impede resize para antes do horário atual em "hoje"
      const pastBarrier = nowMin ?? DAY_START;
      const leftBarrier = Math.max(
        pastBarrier,
        others.filter(s => s.endTime && toMin(s.endTime) <= rd.fixed)
              .reduce((max, s) => Math.max(max, toMin(s.endTime!)), DAY_START),
      );
      const clamped = Math.max(leftBarrier, Math.min(rd.current, rd.fixed - SNAP_MIN));
      return { newStart: clamped, newEnd: rd.fixed };
    } else {
      const rightBarrier = others
        .filter(s => s.startTime && toMin(s.startTime) >= rd.fixed)
        .reduce((min, s) => Math.min(min, toMin(s.startTime!)), dayEnd);
      const clamped = Math.min(rightBarrier, Math.max(rd.current, rd.fixed + SNAP_MIN));
      return { newStart: rd.fixed, newEnd: clamped };
    }
  }, [slots, dayEnd, nowMin]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggable || !barRef.current) return;
    e.preventDefault();
    const min = xToMin(e.clientX, barRef.current.getBoundingClientRect(), dayEnd);
    // Bloqueia criação em horários passados dentro de "hoje"
    if (nowMin !== null && min < nowMin) return;
    barRef.current.setPointerCapture(e.pointerId);
    setDrag({ anchor: min, cur: min });
  }, [isDraggable, dayEnd, nowMin]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const min  = xToMin(e.clientX, rect, dayEnd);
    if (resizeDrag) {
      // Detecta saída vertical da barra (threshold de 24px) → inicia cross-day
      if (onCrossDayResizeStart && resizeDrag.side === "right" &&
          (e.clientY > rect.bottom + 24 || e.clientY < rect.top - 24)) {
        const slot = slots[resizeDrag.slotIdx];
        if (slot?.endTime) {
          barRef.current.releasePointerCapture(e.pointerId);
          onCrossDayResizeStart(slot, date, toMin(slot.endTime));
          setResizeDrag(null);
          return;
        }
      }
      setResizeDrag(prev => prev ? { ...prev, current: min } : null);
    } else if (drag) {
      setDrag(prev => prev ? { ...prev, cur: min } : null);
    } else if (isDraggable) {
      setHoverMin(xToMinHover(e.clientX, barRef.current.getBoundingClientRect(), dayEnd));
    }
  }, [drag, resizeDrag, dayEnd, isDraggable]);

  const handlePointerUp = useCallback(() => {
    if (resizeDrag) {
      const slot = slots[resizeDrag.slotIdx];
      if (slot?.startTime && slot?.endTime) {
        const { newStart, newEnd } = getResizeClamped(resizeDrag);
        const changed = newStart !== toMin(slot.startTime) || newEnd !== toMin(slot.endTime);
        if (changed) {
          const newHours = effortFromRange(newStart, newEnd, dow);
          if (newHours > 0) onSlotResize?.(slot, minToTime(newStart), minToTime(newEnd), newHours);
        }
      }
      setResizeDrag(null);
      return;
    }
    if (!drag) return;
    // Clamp esquerdo ao horário atual quando em "hoje"
    const rawS = Math.min(drag.anchor, drag.cur);
    const s    = nowMin !== null ? Math.max(rawS, nowMin) : rawS;
    const e    = Math.max(drag.anchor, drag.cur);
    if (e - s >= SNAP_MIN) {
      const effort = effortFromRange(s, e, dow);
      if (effort > 0) onDragSelect?.(minToTime(s), minToTime(e), effort);
    }
    setDrag(null);
  }, [drag, resizeDrag, dow, slots, onDragSelect, onSlotResize, getResizeClamped, nowMin]);

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

  // Ghost de criação (drag-to-create na barra livre)
  const ghost = drag ? (() => {
    const rawS = Math.min(drag.anchor, drag.cur);
    const s    = nowMin !== null ? Math.max(rawS, nowMin) : rawS;
    const e    = Math.max(drag.anchor, drag.cur);
    const left = pct(s - DAY_START, total), width = pct(e - s, total);
    const effort = effortFromRange(s, e, dow);
    return (
      <div className="absolute top-0 bottom-0 pointer-events-none select-none"
        style={{ left: `${left}%`, width: `${width}%`,
                 background: myColor ? `${myColor}2e` : "hsl(var(--primary)/0.18)",
                 border:     `1.5px solid ${myColor ? `${myColor}88` : "hsl(var(--primary)/0.55)"}`,
                 zIndex: 10 }}>
        {width > 5 && (
          <div className="absolute inset-0 flex items-center justify-center gap-0.5 px-1 overflow-hidden">
            <span className="text-[9px] font-black shrink-0" style={{ color: myColor ?? "hsl(var(--primary))" }}>{minToTime(s)}</span>
            {width > 14 && <>
              <span className="text-[9px] shrink-0" style={{ color: myColor ? `${myColor}66` : "hsl(var(--primary)/0.4)" }}>–</span>
              <span className="text-[9px] font-black shrink-0" style={{ color: myColor ?? "hsl(var(--primary))" }}>{minToTime(e)}</span>
              {effort > 0 && <span className="text-[9px] shrink-0 ml-1" style={{ color: myColor ? `${myColor}a6` : "hsl(var(--primary)/0.65)" }}>· {fmtH(effort)}</span>}
            </>}
          </div>
        )}
      </div>
    );
  })() : null;

  return (
    <div>
      <div
        ref={el => {
          (barRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          setDropRef(el);
          onBarRef?.(el);
        }}
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
        {/* Overlay do passado — área levemente escurecida sem pointer events */}
        {nowMin !== null && nowMin > DAY_START && (
          <div className="absolute top-0 bottom-0 left-0 pointer-events-none"
            style={{
              width:      `${pct(Math.min(nowMin, dayEnd) - DAY_START, total)}%`,
              background: "hsl(var(--muted-foreground)/0.07)",
              zIndex:     6,
            }} />
        )}

        {/* Linha "agora" — cursor em tempo real no dia de hoje */}
        {nowMin !== null && nowMin > DAY_START && nowMin < dayEnd && (
          <div className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left:      `${pct(nowMin - DAY_START, total)}%`,
              width:     2,
              background: "hsl(var(--primary))",
              zIndex:    9,
              transform: "translateX(-1px)",
            }}>
            <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full"
              style={{ background: "hsl(var(--primary))" }} />
          </div>
        )}

        {/* Almoço */}
        {hasLunch && (
          <div className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${pct(LUNCH_S - DAY_START, total)}%`, width: `${pct(LUNCH_E - LUNCH_S, total)}%`,
              backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 10px, hsl(var(--border)/0.4) 10px, hsl(var(--border)/0.4) 11px)",
              backgroundColor: "hsl(var(--muted)/0.2)",
              borderLeft: "1px solid hsl(var(--border))", borderRight: "1px solid hsl(var(--border))", zIndex: 3,
            }} />
        )}

        {/* Slots — cada um é um SlotItem com useDraggable */}
        {slots.map((slot, i) => (
          <SlotItem
            key={i}
            slot={slot}
            i={i}
            dow={dow}
            dayEnd={dayEnd}
            total={total}
            date={date}
            isDraggable={!!isDraggable}
            editorColor={editorColor ?? null}
            resizeDrag={resizeDrag}
            getResizeClamped={getResizeClamped}
            onResizeStart={handleResizeStart}
            onSlotClick={onSlotClick}
            onRemoveDay={onRemoveDay}
            blockDropPreview={blockDropPreview}
            barRef={barRef}
            lastPointerDown={lastPointerDown}
          />
        ))}

        {/* Preview de destino do block drag */}
        {blockDropPreview && (
          <div className="absolute top-2 bottom-2 rounded-none pointer-events-none"
            style={{
              left:       `calc(${pct(blockDropPreview.startMin - DAY_START, total)}% + 4px)`,
              width:      `calc(${pct(blockDropPreview.endMin - blockDropPreview.startMin, total)}% - 8px)`,
              background: blockDropPreview.fits ? (myColor ? `${myColor}38` : "hsl(var(--primary)/0.22)") : "#ef444420",
              border:     `1.5px dashed ${blockDropPreview.fits ? (myColor ? `${myColor}b3` : "hsl(var(--primary)/0.7)") : "#ef4444"}`,
              zIndex:     8,
            }}
          />
        )}

        {/* Hover cell — só em células livres e no futuro */}
        {isDraggable && !drag && !resizeDrag && hoverMin !== null && (() => {
          if (nowMin !== null && hoverMin < nowMin) return null; // passado
          const cellEnd  = hoverMin + SNAP_MIN;
          const occupied = slots.some(s => {
            if (!s.startTime || !s.endTime) return false;
            return toMin(s.startTime) < cellEnd && toMin(s.endTime) > hoverMin;
          });
          if (occupied) return null;
          return (
            <div className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: `${pct(hoverMin - DAY_START, total)}%`, width: `${pct(SNAP_MIN, total)}%`,
                       background: myColor ? `${myColor}20` : "hsl(var(--primary)/0.12)", zIndex: 1 }} />
          );
        })()}

        {ghost}
      </div>

      {/* Ticks de hora */}
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
  const todayRef    = useRef<HTMLDivElement>(null);
  const initialLoad = useRef(true);

  // Criar nova tarefa via drag na barra livre
  const [dragModal, setDragModal] = useState<{
    date: string; startTime: string; endTime: string; effortHours: number;
  } | null>(null);

  // Block drag via @dnd-kit
  const [activeDrag,  setActiveDrag]  = useState<ActiveDrag | null>(null);
  const [dropPreview, setDropPreview] = useState<{
    date: string; startMin: number; endMin: number; fits: boolean;
  } | null>(null);
  const [dragPos,      setDragPos]      = useState({ x: 0, y: 0 });
  const [editTaskId,   setEditTaskId]   = useState<number | null>(null);

  // Cross-day resize (arrastar handle direito para outro dia)
  const [crossDayPreview, setCrossDayPreview] = useState<{
    date: string; startMin: number; endMin: number;
  } | null>(null);
  const crossDayRef = useRef<{
    slot: ScheduleSlot; fromDate: string;
  } | null>(null);
  const crossDayPreviewRef = useRef<typeof crossDayPreview>(null);

  // Refs para acesso sem re-render em callbacks do @dnd-kit
  const lastPointerDown  = useRef<{ clientX: number; clientY: number; date: string } | null>(null);
  const barRefs          = useRef<Map<string, HTMLDivElement>>(new Map());
  const holidaysRef      = useRef<Set<string>>(new Set());
  const scheduleRef      = useRef<Map<string, ScheduleSlot[]>>(new Map());
  const cursorPos        = useRef({ x: 0, y: 0 });

  const isCoordinator = user?.role === "coordinator" || user?.role === "admin";
  const today         = todayStr();
  const fromStr       = toLocalDateStr(new Date(parseDate(today).getTime() - 7  * 86_400_000));
  const toStr         = toLocalDateStr(new Date(parseDate(today).getTime() + 29 * 86_400_000));

  // Rastreia cursor globalmente — usado durante o drag para posicionar o ghost
  useEffect(() => {
    const track = (e: PointerEvent) => { cursorPos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", track, { passive: true });
    return () => window.removeEventListener("pointermove", track);
  }, []);

  // Sync refs
  useEffect(() => { holidaysRef.current = holidays; }, [holidays]);
  useEffect(() => { scheduleRef.current = new Map(schedule.map(d => [d.date, d.slots])); }, [schedule]);

  usePageTitle(editor ? editor.name.split(" ")[0] : "Agenda");

  useEffect(() => { initialLoad.current = true; }, [editorId]);

  useEffect(() => {
    if (isNaN(editorId)) return;
    const isFirst = initialLoad.current;
    if (isFirst) setLoading(true);
    Promise.all([
      apiFetch<EditorInfo[]>("/api/users").then(u => u.find(x => x.id === editorId) ?? null),
      apiFetch<ScheduleDay[]>(`/api/escala/editor/${editorId}/schedule?from=${fromStr}&to=${toStr}`),
      apiFetch<{ holidays: string[] }>("/api/calendar-config").then(d => new Set(d.holidays ?? [])),
    ]).then(([ed, sched, hols]) => { setEditor(ed); setSchedule(sched); setHolidays(hols); })
      .catch(() => {}).finally(() => {
        if (!isFirst) return;
        setLoading(false);
        initialLoad.current = false;
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

  // @dnd-kit sensors — PointerSensor com threshold de 8px para distinguir clique de drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Calcula dropPreview a partir da posição do cursor + barRefs
  const computeDropPreview = useCallback((curX: number, curY: number, cur: ActiveDrag) => {
    const hols = holidaysRef.current;
    let targetDate: string | null = null;
    let targetRect: DOMRect | null = null;
    let nearestDist = Infinity;

    for (const [d, barEl] of barRefs.current) {
      const rect = barEl.getBoundingClientRect();
      if (curY >= rect.top && curY <= rect.bottom) { targetDate = d; targetRect = rect; break; }
      const dist = curY < rect.top ? rect.top - curY : curY - rect.bottom;
      if (dist < nearestDist) { nearestDist = dist; targetDate = d; targetRect = rect; }
    }

    if (!targetDate || !targetRect) return null;
    const dow = parseDate(targetDate).getDay();
    if (dow === 0 || hols.has(targetDate) || targetDate < today) return null;

    const dEnd = dayEndFor(dow, hols.has(targetDate));
    const x    = Math.max(0, Math.min(curX - targetRect.left, targetRect.width));
    const cursorMin = DAY_START + (x / targetRect.width) * (dEnd - DAY_START);
    let startMin = Math.round((cursorMin - cur.offsetMin) / SNAP_MIN) * SNAP_MIN;
    startMin = Math.max(DAY_START, Math.min(dEnd - cur.durationMin, startMin));
    const endMin = startMin + cur.durationMin;

    // Bloqueia drop em horários passados dentro de "hoje"
    if (targetDate === today) {
      const n      = new Date();
      const nowRaw = n.getHours() * 60 + n.getMinutes();
      if (startMin < nowRaw) {
        return { date: targetDate, startMin, endMin, fits: false };
      }
    }

    const fits = !(scheduleRef.current.get(targetDate) ?? []).some(s => {
      if (s.taskId === cur.slot.taskId || !s.startTime || !s.endTime) return false;
      return toMin(s.startTime) < endMin && toMin(s.endTime) > startMin;
    });

    return { date: targetDate, startMin, endMin, fits };
  }, [today]);

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    const { slot, fromDate } = active.data.current as { slot: ScheduleSlot; fromDate: string };
    const pd = lastPointerDown.current;
    let offsetMin = 0;
    if (pd) {
      const barEl = barRefs.current.get(pd.date);
      if (barEl) {
        const barRect = barEl.getBoundingClientRect();
        const dow     = parseDate(pd.date).getDay();
        const dEnd    = dayEndFor(dow, holidaysRef.current.has(pd.date));
        const x       = Math.max(0, Math.min(pd.clientX - barRect.left, barRect.width));
        const clickMin = DAY_START + (x / barRect.width) * (dEnd - DAY_START);
        offsetMin = clickMin - toMin(slot.startTime ?? "08:00");
      }
    }
    const durationMin = toMin(slot.endTime ?? "18:00") - toMin(slot.startTime ?? "08:00");
    setActiveDrag({ slot, fromDate, durationMin, offsetMin });
    setDragPos({ x: cursorPos.current.x, y: cursorPos.current.y });
  }, []);

  const handleDragMove = useCallback((_ev: DragMoveEvent) => {
    const { x, y } = cursorPos.current;
    setDragPos({ x, y });
    setActiveDrag(cur => {
      if (!cur) return cur;
      const preview = computeDropPreview(x, y, cur);
      setDropPreview(preview);
      return cur;
    });
  }, [computeDropPreview]);

  const handleDragEnd = useCallback((_ev: DragEndEvent) => {
    const cur     = activeDrag;
    const preview = dropPreview;
    setActiveDrag(null);
    setDropPreview(null);
    if (!cur || !preview || !preview.fits) return;
    // Defesa: coordenador só move tarefas próprias
    if (user?.role === "coordinator" && cur.slot.coordinator?.id && cur.slot.coordinator.id !== user.id) return;

    const { date: toDate, startMin, endMin } = preview;
    const dow = parseDate(toDate).getDay();
    const h   = effortFromRange(startMin, endMin, dow);
    if (h <= 0) return;

    const ns      = minToTime(startMin);
    const ne      = minToTime(endMin);
    const sameDay = toDate === cur.fromDate;
    const originalStart = toMin(cur.slot.startTime ?? "08:00");

    if (sameDay) {
      if (startMin !== originalStart) handleBlockMove(cur.slot, cur.fromDate, ns, ne, h);
    } else {
      // Cross-day: move direto (sem dialog) — "estender" é feito pelo handle
      handleBlockMove(cur.slot, cur.fromDate, ns, ne, h, toDate);
    }
  }, [activeDrag, dropPreview]);

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
    setDropPreview(null);
  }, []);

  // Cross-day resize — arrastar handle direito para um dia posterior
  const handleCrossDayResizeStart = useCallback((
    slot: ScheduleSlot, fromDate: string, _fromEndMin: number,
  ) => {
    crossDayRef.current = { slot, fromDate };
    crossDayPreviewRef.current = null;

    const onMove = (e: PointerEvent) => {
      const hols = holidaysRef.current;
      // Encontra a barra sob o cursor (hit exato por Y)
      let targetDate: string | null = null;
      let targetRect: DOMRect | null = null;
      for (const [d, barEl] of barRefs.current) {
        const r = barEl.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { targetDate = d; targetRect = r; break; }
      }
      if (!targetDate || !targetRect || targetDate === fromDate) {
        setCrossDayPreview(null); crossDayPreviewRef.current = null; return;
      }
      const dow = parseDate(targetDate).getDay();
      if (dow === 0 || hols.has(targetDate) || targetDate <= fromDate) {
        setCrossDayPreview(null); crossDayPreviewRef.current = null; return;
      }
      const dEnd    = dayEndFor(dow, hols.has(targetDate));
      const x       = Math.max(0, Math.min(e.clientX - targetRect.left, targetRect.width));
      const endMin  = snapToGrid(DAY_START + (x / targetRect.width) * (dEnd - DAY_START), dEnd);
      const preview = { date: targetDate, startMin: DAY_START, endMin };
      crossDayPreviewRef.current = preview;
      setCrossDayPreview(preview);
    };

    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      const cur     = crossDayRef.current;
      const preview = crossDayPreviewRef.current;
      crossDayRef.current = null;
      crossDayPreviewRef.current = null;
      setCrossDayPreview(null);
      if (!cur || !preview) return;

      const dow = parseDate(preview.date).getDay();
      const h   = effortFromRange(preview.startMin, preview.endMin, dow);
      if (h <= 0) return;

      try {
        // add-day já sincroniza startDate/dueDate via syncTaskDates no backend
        await apiPost(`/api/escala/tasks/${cur.slot.taskId}/add-day`, {
          workDate: preview.date,
          startTime: minToTime(preview.startMin),
          endTime:   minToTime(preview.endMin),
          allocatedHours: h,
        });
        toast.success("Tarefa estendida para " + preview.date);
        setRefreshKey(k => k + 1);
      } catch {
        toast.error("Erro ao estender tarefa");
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  // Drag criar tarefa (range selection na barra livre)
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
      toast.success("Horário atualizado");
    } catch {
      toast.error("Erro ao redimensionar slot");
      setRefreshKey(k => k + 1);
    }
  }, []);

  // Block move — mesmo dia (optimistic) ou outro dia (reload)
  const handleBlockMove = useCallback(async (
    slot: ScheduleSlot, fromDate: string, newStart: string, newEnd: string, newHours: number,
    toDate?: string,
  ) => {
    const crossDay = toDate && toDate !== fromDate;
    if (!crossDay) {
      setSchedule(prev => prev.map(day =>
        day.date !== fromDate ? day : {
          ...day,
          slots: day.slots.map(s =>
            s.taskId === slot.taskId ? { ...s, startTime: newStart, endTime: newEnd, hours: newHours } : s
          ),
        }
      ));
    }
    try {
      await apiPost(`/api/escala/tasks/${slot.taskId}/resize-slot`, {
        workDate:       fromDate,
        newWorkDate:    crossDay ? toDate : undefined,
        startTime:      newStart,
        endTime:        newEnd,
        allocatedHours: newHours,
      });
      toast.success(crossDay ? "Tarefa movida para outro dia" : "Tarefa reposicionada");
      if (crossDay) setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro ao mover tarefa");
      setRefreshKey(k => k + 1);
    }
  }, []);

  const handleSlotClick = useCallback((slot: ScheduleSlot) => {
    setEditTaskId(slot.taskId);
  }, []);

  const handleRemoveDay = useCallback(async (slot: ScheduleSlot, date: string) => {
    try {
      await apiDelete(`/api/escala/tasks/${slot.taskId}/remove-day?workDate=${date}`);
      toast.success("Dia removido");
      setRefreshKey(k => k + 1);
    } catch {
      toast.error("Erro ao remover dia");
    }
  }, []);


  const scheduleMap = new Map(schedule.map(d => [d.date, d.slots]));
  const allDates    = buildDates(fromStr, 37);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
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
        <div className="px-5 py-6 max-w-2xl mx-auto space-y-7"
          style={editTaskId !== null ? { pointerEvents: "none" } : undefined}>
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

                const blockDP = (() => {
                  if (activeDrag && dropPreview && dropPreview.date === date)
                    return { startMin: dropPreview.startMin, endMin: dropPreview.endMin,
                             fits: dropPreview.fits, taskId: activeDrag.slot.taskId };
                  if (crossDayPreview && crossDayPreview.date === date)
                    return { startMin: crossDayPreview.startMin, endMin: crossDayPreview.endMin,
                             fits: true, taskId: -1 }; // -1 = não faz fade em nenhum slot
                  return null;
                })();

                return (
                  <div key={date} ref={isToday ? todayRef : undefined}
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
                      slots={slots} dow={dow} isHoliday={isHoliday} date={date}
                      isDraggable={draggable}
                      editorColor={editor?.profileColor ?? null}
                      onDragSelect={(st, et, eh) => handleDragSelect(date, st, et, eh)}
                      onSlotResize={(slot, st, et, h) => handleSlotResize(slot, date, st, et, h)}
                      onSlotClick={handleSlotClick}
                      onRemoveDay={draggable ? handleRemoveDay : undefined}
                      onBarRef={el => { if (el) barRefs.current.set(date, el); else barRefs.current.delete(date); }}
                      blockDropPreview={blockDP}
                      lastPointerDown={lastPointerDown}
                      onCrossDayResizeStart={draggable ? handleCrossDayResizeStart : undefined}
                    />
                  </div>
                );
              })
          }
        </div>

        {/* Ghost chip do block drag — segue o cursor */}
        {activeDrag && (
          <div className="fixed pointer-events-none z-50 select-none"
            style={{ left: dragPos.x + 10, top: dragPos.y - 18 }}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black shadow-xl"
              style={{
                background: dropPreview?.fits !== false ? "hsl(var(--primary))" : "#ef4444",
                color:      "white",
                maxWidth:   200,
                transition: "background 0.1s",
              }}>
              <span className="font-mono opacity-75 shrink-0">{activeDrag.slot.taskCode}</span>
              <span className="truncate">{activeDrag.slot.taskTitle}</span>
              {dropPreview?.fits === false && (
                <span className="shrink-0 opacity-80 ml-1">bloqueado</span>
              )}
            </div>
          </div>
        )}

        {/* Modal de edição */}
        <TaskFormModal
          open={editTaskId !== null}
          onOpenChange={open => { if (!open) setEditTaskId(null); }}
          editTaskId={editTaskId}
          onSaved={() => setRefreshKey(k => k + 1)}
        />

        {/* Modal criar tarefa por drag-to-create */}
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
    </DndContext>
  );
}
