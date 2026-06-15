/**
 * AgendaDragModal — criação de tarefa a partir do drag na agenda individual.
 * Visual: card rounded-3xl idêntico ao /planejar.
 * Steps dedicados ao drag: os dados de scheduling já vêm do arraste.
 */
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, apiPost } from "@/lib/api";
import { localISOString } from "@/lib/date";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Calendar } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";

// ── Tipos internos ────────────────────────────────────────────────────────────

interface HourSlot { date: string; hours: number; startTime?: string; endTime?: string; }

interface ConflictInfo {
  taskId:          number;
  title:           string;
  client:          string | null;
  dueDate:         string | null;
  coordinatorName: string;
  effortHours:     number | null;
  slots:           { date: string; startTime: string; endTime: string; hours: number }[];
}

interface EditorOption {
  editor:              { id: number; name: string; avatarUrl: string | null };
  possible:            boolean;
  slots:               HourSlot[];
  projectedCompletion: string | null;
  hoursFound:          number;
  hoursNeeded:         number;
}

interface EscalaResult {
  target:                 EditorOption | null;
  alternatives:           EditorOption[];
  windowFeasible:         boolean;
  windowCapacityHours:    number;
  theoreticalMinDeadline: string | null;
  calculatedDeadline:     string | null;
  windowDays:             number;
}

interface DisplacementItem {
  taskId:          number;
  title:           string;
  coordinatorName: string;
  dueDate:         string | null;
  originalSlots:   HourSlot[];
  newSlots:        HourSlot[];
  possible:        boolean;
}

interface DisplacementPlan { feasible: boolean; cascade: DisplacementItem[]; }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:         boolean;
  onClose:      () => void;
  onCreated:    () => void;
  editorId:     number;
  editorName:   string;
  editorAvatar: string | null;
  date:         string;   // YYYY-MM-DD
  startTime:    string;   // "HH:MM"
  endTime:      string;   // "HH:MM"
  effortHours:  number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_OPTS = [
  { value: "high",   label: "Alta"  },
  { value: "medium", label: "Média" },
  { value: "low",    label: "Baixa" },
];

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function fmtWeekDay(d: string) {
  return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][new Date(d + "T12:00:00").getDay()];
}
function fmtH(h: number) {
  const t = Math.round(h * 60), hr = Math.floor(t / 60), mn = t % 60;
  if (hr === 0) return `${mn}min`;
  if (mn === 0) return `${hr}h`;
  return `${hr}h${mn}`;
}

function Avatar({ name, avatarUrl, size = 32 }: { name: string; avatarUrl: string | null; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  if (avatarUrl) return (
    <img src={avatarUrl} alt={name} className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }} />
  );
  return (
    <div className="rounded-full flex items-center justify-center shrink-0 font-black text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: "#6366f1" }}>
      {initials}
    </div>
  );
}

// ── Componente ────────────────────────────────────────────────────────────────

type Step = "title" | "deadline" | "confirm" | "searching" | "conflict" | "displacement";

