/**
 * ESCALA — Encaixe de Slots e Cargas para Alocação Livre e Automática
 * Modelo v2: coordenador informa horas de esforço + período (início + prazo).
 * Algoritmo encontra blocos de horas disponíveis por editor.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { apiFetch, apiPost } from "@/lib/api";
import { todayStr, localISOString, nextHalfHour, parseDate, toLocalDateStr, earliestStartDate, workdayOver } from "@/lib/date";
import { toast } from "sonner";
import {
  XCircle, Calendar, Loader2, Search, AlertTriangle, Clock, Zap, Timer,
} from "lucide-react";

// ── Constantes ────────────────────────────────────────────────────────────────

const PRIORITY_OPTS = [
  { value: "high",   label: "Alta"   },
  { value: "medium", label: "Média"  },
  { value: "low",    label: "Baixa"  },
];

// Presets de horas comuns em uma agência de vídeo
const HOUR_PRESETS = [
  { label: "30min", value: 0.5  },
  { label: "1h",    value: 1    },
  { label: "2h",    value: 2    },
  { label: "4h",    value: 4    },
  { label: "8h",    value: 8    },
  { label: "12h",   value: 12   },
  { label: "16h",   value: 16   },
];

// Horários disponíveis (meia em meia hora, 08h–18h)
const TIME_OPTIONS: string[] = [];
for (let h = 8; h <= 18; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2,"0")}:00`);
  if (h < 18) TIME_OPTIONS.push(`${String(h).padStart(2,"0")}:30`);
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type QuizStep = "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "review" | "searching" | "results" | "confirm" | "conflict" | "displacement-preview" | "window-infeasible";
const QUIZ_STEPS_BASE: QuizStep[] = ["q1","q2","q3","q4","q5","review"];
const QUIZ_STEPS_WITH_Q6: QuizStep[] = ["q1","q2","q3","q4","q6","q5","review"];

interface HourSlot { date: string; hours: number; startTime?: string; endTime?: string; }

interface ConflictSlot { date: string; startTime: string; endTime: string; hours: number; }
interface ConflictInfo {
  taskId:          number;
  title:           string;
  color:           string | null;
  client:          string | null;
  dueDate:         string | null;
  coordinatorName: string;
  effortHours:     number | null;
  slots:           ConflictSlot[];
}
interface DisplacementCascadeItem {
  taskId:          number;
  title:           string;
  color:           string | null;
  coordinatorName: string;
  dueDate:         string | null;
  originalSlots:   HourSlot[];
  newSlots:        HourSlot[];
  possible:        boolean;
}
interface DisplacementPlan {
  feasible: boolean;
  cascade:  DisplacementCascadeItem[];
}

interface EditorOption {
  editor:              { id: number; name: string; login: string; avatarUrl: string | null };
  possible:            boolean;
  slots:               HourSlot[];
  projectedCompletion: string | null;
  hoursFound:          number;
  hoursNeeded:         number;
}

interface EscalaResult {
  target:                  EditorOption | null;
  alternatives:            EditorOption[];
  windowDays:              number;
  calculatedDeadline:      string | null;
  windowFeasible:          boolean;
  theoreticalMinDeadline:  string | null;
  windowCapacityHours:     number;
}

interface Props {
  open:                boolean;
  onClose:             () => void;
  onCreated:           (info: { editorId: number; firstDate: string; taskId: number }) => void;
  onStepChange?:       (step: QuizStep) => void;
  initialDate?:        string;  // YYYY-MM-DD
  initialEditorId?:    number;  // pré-seleciona editor no passo Q5
  initialStartTime?:   string;  // "HH:MM" — horário de início do drag
  initialEndTime?:     string;  // "HH:MM" — deadline de entrega (pré-preenche Q4)
  initialEffortHours?: number;  // horas de esforço (pré-seleciona Q2)
  mode?:               "modal" | "page"; // "page" renderiza sem Dialog overlay
}

// ── Aliases locais dos utilitários canônicos ──────────────────────────────────
const today      = todayStr;
const localISO   = localISOString;
const minTimeNow = nextHalfHour;

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// Espelha calcTheoreticalCompletion do backend — apenas para preview na UI
// Usa dailyCapacity (8h/5h) igual ao backend, não clock time (10h/dia)
function calcMinCompletion(sd: string, _st: string, hours: number): string {
  const DAILY_CAP = (dow: number) => dow === 0 ? 0 : dow === 6 ? 5 : 8;
  let remaining = Math.round(hours * 100) / 100;
  const d = parseDate(sd);
  d.setHours(12, 0, 0, 0); // noon local — evita drift UTC igual ao backend
  while (remaining > 0.01) {
    const cap = DAILY_CAP(d.getDay());
    if (cap > 0) {
      remaining = Math.round((remaining - Math.min(cap, remaining)) * 100) / 100;
      if (remaining <= 0.01) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `${dd}/${mm}`;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return toLocalDateStr(d);
}
// Janela em dias úteis para mode=open (espelha backend)
function calcOpenWindow(hours: number): number {
  return Math.max(Math.ceil(hours / 8) * 3, 3);
}

function fmtWeekDay(d: string): string {
  return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][new Date(d + "T12:00:00").getDay()];
}
function fmtHours(h: number): string {
  const total = Math.round(h * 60);
  const hrs   = Math.floor(total / 60);
  const mins  = total % 60;
  if (hrs === 0) return `${mins}min`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h${mins}min`;
}
function fmtDateTime(date: string, time: string): string {
  return `${fmtDate(date)} ${time}`;
}
function roundH(h: number): number {
  return Math.round(h * 100) / 100;
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function AvatarCircle({ name, avatarUrl, size = 32 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  if (avatarUrl) return (
    <img src={avatarUrl} alt={name} className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }} />
  );
  return (
    <div className="rounded-full flex items-center justify-center shrink-0 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: "#6366f1" }}>
      {initials}
    </div>
  );
}

function SlotChips({ slots }: { slots: HourSlot[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {slots.map(s => (
        <span key={s.date}
          className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md"
          style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
          <span className="opacity-60">{fmtWeekDay(s.date)}</span>
          {fmtDate(s.date)}
          {s.startTime && s.endTime
            ? <span className="opacity-75">· {s.startTime}–{s.endTime}</span>
            : <span className="opacity-70">· {fmtHours(s.hours)}</span>
          }
        </span>
      ))}
    </div>
  );
}

function TimePicker({ value, onChange, label, options = TIME_OPTIONS }: {
  value: string; onChange: (v: string) => void; label: string; options?: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 px-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.3)]">
        {options.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function EscalaModal({ open, onClose, onCreated, onStepChange, initialDate, initialEditorId, initialStartTime, initialEndTime, initialEffortHours, mode = "modal" }: Props) {
  const [step, setStep] = useState<QuizStep>("q1");

  const goTo = useCallback((s: QuizStep) => {
    setStep(s);
    onStepChange?.(s);
  }, [onStepChange]);

  // Q1
  const [title, setTitle] = useState("");
  // Q2
  const [effortHours, setEffortHours] = useState(0);
  const [customHours, setCustomHours] = useState("");
  const [useCustom,   setUseCustom]   = useState(false);
  // Q3
  const [startMode, setStartMode] = useState<"manual" | "auto" | null>(null);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  // Q4
  const [deadlineMode, setDeadlineMode] = useState<"urgent" | "client" | "open" | null>(null);
  const [deadline,     setDeadline]     = useState("");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  // Q5
  const [prefEditorId, setPrefEditorId] = useState<number | null>(null);
  const [editorSearch, setEditorSearch] = useState("");
  const [editors,      setEditors]      = useState<EditorOption["editor"][]>([]);

  // Results
  const [result,   setResult]   = useState<EscalaResult | null>(null);
  const [selected, setSelected] = useState<EditorOption | null>(null);

  // Q6 — margem de aprovação (em horas de trabalho)
  const [reviewHours, setReviewHours] = useState(0);

  // Conflict / displacement
  const [conflictData,     setConflictData]     = useState<ConflictInfo[] | null>(null);
  const [displacementPlan, setDisplacementPlan] = useState<DisplacementPlan | null>(null);

  // Confirm
  const [client,      setClient]      = useState("");
  const [clientSearch,setClientSearch]= useState("");
  const [clientOpen,  setClientOpen]  = useState(false);
  const [clients,     setClients]     = useState<{ id: number; name: string }[]>([]);
  const [description, setDescription] = useState("");
  const [folderUrl,   setFolderUrl]   = useState("");
  const [complexity,  setComplexity]  = useState("medium");
  const [priority,    setPriority]    = useState("medium");
  const [saving,      setSaving]      = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch<{ id: number; name: string; login: string; avatarUrl: string | null; role: string }[]>("/api/users")
      .then(users => setEditors(users.filter(u => u.role === "editor")))
      .catch(() => {});
    apiFetch<{ id: number; name: string }[]>("/api/clients")
      .then(setClients).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open) {
      goTo("q1");
      setTitle("");
      setDeadlineMode(null);
      setDeadline("");
      setDeadlineTime("18:00");
      setPrefEditorId(initialEditorId ?? null);
      setEditorSearch("");
      setResult(null);
      setSelected(null);
      setReviewHours(0);
      setClient("");
      setClientSearch("");
      setClientOpen(false);
      setDescription("");
      setFolderUrl("");
      setComplexity("medium");
      setPriority("medium");
      setConflictData(null);
      setDisplacementPlan(null);

      // Horas de esforço
      if (initialEffortHours && initialEffortHours > 0) {
        const match = HOUR_PRESETS.find(p => p.value === initialEffortHours);
        if (match) { setEffortHours(match.value); setUseCustom(false); setCustomHours(""); }
        else        { setCustomHours(String(initialEffortHours)); setUseCustom(true); setEffortHours(0); }
      } else {
        setEffortHours(0); setCustomHours(""); setUseCustom(false);
      }

      // Data e horário de início
      const earliest = earliestStartDate();
      setStartDate(initialDate && initialDate >= earliest ? initialDate : earliest);
      if (initialStartTime) {
        setStartMode("manual");
        setStartTime(initialStartTime);
      } else {
        setStartMode(null);
        setStartTime("08:00");
      }

      // Deadline pré-preenchida quando vem do drag (via URL params)
      if (initialEndTime && initialDate) {
        setDeadlineMode("client");
        setDeadline(initialDate);
        setDeadlineTime(initialEndTime);
      }
    }
  }, [open, initialDate, initialEditorId, initialStartTime, initialEndTime, initialEffortHours]);

  useEffect(() => {
    if (step === "q1") setTimeout(() => titleRef.current?.focus(), 80);
  }, [step]);

  // Horas efetivas a usar (custom ou preset)
  const activeHours = useCustom
    ? (parseFloat(customHours) || 0)
    : effortHours;

  const effectiveStartDate = startMode === "auto" ? earliestStartDate() : startDate;
  const effectiveStartTime = startMode === "auto"
    ? (workdayOver() ? "08:00" : minTimeNow())
    : startTime;
  const minDeadline = effectiveStartDate || undefined;

  // Horário mínimo para início: se hoje (e expediente não encerrado), bloqueia horários passados
  const minStartTime = (startDate === today() && !workdayOver()) ? minTimeNow() : "08:00";
  // Opções do TimePicker: se expediente encerrado e data é hoje, não há opções válidas hoje
  const startTimeOptions = (!workdayOver() || startDate > today())
    ? TIME_OPTIONS.filter(t => startDate > today() || t >= minStartTime)
    : TIME_OPTIONS; // fallback usado apenas para datas futuras (hoje nunca chega aqui com fix acima)

  const runAlgorithm = useCallback(async () => {
    if (activeHours <= 0) { toast.error("Informe as horas de trabalho"); return; }
    if (!startMode)       { toast.error("Informe quando o editor começa"); return; }
    if (startMode === "manual" && !startDate) { toast.error("Informe a data de início"); return; }
    if (deadlineMode === "client" && !deadline) { toast.error("Informe o prazo de entrega"); return; }

    goTo("searching");
    try {
      const startISO = localISO(effectiveStartDate, effectiveStartTime);

      const params = new URLSearchParams({
        effortHours: String(activeHours),
        startDate:   startISO,
        mode:        deadlineMode ?? "client",
        ...(deadlineMode === "client" ? { deadline: localISO(deadline, deadlineTime) } : {}),
        ...(deadlineMode === "client" && reviewHours > 0 ? { reviewHours: String(reviewHours) } : {}),
        ...(prefEditorId ? { editorId: String(prefEditorId) } : {}),
      });

      const [data] = await Promise.all([
        apiFetch<EscalaResult>(`/api/escala/options?${params}`),
        new Promise(r => setTimeout(r, 2000)),
      ]);
      const escalaData = data as EscalaResult;
      setResult(escalaData);

      const candidates = [escalaData.target, ...escalaData.alternatives].filter(Boolean) as EditorOption[];
      setSelected(candidates.find(c => c.possible) ?? null);

      // Janela matematicamente inviável — tela dedicada em vez de resultados
      if (!escalaData.windowFeasible) {
        goTo("window-infeasible");
      } else {
        goTo("results");
      }
    } catch {
      toast.error("Erro ao buscar disponibilidade");
      goTo("q5");
    }
  }, [activeHours, startMode, startDate, startTime, effectiveStartDate, effectiveStartTime, deadline, deadlineTime, reviewHours, prefEditorId, deadlineMode]);

  // Calcula dueDate a partir do modo escolhido (compartilhado por createTask e confirmDisplacement)
  // urgent → hora real de conclusão = endTime do último slot (não 18:00 hardcoded)
  // open   → fim da janela + 18:00 (limite externo)
  // client → exatamente o que o coordenador digitou na Q4
  const resolveDueDate = (lastSlot?: { date: string; endTime?: string }): string | null => {
    if (deadlineMode === "urgent") {
      if (!lastSlot) return null;
      return localISO(lastSlot.date, lastSlot.endTime ?? "18:00");
    }
    if (deadlineMode === "open") {
      const endDate = result?.calculatedDeadline || lastSlot?.date;
      return endDate ? localISO(endDate.slice(0, 10), "18:00") : null;
    }
    return deadline ? localISO(deadline, deadlineTime) : null;
  };

  const createTask = async () => {
    if (!selected) return;

    if (!client.trim())       { toast.error("Informe o cliente"); return; }
    if (!description.trim()) { toast.error("Informe o briefing da tarefa"); return; }
    if (!folderUrl.trim())   { toast.error("Informe a pasta ou link dos arquivos"); return; }

    setSaving(true);
    try {
      // Pre-flight: verifica colisões antes de criar a tarefa
      const slotsWithTimes = selected.slots.filter(s => s.startTime && s.endTime) as
        { date: string; startTime: string; endTime: string }[];

      if (slotsWithTimes.length > 0) {
        const check = await apiPost<{ hasConflicts: boolean; conflicts: ConflictInfo[] }>(
          "/api/escala/check-conflicts",
          { editorId: selected.editor.id, slots: slotsWithTimes },
        );
        if (check.hasConflicts) {
          setConflictData(check.conflicts);
          goTo("conflict");
          return;
        }
      }

      // Sem conflitos — fluxo normal
      const firstSlot = selected.slots[0];
      const lastSlot  = selected.slots[selected.slots.length - 1];
      const dueDate   = resolveDueDate(lastSlot);

      if (client.trim()) await apiPost("/api/clients", { name: client.trim() }).catch(() => {});

      const task = await apiPost("/api/tasks", {
        title:         title.trim(),
        description:   description.trim(),
        folderUrl:     folderUrl.trim(),
        client:        client.trim() || null,
        priority,
        complexity,
        assignedToId:  selected.editor.id,
        startDate:     firstSlot ? localISO(firstSlot.date, firstSlot.startTime ?? "08:00") : null,
        dueDate,
        effortHours:   activeHours,
        status:        "pending",
        escalaManaged: true,
      }) as { id: number };

      await apiPost(`/api/escala/tasks/${task.id}/allocate`, {
        editorId:    selected.editor.id,
        slots:       selected.slots,
        effortHours: activeHours,
      });

      toast.success(`Tarefa criada — ${selected.editor.name.split(" ")[0]} tem ${fmtHours(activeHours)} reservado${activeHours !== 1 ? "s" : ""}`);
      onCreated({ editorId: selected.editor.id, firstDate: firstSlot?.date ?? "", taskId: task.id });
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
    } finally {
      setSaving(false);
    }
  };

  const previewDisplacement = async () => {
    if (!selected || !conflictData) return;
    setSaving(true);
    try {
      const plan = await apiPost<DisplacementPlan>("/api/escala/preview-displacement", {
        editorId:           selected.editor.id,
        newSlots:           selected.slots,
        conflictingTaskIds: conflictData.map(c => c.taskId),
      });
      setDisplacementPlan(plan);
      goTo("displacement-preview");
    } catch {
      toast.error("Erro ao calcular reagendamento");
    } finally {
      setSaving(false);
    }
  };

  const confirmDisplacement = async () => {
    if (!selected || !displacementPlan) return;
    setSaving(true);
    try {
      const firstSlot = selected.slots[0];
      const lastSlot  = selected.slots[selected.slots.length - 1];
      const dueDate   = resolveDueDate(lastSlot);

      if (client.trim()) await apiPost("/api/clients", { name: client.trim() }).catch(() => {});

      const task = await apiPost("/api/tasks", {
        title:         title.trim(),
        description:   description.trim(),
        folderUrl:     folderUrl.trim(),
        client:        client.trim() || null,
        priority,
        complexity,
        assignedToId:  selected.editor.id,
        startDate:     firstSlot ? localISO(firstSlot.date, firstSlot.startTime ?? "08:00") : null,
        dueDate,
        effortHours:   activeHours,
        status:        "pending",
        escalaManaged: true,
      }) as { id: number };

      await apiPost("/api/escala/confirm-displacement", {
        newTaskId:          task.id,
        newTaskEffortHours: activeHours,
        editorId:           selected.editor.id,
        newTaskSlots:       selected.slots,
        cascade:            displacementPlan.cascade.map(c => ({ taskId: c.taskId, newSlots: c.newSlots })),
      });

      toast.success(`Tarefa criada — reagendamento aplicado para ${displacementPlan.cascade.length} tarefa${displacementPlan.cascade.length !== 1 ? "s" : ""}`);
      onCreated({ editorId: selected.editor.id, firstDate: firstSlot?.date ?? "", taskId: task.id });
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao aplicar reagendamento");
    } finally {
      setSaving(false);
    }
  };

  const filteredEditors = editors.filter(e =>
    e.name.toLowerCase().includes(editorSearch.toLowerCase()) ||
    e.login.toLowerCase().includes(editorSearch.toLowerCase())
  );

  const allOptions: EditorOption[] = result
    ? [result.target, ...result.alternatives].filter(Boolean) as EditorOption[]
    : [];

  // Opções de margem de aprovação proporcionais ao esforço
  const reviewOptions: { hours: number; label: string; sub: string }[] = activeHours <= 4
    ? [
        { hours: 0, label: "sem margem",  sub: "entrega direto no prazo do cliente" },
        { hours: 1, label: "1 hora",      sub: "aprovação rápida" },
        { hours: 2, label: "2 horas",     sub: "tempo razoável" },
        { hours: 4, label: "4 horas",     sub: "meio período para aprovar" },
      ]
    : activeHours <= 16
    ? [
        { hours: 0, label: "sem margem",  sub: "entrega direto no prazo do cliente" },
        { hours: 2, label: "2 horas",     sub: "aprovação rápida" },
        { hours: 4, label: "4 horas",     sub: "meio dia" },
        { hours: 8, label: "1 dia",       sub: "tempo confortável para aprovar" },
      ]
    : [
        { hours: 0,  label: "sem margem",     sub: "entrega direto no prazo do cliente" },
        { hours: 8,  label: "1 dia antes",    sub: "aprovação rápida" },
        { hours: 16, label: "2 dias antes",   sub: "tempo confortável" },
        { hours: 40, label: "1 semana antes", sub: "aprovação detalhada" },
      ];

  function fmtReviewHours(h: number): string {
    if (h === 0)  return "sem margem";
    if (h < 8)    return `${h}h antes`;
    if (h === 8)  return "1 dia antes";
    if (h === 16) return "2 dias antes";
    if (h === 40) return "1 semana antes";
    return `${h}h antes`;
  }

  const activeQuizSteps = deadlineMode === "client" ? QUIZ_STEPS_WITH_Q6 : QUIZ_STEPS_BASE;
  const quizIndex = activeQuizSteps.indexOf(step as QuizStep);

  // ── Render ────────────────────────────────────────────────────────────────────
  // Conteúdo compartilhado entre modo modal e modo página
  const inner = (<>

        {/* Step dots */}
        {quizIndex >= 0 && (
          <div className="flex items-center justify-end gap-1.5 px-6 pt-5 pb-1">
            {activeQuizSteps.map((_, i) => (
              <div key={i} className="h-1 rounded-full transition-all duration-300"
                style={{
                  width:      i === quizIndex ? 22 : 5,
                  background: i <= quizIndex
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground)/0.2)",
                }} />
            ))}
          </div>
        )}

        {/* ── Q1: Nome ─────────────────────────────────────────────────────── */}
        {step === "q1" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-5" style={{ minHeight: 340 }}>
            <div>
              <p className="text-4xl font-black leading-none tracking-tight">tarefa?</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2">informe o nome de sua tarefa</p>
            </div>
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && title.trim() && goTo("q2")}
              placeholder="ex: edição spot 30s…"
              className="w-full h-12 px-0 text-lg font-medium border-0 border-b-2 bg-transparent focus:outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))]/25"
              style={{ borderBottomColor: title ? "hsl(var(--primary))" : "hsl(var(--border))" }}
            />

            <div className="flex justify-end mt-auto">
              <button disabled={!title.trim()} onClick={() => goTo("q2")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── Q2: Horas de trabalho ─────────────────────────────────────────── */}
        {step === "q2" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-6" style={{ minHeight: 340 }}>
            <div>
              <p className="text-4xl font-black leading-none tracking-tight">quanto<br />tempo?</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2">informe quanto tempo de edição será necessário para sua tarefa ser executada</p>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {HOUR_PRESETS.map(p => (
                <button key={p.value}
                  onClick={() => { setEffortHours(p.value); setUseCustom(false); setCustomHours(""); }}
                  className="h-14 rounded-2xl text-sm font-black transition-all"
                  style={!useCustom && effortHours === p.value
                    ? { background: "hsl(var(--primary))", color: "white" }
                    : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                  {p.label}
                </button>
              ))}
              <button onClick={() => setUseCustom(true)}
                className="h-14 rounded-2xl text-sm font-black transition-all"
                style={useCustom
                  ? { background: "hsl(var(--primary))", color: "white" }
                  : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                outro
              </button>
            </div>

            {useCustom && (
              <div className="flex items-end gap-3">
                <input
                  type="number" min={0.5} max={400} step={0.5}
                  value={customHours}
                  onChange={e => setCustomHours(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-24 h-12 px-0 text-4xl font-black text-center border-0 border-b-2 bg-transparent focus:outline-none transition-colors"
                  style={{ borderBottomColor: customHours ? "hsl(var(--primary))" : "hsl(var(--border))" }}
                />
                <span className="text-base text-[hsl(var(--muted-foreground))] pb-1">horas</span>
              </div>
            )}

            {activeHours >= 4 && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                <span className="text-xs font-black px-2 py-0.5 rounded-full"
                  style={{ background: "hsl(var(--primary)/0.10)", color: "hsl(var(--primary))" }}>
                  {activeHours < 8
                    ? "meio dia"
                    : activeHours % 8 === 0
                      ? `${activeHours / 8} ${activeHours / 8 === 1 ? "dia" : "dias"}`
                      : activeHours % 8 === 4
                        ? `${Math.floor(activeHours / 8)} dia${Math.floor(activeHours / 8) > 1 ? "s" : ""} e meio`
                        : `${Math.floor(activeHours / 8)}d ${activeHours % 8}h`}
                </span>
                <span className="ml-2 text-xs">de trabalho</span>
              </p>
            )}

            <div className="flex justify-between mt-auto">
              <button onClick={() => goTo("q1")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button disabled={activeHours <= 0} onClick={() => goTo("q3")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── Q3: Data de início ────────────────────────────────────────────── */}
        {step === "q3" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-5" style={{ minHeight: 340 }}>
            <p className="text-4xl font-black leading-none tracking-tight">quando<br />começa?</p>

            <div className="flex flex-col gap-2">
              {/* Auto */}
              <button onClick={() => setStartMode("auto")}
                className="w-full text-left rounded-2xl p-4 transition-all"
                style={startMode === "auto"
                  ? { background: "hsl(var(--primary))", color: "white" }
                  : { background: "hsl(var(--muted))" }}>
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-black">mais cedo possível</p>
                  </div>
                </div>
              </button>

              {/* Manual */}
              <div onClick={() => setStartMode("manual")}
                className="w-full rounded-2xl p-4 transition-all cursor-pointer"
                style={startMode === "manual"
                  ? { background: "hsl(var(--primary)/0.08)", outline: "2px solid hsl(var(--primary))" }
                  : { background: "hsl(var(--muted))" }}>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 shrink-0" style={{
                    color:   startMode === "manual" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                    opacity: 0.7,
                  }} />
                  <p className="text-sm font-black">eu escolho a data</p>
                </div>
                {startMode === "manual" && (
                  <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
                    <DatePicker
                      value={startDate}
                      minDate={earliestStartDate()}
                      onChange={v => {
                        setStartDate(v);
                        if (deadline && v > deadline) setDeadline("");
                        if (v === today() && !workdayOver()) setStartTime(t => t < minTimeNow() ? minTimeNow() : t);
                      }}
                      placeholder="DD/MM/AAAA"
                    />
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <TimePicker value={startTime} onChange={setStartTime} label="horário" options={startTimeOptions} />
                      </div>
                      <button onClick={() => { setStartDate(earliestStartDate()); setStartTime(workdayOver() ? "08:00" : minTimeNow()); }}
                        className="h-9 px-4 rounded-full text-xs font-black shrink-0 tracking-wide"
                        style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
                        agora
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between mt-auto">
              <button onClick={() => goTo("q2")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button
                disabled={!startMode || (startMode === "manual" && !startDate)}
                onClick={() => goTo("q4")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── Q4: Prazo de entrega ──────────────────────────────────────────── */}
        {step === "q4" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-5" style={{ minHeight: 340 }}>
            <p className="text-4xl font-black leading-none tracking-tight">quando precisa<br />estar pronto?</p>

            <div className="flex flex-col gap-2">
              {/* Urgente */}
              <button onClick={() => setDeadlineMode("urgent")}
                className="w-full text-left rounded-2xl p-4 transition-all"
                style={deadlineMode === "urgent"
                  ? { background: "hsl(var(--primary))", color: "white" }
                  : { background: "hsl(var(--muted))" }}>
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 shrink-0" style={{ opacity: deadlineMode === "urgent" ? 1 : 0.5 }} />
                  <p className="text-sm font-black">o mais rápido</p>
                </div>
              </button>

              {/* Data do cliente */}
              <div onClick={() => setDeadlineMode("client")} className="w-full rounded-2xl p-4 transition-all cursor-pointer"
                style={deadlineMode === "client"
                  ? { background: "hsl(var(--primary)/0.08)", outline: "2px solid hsl(var(--primary))" }
                  : { background: "hsl(var(--muted))" }}>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 shrink-0" style={{
                    color: deadlineMode === "client" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                    opacity: 0.7,
                  }} />
                  <p className="text-sm font-black">data do cliente</p>
                </div>
                {deadlineMode === "client" && (
                  <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
                    <DatePicker value={deadline} onChange={setDeadline} minDate={minDeadline} placeholder="DD/MM/AAAA" />
                    <TimePicker value={deadlineTime} onChange={setDeadlineTime} label="horário limite" />
                  </div>
                )}
              </div>

              {/* Sem prazo */}
              <button onClick={() => setDeadlineMode("open")}
                className="w-full text-left rounded-2xl p-4 transition-all"
                style={deadlineMode === "open"
                  ? { background: "hsl(var(--primary)/0.08)", outline: "2px solid hsl(var(--primary))" }
                  : { background: "hsl(var(--muted))" }}>
                <div className="flex items-center gap-3">
                  <Timer className="h-4 w-4 shrink-0" style={{
                    color: deadlineMode === "open" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                    opacity: 0.7,
                  }} />
                  <div>
                    <p className="text-sm font-black">sem prazo</p>
                    <p className="text-xs mt-0.5 text-[hsl(var(--muted-foreground))]">
                      {deadlineMode === "open"
                        ? `janela de ${calcOpenWindow(activeHours)} dias úteis`
                        : "janela proporcional ao esforço"}
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-between mt-auto">
              <button onClick={() => goTo("q3")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button
                disabled={!deadlineMode || (deadlineMode === "client" && !deadline)}
                onClick={() => goTo(deadlineMode === "client" ? "q6" : "q5")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── Q6: Revisão ──────────────────────────────────────────────────── */}
        {step === "q6" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-5" style={{ minHeight: 340 }}>
            <div>
              <p className="text-4xl font-black leading-none tracking-tight">margem de<br />aprovação?</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2">quanto antes do prazo do cliente o editor precisa entregar ao coordenador?</p>
            </div>

            <div className="flex flex-col gap-2">
              {reviewOptions.map(opt => (
                <button key={opt.hours}
                  onClick={() => setReviewHours(opt.hours)}
                  className="w-full text-left rounded-2xl p-4 transition-all"
                  style={reviewHours === opt.hours
                    ? { background: "hsl(var(--primary))", color: "white" }
                    : { background: "hsl(var(--muted))" }}>
                  <p className="text-sm font-black">{opt.label}</p>
                  <p className="text-xs mt-0.5" style={{ opacity: 0.65 }}>{opt.sub}</p>
                </button>
              ))}
            </div>

            <div className="flex justify-between mt-auto">
              <button onClick={() => goTo("q4")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button onClick={() => goTo("q5")}
                className="h-11 px-7 rounded-full text-sm font-black text-white tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── Q5: Editor preferido ──────────────────────────────────────────── */}
        {step === "q5" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-5" style={{ minHeight: 340 }}>
            <div>
              <p className="text-4xl font-black leading-none tracking-tight">algum editor<br />preferido?</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2">se não, o escala decide</p>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]/50" />
                <input value={editorSearch} onChange={e => setEditorSearch(e.target.value)}
                  placeholder="buscar pelo nome…"
                  className="w-full h-10 pl-9 pr-3 text-sm rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]" />
              </div>
              {prefEditorId && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl"
                  style={{ background: "hsl(var(--primary)/0.08)", outline: "1.5px solid hsl(var(--primary)/0.3)" }}>
                  <AvatarCircle name={editors.find(e => e.id === prefEditorId)?.name ?? ""} avatarUrl={editors.find(e => e.id === prefEditorId)?.avatarUrl ?? null} size={28} />
                  <span className="text-sm font-black flex-1">{editors.find(e => e.id === prefEditorId)?.name}</span>
                  <button onClick={() => { setPrefEditorId(null); setEditorSearch(""); }}
                    className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
                    ✕
                  </button>
                </div>
              )}
              {editorSearch && !prefEditorId && (
                <div className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden max-h-44 overflow-y-auto">
                  {filteredEditors.length === 0
                    ? <p className="text-sm text-[hsl(var(--muted-foreground))] px-4 py-3">nenhum editor encontrado</p>
                    : filteredEditors.map(e => (
                      <button key={e.id}
                        onClick={() => { setPrefEditorId(e.id); setEditorSearch(""); }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted))] transition-colors text-left">
                        <AvatarCircle name={e.name} avatarUrl={e.avatarUrl} size={28} />
                        <span className="text-sm font-medium">{e.name}</span>
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
            <div className="flex justify-between mt-auto">
              <button onClick={() => goTo(deadlineMode === "client" ? "q6" : "q4")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button onClick={() => goTo("review")}
                className="h-11 px-7 rounded-full text-sm font-black text-white tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                revisar →
              </button>
            </div>
          </div>
        )}

        {/* ── Review ───────────────────────────────────────────────────────── */}
        {step === "review" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-6">
            <p className="text-4xl font-black leading-none tracking-tight">tudo ok?</p>

            <div className="space-y-0">
              {([
                { label: "tarefa",  value: title,                              goto: "q1" },
                { label: "esforço", value: fmtHours(activeHours),              goto: "q2" },
                { label: "início",  value: startMode === "auto" ? "mais cedo possível" : `${fmtDate(startDate)} · ${startTime}`, goto: "q3" },
                {
                  label: "prazo",
                  value: deadlineMode === "urgent"
                    ? `mais rápido ≈ ${calcMinCompletion(startDate, startTime, activeHours)}`
                    : deadlineMode === "open"
                    ? `sem prazo · ${calcOpenWindow(activeHours)} dias úteis`
                    : `${fmtDate(deadline)} · ${deadlineTime}`,
                  goto: "q4",
                },
                ...(deadlineMode === "client" ? [{
                  label: "aprovação",
                  value: fmtReviewHours(reviewHours),
                  goto:  "q6",
                }] : []),
                {
                  label: "editor",
                  value: prefEditorId ? (editors.find(e => e.id === prefEditorId)?.name ?? "—") : "qualquer",
                  goto:  "q5",
                },
              ] as { label: string; value: string; goto: string }[]).map(row => (
                <div key={row.label} className="flex items-center gap-3 py-3 border-b border-[hsl(var(--border))]/50 last:border-0">
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50 w-12 shrink-0">
                    {row.label}
                  </span>
                  <span className="text-sm font-medium flex-1 truncate">{row.value}</span>
                  <button onClick={() => goTo(row.goto as QuizStep)}
                    className="text-[10px] font-black uppercase tracking-widest shrink-0 transition-opacity hover:opacity-60"
                    style={{ color: "hsl(var(--primary))" }}>
                    editar
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button onClick={() => goTo("q5")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button onClick={runAlgorithm}
                className="h-11 px-7 rounded-full text-sm font-black text-white tracking-wide flex items-center gap-2"
                style={{ background: "hsl(var(--primary))" }}>
                calcular
              </button>
            </div>
          </div>
        )}

        {/* ── Window Infeasible ─────────────────────────────────────────────── */}
        {step === "window-infeasible" && result && (() => {
          const fitsH     = result.windowCapacityHours ?? 0;
          const gapH      = roundH(activeHours - fitsH);
          const minDate   = result.theoreticalMinDeadline
            ? new Date(result.theoreticalMinDeadline + "T12:00:00").toLocaleDateString("pt-BR")
            : "—";
          const startLabel = startMode === "auto"
            ? `mais cedo possível · ${effectiveStartTime}`
            : `${fmtDate(effectiveStartDate)} · ${effectiveStartTime}`;
          // gapH pode ser <= 0 quando o estouro é mínimo (ex: início 08:30 → só 7h30 cabem no dia)
          const tinyOverflow = gapH <= 0;

          return (
            <div className="flex flex-col px-7 py-8" style={{ minHeight: 340, gap: 20 }}>

              {/* Headline */}
              <p className="font-black leading-tight tracking-tight" style={{ fontSize: 28 }}>
                {tinyOverflow
                  ? <>o prazo não<br />comporta o início.</>
                  : <>{fmtHours(activeHours)} de esforço<br />ultrapassam o prazo.</>
                }
              </p>

              {/* Contexto */}
              <div className="flex flex-col gap-1 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                <div className="flex justify-between">
                  <span>início</span>
                  <span className="font-black" style={{ color: "hsl(var(--foreground))" }}>
                    {startLabel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>horas de trabalho</span>
                  <span className="font-black" style={{ color: "hsl(var(--foreground))" }}>
                    {fmtHours(activeHours)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>prazo do cliente</span>
                  <span className="font-black" style={{ color: "hsl(var(--foreground))" }}>
                    {fmtDate(deadline)} · {deadlineTime}
                  </span>
                </div>
                {deadlineMode === "client" && reviewHours > 0 && (
                  <div className="flex justify-between">
                    <span>margem de aprovação</span>
                    <span className="font-black" style={{ color: "#f59e0b" }}>
                      − {fmtReviewHours(reviewHours)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>cabe nessa janela</span>
                  <span className="font-black" style={{ color: "hsl(var(--foreground))" }}>
                    {fmtHours(fitsH)}
                  </span>
                </div>
              </div>

              {/* O que falta / contexto de estouro mínimo */}
              {tinyOverflow ? (
                <div className="rounded-2xl px-4 py-3 text-sm"
                  style={{ background: "hsl(var(--muted))" }}>
                  Com início às <strong>{effectiveStartTime}</strong> a janela disponível é de{" "}
                  <strong>{fmtHours(fitsH)}</strong> — menos do que as{" "}
                  <strong>{fmtHours(activeHours)}</strong> necessárias.
                </div>
              ) : (
                <div className="rounded-2xl px-4 py-3 flex justify-between items-center"
                  style={{ background: "hsl(var(--muted))" }}>
                  <span className="text-sm font-medium">faltam</span>
                  <span className="font-black text-lg">{fmtHours(gapH)}</span>
                </div>
              )}

              {/* Sugestão */}
              <div className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Ajuste o prazo para{" "}
                <span className="font-black" style={{ color: "hsl(var(--foreground))" }}>
                  {minDate}
                </span>{" "}
                ou reduza as horas de trabalho.
              </div>

              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => goTo("q2")}
                  className="h-11 flex-1 rounded-full text-sm font-black tracking-wide border border-[hsl(var(--border))]"
                  style={{ color: "hsl(var(--foreground))" }}>
                  reduzir horas
                </button>
                <button
                  onClick={() => goTo("q4")}
                  className="h-11 flex-1 rounded-full text-sm font-black text-white tracking-wide"
                  style={{ background: "hsl(var(--primary))" }}>
                  ajustar prazo
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Searching ─────────────────────────────────────────────────────── */}
        {step === "searching" && (
          <div className="flex items-center justify-center px-6 py-16" style={{ minHeight: 340 }}>
            <div className="relative h-48 w-48">
              {/* trilha */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 160 160" fill="none">
                <circle cx="80" cy="80" r="68" strokeWidth="6"
                  stroke="hsl(var(--primary)/0.10)" />
              </svg>
              {/* arco girando */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 animate-spin [animation-duration:1.6s]" viewBox="0 0 160 160" fill="none">
                <circle cx="80" cy="80" r="68" strokeWidth="6"
                  stroke="hsl(var(--primary))"
                  strokeLinecap="round"
                  strokeDasharray="427.3"
                  strokeDashoffset="320.5" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-1 px-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em]"
                  style={{ color: "hsl(var(--primary)/0.65)" }}>aguarde</p>
                <p className="text-sm font-black leading-snug">mapeando a<br />agenda do time…</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Results ───────────────────────────────────────────────────────── */}
        {step === "results" && result && (
          <div className="flex flex-col" style={mode === "modal" ? { maxHeight: "calc(90vh - 68px)" } : undefined}>

            {/* Barra de contexto */}
            <div className="px-5 py-3 border-b border-[hsl(var(--border))] flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="font-black text-[hsl(var(--foreground))]">{fmtHours(activeHours)}</span>
              <span>
                {startMode === "auto" ? "· mais cedo possível" : `· ${fmtDateTime(effectiveStartDate, effectiveStartTime)}`}
                {deadlineMode === "client" && deadline ? ` → ${fmtDateTime(deadline, deadlineTime)}` : ""}
              </span>
              {deadlineMode === "client" && reviewHours > 0 && (
                <span className="ml-auto font-bold px-2 py-0.5 rounded-md text-[10px]"
                  style={{ background: "hsl(var(--primary)/0.10)", color: "hsl(var(--primary))" }}>
                  {fmtReviewHours(reviewHours)}
                </span>
              )}
            </div>

            {/* Grid de cards */}
            <div className={`p-4 ${mode === "modal" ? "overflow-y-auto flex-1 space-y-2" : "grid gap-3"}`}
              style={mode === "page" ? { gridTemplateColumns: "repeat(2, 1fr)" } : undefined}>

              {allOptions.length === 0 && (
                <p className="text-sm text-[hsl(var(--muted-foreground))] py-8 text-center col-span-full">nenhum editor cadastrado.</p>
              )}

              {allOptions.map((opt, idx) => {
                const isSel    = selected?.editor.id === opt.editor.id;
                const isTarget = result.target?.editor.id === opt.editor.id;
                return (
                  <button key={opt.editor.id}
                    onClick={() => opt.possible && setSelected(opt)}
                    disabled={!opt.possible}
                    className="w-full text-left rounded-2xl flex flex-col transition-all"
                    style={isSel
                      ? { background: "hsl(var(--primary)/0.08)", outline: "2px solid hsl(var(--primary))" }
                      : opt.possible
                        ? { background: "hsl(var(--muted)/0.6)" }
                        : { background: "hsl(var(--muted)/0.3)", opacity: 0.45 }
                    }>

                    {/* Header do card */}
                    <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                      <div className="h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors"
                        style={{ borderColor: isSel ? "hsl(var(--primary))" : "hsl(var(--muted-foreground)/0.3)" }}>
                        {isSel && <div className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--primary))" }} />}
                      </div>
                      <AvatarCircle name={opt.editor.name} avatarUrl={opt.editor.avatarUrl} size={38} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-sm leading-tight truncate">{opt.editor.name}</p>
                        <div className="flex gap-1.5 mt-0.5 flex-wrap">
                          {isTarget && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide"
                              style={{ background: "hsl(var(--primary)/0.12)", color: "hsl(var(--primary))" }}>
                              preferido
                            </span>
                          )}
                          {idx === 0 && !isTarget && opt.possible && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide"
                              style={{ background: "#22c55e18", color: "#16a34a" }}>
                              + rápido
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Corpo do card */}
                    {opt.possible ? (
                      <>
                        <div className="px-4 pb-2 border-t border-[hsl(var(--border)/0.5)] pt-3">
                          <p className="text-[9px] font-black uppercase tracking-widest mb-0.5"
                            style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>entrega até</p>
                          <p className="text-base font-black leading-tight">{fmtDate(opt.projectedCompletion!)}</p>
                        </div>
                        <div className="px-4 pb-4 pt-2">
                          <SlotChips slots={opt.slots} />
                        </div>
                      </>
                    ) : (
                      <div className="px-4 pb-4 pt-2 border-t border-[hsl(var(--border)/0.5)]">
                        <p className="text-xs flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          {opt.hoursFound > 0
                            ? `só ${fmtHours(opt.hoursFound)} de ${fmtHours(opt.hoursNeeded)} disponíveis`
                            : "sem disponibilidade no período"}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}

              {!allOptions.some(o => o.possible) && (
                <div className="flex items-start gap-2 text-xs rounded-2xl px-4 py-3 col-span-full"
                  style={{ background: "#fef3c720", color: "#92400e", border: "1px solid #fde68a50" }}>
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  nenhum editor disponível. tente ampliar o prazo ou reduzir as horas.
                </div>
              )}
            </div>

            <div className="flex justify-between px-4 py-3 border-t border-[hsl(var(--border))] shrink-0">
              <button onClick={() => goTo("q5")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← ajustar
              </button>
              <button disabled={!selected?.possible} onClick={() => goTo("confirm")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                confirmar →
              </button>
            </div>
          </div>
        )}

        {/* ── Confirm ───────────────────────────────────────────────────────── */}
        {/* ── Conflict ──────────────────────────────────────────────────────── */}
        {step === "conflict" && conflictData && selected && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-4" style={{ minHeight: 340 }}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
              <div>
                <p className="text-2xl font-black leading-tight">conflito<br />de agenda</p>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
                  {selected.editor.name.split(" ")[0]} já tem tarefas nesse horário.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {conflictData.map(c => (
                <div key={c.taskId} className="rounded-2xl p-3.5 flex items-start gap-3"
                  style={{
                    background:  "hsl(var(--muted)/0.7)",
                    borderLeft:  "3px solid hsl(var(--primary))",
                  }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{c.title}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                      {c.coordinatorName}
                      {c.slots.length > 0 && ` · ${c.slots.map(s => `${fmtWeekDay(s.date)} ${s.startTime}–${s.endTime}`).join(", ")}`}
                    </p>
                  </div>
                  {c.dueDate && (
                    <span className="text-[10px] shrink-0 text-[hsl(var(--muted-foreground))] mt-0.5">
                      prazo {fmtDate(c.dueDate)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2 mt-auto">
              <button
                onClick={previewDisplacement}
                disabled={saving}
                className="w-full text-left rounded-2xl p-4 transition-all flex items-center gap-3 disabled:opacity-50"
                style={{ background: "hsl(var(--primary)/0.08)", outline: "1.5px solid hsl(var(--primary)/0.3)" }}>
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: "hsl(var(--primary))" }} />
                  : null
                }
                <div>
                  <p className="text-sm font-black">reagendar automaticamente</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">o escala encontra novos slots para as tarefas conflitantes</p>
                </div>
              </button>
              <button
                onClick={() => { setConflictData(null); goTo("results"); }}
                className="w-full text-left rounded-2xl p-4 transition-all hover:opacity-80"
                style={{ background: "hsl(var(--muted))" }}>
                <p className="text-sm font-black">escolher outro editor</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">voltar para a lista de editores</p>
              </button>
            </div>

            <button
              onClick={() => { setConflictData(null); goTo("confirm"); }}
              className="text-xs text-center transition-colors hover:opacity-60"
              style={{ color: "hsl(var(--muted-foreground)/0.55)" }}>
              ← cancelar e voltar
            </button>
          </div>
        )}

        {/* ── Displacement Preview ──────────────────────────────────────────── */}
        {step === "displacement-preview" && displacementPlan && selected && (
          <div className="flex flex-col" style={mode === "modal" ? { maxHeight: "calc(90vh - 68px)" } : undefined}>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">

              <div>
                <p className="text-2xl font-black leading-tight">plano de<br />reagendamento</p>
                {displacementPlan.feasible
                  ? <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">todos os prazos serão respeitados</p>
                  : (
                    <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "#ef4444" }}>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      algumas tarefas não cabem no prazo — reagendamento bloqueado
                    </p>
                  )
                }
              </div>

              {/* Nova tarefa */}
              <div className="rounded-2xl p-4"
                style={{ background: "hsl(var(--primary)/0.07)", outline: "1px solid hsl(var(--primary)/0.2)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-2">sua tarefa</p>
                <div className="flex items-center gap-2 mb-1.5">
                  <AvatarCircle name={selected.editor.name} avatarUrl={selected.editor.avatarUrl} size={24} />
                  <p className="text-sm font-black truncate">{title}</p>
                </div>
                <SlotChips slots={selected.slots} />
              </div>

              {/* Cascata */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  tarefas reagendadas ({displacementPlan.cascade.length})
                </p>
                {displacementPlan.cascade.map(c => (
                  <div key={c.taskId} className="rounded-2xl p-3.5"
                    style={{
                      background:  c.possible ? "hsl(var(--muted)/0.6)" : "#fef2f220",
                      borderLeft:  `3px solid ${c.possible ? "hsl(var(--primary))" : "#ef4444"}`,
                      outline:     c.possible ? "none" : "1px solid #ef444430",
                    }}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-black truncate">{c.title}</p>
                      <span className="text-[10px] shrink-0 font-bold mt-0.5"
                        style={{ color: c.possible ? "#16a34a" : "#ef4444" }}>
                        {c.possible ? "✓ ok" : "✗ sem slot"}
                      </span>
                    </div>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] mb-2">
                      {c.coordinatorName}{c.dueDate ? ` · prazo ${fmtDate(c.dueDate)}` : ""}
                    </p>
                    {c.possible ? (
                      <>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] line-through">
                          {c.originalSlots.map(s => `${fmtWeekDay(s.date)} ${s.startTime}–${s.endTime}`).join(" · ")}
                        </p>
                        <p className="text-[10px] font-semibold mt-0.5"
                          style={{ color: "hsl(var(--primary))" }}>
                          {c.newSlots.map(s => `${fmtWeekDay(s.date)} ${s.startTime}–${s.endTime}`).join(" · ")}
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px]" style={{ color: "#ef4444" }}>não é possível encaixar antes do prazo</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between px-5 py-4 border-t border-[hsl(var(--border))] shrink-0">
              <button onClick={() => goTo("conflict")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button
                onClick={confirmDisplacement}
                disabled={!displacementPlan.feasible || saving}
                className="h-11 px-6 rounded-full text-sm font-black text-white disabled:opacity-30 flex items-center gap-2 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> aplicando…</>
                  : <>confirmar reagendamento</>
                }
              </button>
            </div>
          </div>
        )}

        {step === "confirm" && selected && (
          <div className="flex flex-col" style={mode === "modal" ? { maxHeight: "calc(90vh - 68px)" } : undefined}>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-5">

              {/* Resumo */}
              <div className="rounded-2xl p-4 flex items-start gap-3"
                style={{ background: "hsl(var(--primary)/0.06)", outline: "1px solid hsl(var(--primary)/0.15)" }}>
                <AvatarCircle name={selected.editor.name} avatarUrl={selected.editor.avatarUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-black text-sm">{selected.editor.name}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    {fmtHours(activeHours)} · entrega até{" "}
                    <strong className="text-[hsl(var(--foreground))]">
                      {selected.projectedCompletion ? fmtDate(selected.projectedCompletion) : "—"}
                    </strong>
                  </p>
                  <SlotChips slots={selected.slots} />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">tarefa</p>
                <p className="text-sm font-medium px-3 py-2.5 rounded-xl"
                  style={{ background: "hsl(var(--muted)/0.5)" }}>{title}</p>
              </div>

              {/* Cliente — combobox */}
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">
                  cliente
                </p>
                <div className="relative">
                  <input
                    value={clientSearch || client}
                    onChange={e => { setClientSearch(e.target.value); setClient(""); setClientOpen(true); }}
                    onFocus={() => setClientOpen(true)}
                    onBlur={() => setTimeout(() => setClientOpen(false), 150)}
                    placeholder="buscar ou criar cliente…"
                    className="w-full h-10 px-3 text-sm rounded-xl border bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]"
                    style={{ borderColor: client ? "hsl(var(--primary)/0.4)" : "hsl(var(--border))" }}
                  />
                  {clientOpen && (clientSearch || !client) && (
                    <div className="absolute z-20 w-full mt-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg overflow-hidden max-h-44 overflow-y-auto">
                      {clients
                        .filter(c => c.name.toLowerCase().includes((clientSearch || "").toLowerCase()))
                        .map(c => (
                          <button key={c.id} type="button"
                            onMouseDown={() => { setClient(c.name); setClientSearch(""); setClientOpen(false); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors">
                            {c.name}
                          </button>
                        ))
                      }
                      {clientSearch && !clients.some(c => c.name.toLowerCase() === clientSearch.toLowerCase()) && (
                        <button type="button"
                          onMouseDown={() => { setClient(clientSearch); setClientSearch(""); setClientOpen(false); }}
                          className="w-full text-left px-3 py-2 text-sm font-bold transition-colors hover:bg-[hsl(var(--muted))]"
                          style={{ color: "hsl(var(--primary))" }}>
                          + criar "{clientSearch}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Descrição */}
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">briefing</p>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="descreve o que precisa ser feito…" rows={3}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]" />
              </div>

              {/* Pasta / link dos arquivos */}
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">pasta / link dos arquivos</p>
                <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)}
                  placeholder="https://drive.google.com/…"
                  className="w-full h-10 px-3 text-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]" />
              </div>

              {/* Prioridade */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]/50">prioridade</p>
                <div className="flex gap-2">
                  {PRIORITY_OPTS.map(p => (
                    <button key={p.value} onClick={() => setPriority(p.value)}
                      className="flex-1 h-10 rounded-xl text-xs font-black transition-all"
                      style={priority === p.value
                        ? { background: "hsl(var(--primary))", color: "white" }
                        : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>


            </div>

            <div className="flex justify-between px-5 py-4 border-t border-[hsl(var(--border))] shrink-0">
              <button onClick={() => goTo("results")}
                className="h-11 px-5 rounded-full text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors">
                ← voltar
              </button>
              <button onClick={createTask} disabled={saving}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-60 flex items-center gap-2 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> criando…</>
                  : <><Calendar className="h-4 w-4" /> criar tarefa</>}
              </button>
            </div>
          </div>
        )}
  </>);

  if (mode === "page") {
    if (!open) return null;
    const isWideStep = step === "results";
    return (
      <div className={`w-full ${isWideStep ? "" : "max-w-md mx-auto"}`}>
        {inner}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md w-full p-0 overflow-hidden gap-0"
        style={{ maxHeight: "90vh" }}>
        <DialogTitle className="sr-only">Planejar tarefa</DialogTitle>
        {inner}
      </DialogContent>
    </Dialog>
  );
}