export function AgendaDragModal({
  open, onClose, onCreated,
  editorId, editorName, editorAvatar,
  date, startTime, endTime, effortHours,
}: Props) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("title");

  // Form
  const [title,           setTitle]          = useState("");
  const [client,          setClient]         = useState("");
  const [clientSearch,    setClientSearch]   = useState("");
  const [clientOpen,      setClientOpen]     = useState(false);
  const [description,     setDescription]    = useState("");
  const [folderUrl,       setFolderUrl]      = useState("");
  const [priority,        setPriority]       = useState("medium");
  const [clientDeadline,  setClientDeadline] = useState("");  // prazo do cliente (dueDate)
  const [saving,          setSaving]         = useState(false);

  // Data
  const [clients,         setClients]        = useState<{ id: number; name: string }[]>([]);
  const [selected,        setSelected]       = useState<EditorOption | null>(null);
  const [conflictData,    setConflictData]   = useState<ConflictInfo[] | null>(null);
  const [displacement,    setDisplacement]   = useState<DisplacementPlan | null>(null);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setStep("title");
    setTitle(""); setClient(""); setClientSearch(""); setClientOpen(false);
    setDescription(""); setFolderUrl(""); setPriority("medium"); setClientDeadline("");
    setSaving(false); setSelected(null); setConflictData(null); setDisplacement(null);
    apiFetch<{ id: number; name: string }[]>("/api/clients").then(setClients).catch(() => {});
    setTimeout(() => titleInputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (step === "title") setTimeout(() => titleInputRef.current?.focus(), 80);
  }, [step]);

  // ── ESCALA ────────────────────────────────────────────────────────────────

  const runCreate = async () => {
    if (!client.trim())      { toast.error("Informe o cliente"); return; }
    if (!description.trim()) { toast.error("Informe o briefing"); return; }
    if (!folderUrl.trim())   { toast.error("Informe a pasta ou link dos arquivos"); return; }

    setSaving(true);
    setStep("searching");
    try {
      const params = new URLSearchParams({
        effortHours: String(effortHours),
        startDate:   localISOString(date, startTime),
        mode:        "client",
        deadline:    localISOString(date, endTime),
        editorId:    String(editorId),
      });

      const data = await apiFetch<EscalaResult>(`/api/escala/options?${params}`);

      const opt = data.target?.possible
        ? data.target
        : data.alternatives.find(a => a.editor.id === editorId && a.possible) ?? null;

      if (!opt) {
        toast.error("Editor sem disponibilidade nesse horário.");
        setStep("confirm");
        return;
      }
      setSelected(opt);

      // Pre-flight de conflito
      const slotsWithTimes = opt.slots.filter(s => s.startTime && s.endTime) as
        { date: string; startTime: string; endTime: string }[];
      if (slotsWithTimes.length > 0) {
        const check = await apiPost<{ hasConflicts: boolean; conflicts: ConflictInfo[] }>(
          "/api/escala/check-conflicts",
          { editorId: opt.editor.id, slots: slotsWithTimes },
        );
        if (check.hasConflicts) {
          setConflictData(check.conflicts);
          setStep("conflict");
          return;
        }
      }

      await commitTask(opt);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
      setStep("confirm");
    } finally {
      setSaving(false);
    }
  };

  const commitTask = async (opt: EditorOption) => {
    const firstSlot = opt.slots[0];
    if (client.trim()) await apiPost("/api/clients", { name: client.trim() }).catch(() => {});

    const task = await apiPost("/api/tasks", {
      title:         title.trim(),
      description:   description.trim(),
      folderUrl:     folderUrl.trim(),
      client:        client.trim() || null,
      priority,
      assignedToId:  opt.editor.id,
      startDate:     firstSlot ? localISOString(firstSlot.date, firstSlot.startTime ?? startTime) : null,
      dueDate:       clientDeadline ? clientDeadline + "T23:59:59" : localISOString(date, endTime),
      effortHours,
      status:        "pending",
      escalaManaged: true,
    }) as { id: number };

    await apiPost(`/api/escala/tasks/${task.id}/allocate`, {
      editorId:    opt.editor.id,
      slots:       opt.slots,
      effortHours,
    });

    toast.success(`Tarefa criada — ${fmtH(effortHours)} reservado${effortHours !== 1 ? "s" : ""} para ${opt.editor.name.split(" ")[0]}`);
    onCreated();
    onClose();
  };

  const runDisplacementPreview = async () => {
    if (!selected || !conflictData) return;
    setSaving(true);
    try {
      const plan = await apiPost<DisplacementPlan>("/api/escala/preview-displacement", {
        editorId:           selected.editor.id,
        newSlots:           selected.slots,
        conflictingTaskIds: conflictData.map(c => c.taskId),
      });
      setDisplacement(plan);
      setStep("displacement");
    } catch {
      toast.error("Erro ao calcular reagendamento");
    } finally {
      setSaving(false);
    }
  };

  const confirmDisplacement = async () => {
    if (!selected || !displacement) return;
    setSaving(true);
    try {
      const firstSlot = selected.slots[0];
      if (client.trim()) await apiPost("/api/clients", { name: client.trim() }).catch(() => {});

      const task = await apiPost("/api/tasks", {
        title:         title.trim(),
        description:   description.trim(),
        folderUrl:     folderUrl.trim(),
        client:        client.trim() || null,
        priority,
        assignedToId:  selected.editor.id,
        startDate:     firstSlot ? localISOString(firstSlot.date, firstSlot.startTime ?? startTime) : null,
        dueDate:       clientDeadline ? clientDeadline + "T23:59:59" : localISOString(date, endTime),
        effortHours,
        status:        "pending",
        escalaManaged: true,
      }) as { id: number };

      await apiPost("/api/escala/confirm-displacement", {
        newTaskId:          task.id,
        newTaskEffortHours: effortHours,
        editorId:           selected.editor.id,
        newTaskSlots:       selected.slots,
        cascade:            displacement.cascade.map(c => ({ taskId: c.taskId, newSlots: c.newSlots })),
      });

      toast.success(`Tarefa criada com reagendamento de ${displacement.cascade.length} tarefa${displacement.cascade.length !== 1 ? "s" : ""}`);
      onCreated();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao aplicar reagendamento");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // Dots: 0=title, 1=deadline, 2=confirm. Searching/conflict/displacement não mostram dots.
  const dotIdx = step === "title" ? 0 : step === "deadline" ? 1 : step === "confirm" ? 2 : -1;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-md w-full p-0 overflow-hidden gap-0 rounded-3xl border bg-[hsl(var(--card))] [&>button]:hidden"
        style={{ maxHeight: "90vh", boxShadow: "0 24px 64px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.03)" }}>
        <DialogTitle className="sr-only">Nova tarefa</DialogTitle>

        {/* Step dots */}
        {dotIdx >= 0 && (
          <div className="flex items-center justify-end gap-1.5 px-6 pt-5 pb-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-1 rounded-full transition-all duration-300"
                style={{
                  width:      i === dotIdx ? 22 : 5,
                  background: i <= dotIdx
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground)/0.2)",
                }} />
            ))}
          </div>
        )}

        {/* ── title ───────────────────────────────────────────────────────── */}
        {step === "title" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-5" style={{ minHeight: 340 }}>
            <div>
              <p className="text-4xl font-black leading-none tracking-tight">tarefa?</p>
              <p className="text-sm mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                qual é o nome da tarefa?
              </p>
            </div>

            <input
              ref={titleInputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && title.trim() && setStep("deadline")}
              placeholder="ex: edição spot 30s…"
              className="w-full h-12 px-0 text-lg font-medium border-0 border-b-2 bg-transparent focus:outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))]/25"
              style={{ borderBottomColor: title ? "hsl(var(--primary))" : "hsl(var(--border))" }}
            />

            {/* Contexto do arraste */}
            <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              <Avatar name={editorName} avatarUrl={editorAvatar} size={18} />
              <span className="font-black" style={{ color: "hsl(var(--foreground))" }}>
                {editorName.split(" ")[0]}
              </span>
              <span>·</span>
              <span>{fmtWeekDay(date)} {fmtDate(date)}</span>
              <span className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-md"
                style={{ background: "hsl(var(--primary)/0.10)", color: "hsl(var(--primary))" }}>
                {startTime}–{endTime} · {fmtH(effortHours)}
              </span>
            </div>

            <div className="flex justify-end mt-auto">
              <button disabled={!title.trim()} onClick={() => setStep("deadline")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── deadline ────────────────────────────────────────────────────── */}
        {step === "deadline" && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-6" style={{ minHeight: 340 }}>
            <div>
              <p className="text-4xl font-black leading-none tracking-tight">quando<br />entrega?</p>
              <p className="text-sm mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                qual a data limite pra chegar no cliente?
              </p>
            </div>

            <div className="space-y-3">
              <DatePicker
                value={clientDeadline}
                onChange={setClientDeadline}
                placeholder="escolha a data…"
                minDate={date}
                className="h-12 rounded-2xl text-base"
              />
              {clientDeadline && (
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--primary))" }}>
                  {new Date(clientDeadline + "T12:00:00").toLocaleDateString("pt-BR", {
                    weekday: "long", day: "2-digit", month: "long"
                  })}
                </p>
              )}
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>
                o sistema usa isso pra te avisar se tiver atrasando e pra reagendar quando precisar.
              </p>
            </div>

            <div className="flex justify-between mt-auto">
              <button onClick={() => setStep("title")}
                className="h-11 px-5 rounded-full text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                ← voltar
              </button>
              <button
                disabled={!clientDeadline}
                onClick={() => setStep("confirm")}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-30 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                próximo →
              </button>
            </div>
          </div>
        )}

        {/* ── confirm ─────────────────────────────────────────────────────── */}
        {step === "confirm" && (
          <div className="flex flex-col" style={{ maxHeight: "calc(90vh - 68px)" }}>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-5">

              {/* Card resumo */}
              <div className="rounded-2xl overflow-hidden"
                style={{ outline: "1px solid hsl(var(--primary)/0.18)" }}>

                {/* Linha 1 — data do cliente (destaque) */}
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: "hsl(var(--primary)/0.10)" }}>
                  <div className="flex items-baseline gap-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                      style={{ color: "hsl(var(--primary)/0.7)" }}>data do cliente</p>
                    <p className="text-sm font-black" style={{ color: "hsl(var(--primary))" }}>
                      {new Date(clientDeadline + "T12:00:00").toLocaleDateString("pt-BR", {
                        weekday: "long", day: "2-digit", month: "short"
                      })}
                    </p>
                  </div>
                  <button onClick={() => setStep("deadline")}
                    className="text-[10px] font-black uppercase tracking-widest transition-opacity hover:opacity-60"
                    style={{ color: "hsl(var(--primary))" }}>trocar</button>
                </div>

                {/* Linha 2 — job */}
                <div className="flex items-center justify-between px-4 py-3"
                  style={{ background: "hsl(var(--primary)/0.04)", borderTop: "1px solid hsl(var(--primary)/0.10)" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-[0.12em] shrink-0"
                      style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>tarefa</span>
                    <span className="text-sm font-bold truncate">{title}</span>
                  </div>
                  <button onClick={() => setStep("title")}
                    className="text-[10px] font-black uppercase tracking-widest shrink-0 ml-3 transition-opacity hover:opacity-60"
                    style={{ color: "hsl(var(--primary))" }}>trocar</button>
                </div>

                {/* Linha 3 — editor + sessão */}
                <div className="flex items-center gap-3 px-4 py-3"
                  style={{ borderTop: "1px solid hsl(var(--primary)/0.10)" }}>
                  <Avatar name={editorName} avatarUrl={editorAvatar} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">{editorName.split(" ")[0]}</p>
                    <p className="text-[11px] mt-0.5 tabular-nums" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {fmtWeekDay(date)} {fmtDate(date)} · {startTime}–{endTime} · {fmtH(effortHours)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Cliente */}
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                  style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>pra qual cliente?</p>
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

              {/* Briefing */}
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                  style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>briefing</p>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="descreve o job, referências, o que não pode falhar…" rows={3}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]" />
              </div>

              {/* Pasta */}
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                  style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>pasta / arquivos</p>
                <input value={folderUrl} onChange={e => setFolderUrl(e.target.value)}
                  placeholder="https://drive.google.com/…"
                  className="w-full h-10 px-3 text-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]" />
              </div>

              {/* Prioridade */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                  style={{ color: "hsl(var(--muted-foreground)/0.5)" }}>urgência</p>
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
              <button onClick={() => setStep("deadline")}
                className="h-11 px-5 rounded-full text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                ← voltar
              </button>
              <button onClick={runCreate} disabled={saving}
                className="h-11 px-7 rounded-full text-sm font-black text-white disabled:opacity-60 flex items-center gap-2 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> buscando slot…</>
                  : <><Calendar className="h-4 w-4" /> confirmar tarefa</>}
              </button>
            </div>
          </div>
        )}

        {/* ── searching ───────────────────────────────────────────────────── */}
        {step === "searching" && (
          <div className="flex items-center justify-center px-6 py-16" style={{ minHeight: 340 }}>
            <div className="relative h-48 w-48">
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 160 160" fill="none">
                <circle cx="80" cy="80" r="68" strokeWidth="6" stroke="hsl(var(--primary)/0.10)" />
              </svg>
              <svg className="absolute inset-0 w-full h-full -rotate-90 animate-spin [animation-duration:1.6s]"
                viewBox="0 0 160 160" fill="none">
                <circle cx="80" cy="80" r="68" strokeWidth="6"
                  stroke="hsl(var(--primary))" strokeLinecap="round"
                  strokeDasharray="427.3" strokeDashoffset="320.5" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-1 px-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em]"
                  style={{ color: "hsl(var(--primary)/0.65)" }}>aguarde</p>
                <p className="text-sm font-black leading-snug">calculando<br />disponibilidade…</p>
              </div>
            </div>
          </div>
        )}

        {/* ── conflict ────────────────────────────────────────────────────── */}
        {step === "conflict" && conflictData && (
          <div className="px-6 pt-8 pb-6 flex flex-col gap-4" style={{ minHeight: 340 }}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
              <div>
                <p className="text-2xl font-black leading-tight">conflito<br />de agenda</p>
                <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {editorName.split(" ")[0]} já tem tarefas nesse horário.
                </p>
              </div>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto">
              {conflictData.map(c => (
                <div key={c.taskId} className="rounded-2xl p-3.5 flex items-start gap-3"
                  style={{ background: "hsl(var(--muted)/0.7)", borderLeft: "3px solid hsl(var(--primary))" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{c.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {c.coordinatorName}
                      {c.slots.length > 0 && ` · ${c.slots.map(s => `${s.startTime}–${s.endTime}`).join(", ")}`}
                    </p>
                  </div>
                  {c.dueDate && (
                    <span className="text-[10px] shrink-0 mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                      prazo {fmtDate(c.dueDate)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <button onClick={runDisplacementPreview} disabled={saving}
                className="w-full text-left rounded-2xl p-4 transition-all flex items-center gap-3 disabled:opacity-50"
                style={{ background: "hsl(var(--primary)/0.08)", outline: "1.5px solid hsl(var(--primary)/0.3)" }}>
                {saving && <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: "hsl(var(--primary))" }} />}
                <div>
                  <p className="text-sm font-black">reagendar automaticamente</p>
                  <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    o escala encontra novos slots para as tarefas conflitantes
                  </p>
                </div>
              </button>
              <button onClick={onClose}
                className="w-full text-left rounded-2xl p-4 transition-all hover:opacity-80"
                style={{ background: "hsl(var(--muted))" }}>
                <p className="text-sm font-black">escolher outro horário</p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  fechar e arrastar um intervalo diferente
                </p>
              </button>
            </div>
          </div>
        )}

        {/* ── displacement ────────────────────────────────────────────────── */}
        {step === "displacement" && displacement && selected && (
          <div className="flex flex-col" style={{ maxHeight: "calc(90vh - 68px)" }}>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              <div>
                <p className="text-2xl font-black leading-tight">plano de<br />reagendamento</p>
                {displacement.feasible
                  ? <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      todos os prazos serão respeitados
                    </p>
                  : <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "#ef4444" }}>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      algumas tarefas não cabem no prazo — reagendamento bloqueado
                    </p>
                }
              </div>

              {/* Nova tarefa */}
              <div className="rounded-2xl p-4"
                style={{ background: "hsl(var(--primary)/0.07)", outline: "1px solid hsl(var(--primary)/0.2)" }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2"
                  style={{ color: "hsl(var(--muted-foreground))" }}>sua tarefa</p>
                <div className="flex items-center gap-2 mb-1.5">
                  <Avatar name={editorName} avatarUrl={editorAvatar} size={24} />
                  <p className="text-sm font-black truncate">{title}</p>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selected.slots.map(s => (
                    <span key={s.date + (s.startTime ?? "")}
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                      style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))" }}>
                      {fmtWeekDay(s.date)} {fmtDate(s.date)}
                      {s.startTime && s.endTime && (
                        <span className="opacity-75">· {s.startTime}–{s.endTime}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>

              {/* Cascata */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest"
                  style={{ color: "hsl(var(--muted-foreground))" }}>
                  tarefas reagendadas ({displacement.cascade.length})
                </p>
                {displacement.cascade.map(c => (
                  <div key={c.taskId} className="rounded-2xl p-3.5"
                    style={{
                      background:  c.possible ? "hsl(var(--muted)/0.6)" : "#fef2f220",
                      borderLeft:  `3px solid ${c.possible ? "hsl(var(--primary))" : "#ef4444"}`,
                    }}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-black truncate">{c.title}</p>
                      <span className="text-[10px] shrink-0 font-bold mt-0.5"
                        style={{ color: c.possible ? "#16a34a" : "#ef4444" }}>
                        {c.possible ? "✓ ok" : "✗ sem slot"}
                      </span>
                    </div>
                    <p className="text-[10px] mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {c.coordinatorName}{c.dueDate ? ` · prazo ${fmtDate(c.dueDate)}` : ""}
                    </p>
                    {c.possible ? (
                      <>
                        <p className="text-[10px] line-through" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {c.originalSlots.map(s => `${fmtWeekDay(s.date)} ${s.startTime}–${s.endTime}`).join(" · ")}
                        </p>
                        <p className="text-[10px] font-semibold mt-0.5" style={{ color: "hsl(var(--primary))" }}>
                          {c.newSlots.map(s => `${fmtWeekDay(s.date)} ${s.startTime}–${s.endTime}`).join(" · ")}
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px]" style={{ color: "#ef4444" }}>
                        não é possível encaixar antes do prazo
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between px-5 py-4 border-t border-[hsl(var(--border))] shrink-0">
              <button onClick={() => setStep("conflict")}
                className="h-11 px-5 rounded-full text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                ← voltar
              </button>
              <button onClick={confirmDisplacement} disabled={!displacement.feasible || saving}
                className="h-11 px-6 rounded-full text-sm font-black text-white disabled:opacity-30 flex items-center gap-2 tracking-wide"
                style={{ background: "hsl(var(--primary))" }}>
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> aplicando…</>
                  : <>confirmar reagendamento</>}
              </button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
