/**
 * Reagendamento — encontra o tempo de qualquer editor e propõe realocações
 * para coordenadores negociarem entre si.
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch, apiPost, apiPut, apiDelete } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useAuth } from "@/contexts/AuthContext";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { toast } from "sonner";
import {
  ArrowRightLeft, Loader2, X, CheckCircle2, XCircle,
  Clock, AlertTriangle, ChevronRight, Trash2,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface HourSlot {
  date:      string;
  hours:     number;
  startTime?: string;
  endTime?:   string;
}

interface Creator {
  id:        number;
  name:      string;
  avatarUrl: string | null;
}

interface AgendaTask {
  id:          number;
  taskCode:    string;
  title:       string;
  status:      string;
  color:       string;
  client:      string | null;
  dueDate:     string | null;
  effortHours: number | null;
  creator:     Creator | null;
}

interface AllocRow {
  taskId:         number;
  workDate:       string;
  allocatedHours: number | null;
  startTime:      string | null;
  endTime:        string | null;
}

interface EditorRow {
  editor:      { id: number; name: string; avatarUrl: string | null };
  tasks:       AgendaTask[];
  allocations: AllocRow[];
}

interface DisplacementCascadeItem {
  taskId:          number;
  title:           string;
  originalSlots:   HourSlot[];
  newSlots:        HourSlot[];
  possible:        boolean;
  dueDate:         string | null;
  deadlineExpired: boolean;
  exceedsDeadline: boolean;
}

interface DisplacementPreview {
  feasible: boolean;
  cascade:  DisplacementCascadeItem[];
}

interface ContestationRow {
  id:                  number;
  requesterId:         number;
  targetCoordinatorId: number;
  editorId:            number;
  editorName:          string;
  displacedTaskId:     number;
  displacedTaskTitle:  string;
  displacedTaskColor:  string | null;
  originalSlots:       HourSlot[];
  proposedSlots:       HourSlot[];
  status:              "pending" | "accepted" | "refused" | "cancelled";
  refusalReason:       string | null;
  createdAt:           string;
  respondedAt:         string | null;
  requester:           Creator | null;
  targetCoordinator:   Creator | null;
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function d0(d: Date): Date { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function isSun(d: Date): boolean { return d.getDay() === 0; }

function getNext8WorkingDays(): string[] {
  const days: string[] = [];
  const cur = d0(new Date());
  while (days.length < 8) {
    if (!isSun(cur)) days.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const WEEK_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function fmtDay(ds: string): { dow: string; num: string; mon: string } {
  const d = new Date(ds + "T12:00:00");
  const MON = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  return { dow: WEEK_PT[d.getDay()], num: String(d.getDate()), mon: MON[d.getMonth()] };
}
function fmtDate(ds: string): string {
  const [y,m,d] = ds.split("-");
  return `${d}/${m}/${y}`;
}
function fmtTime(t: string): string {
  const [h,m] = t.split(":").map(Number);
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2,"0")}`;
}
function fmtSlot(s: HourSlot): string {
  if (s.startTime && s.endTime) return `${fmtDay(s.date).dow} ${fmtTime(s.startTime)}–${fmtTime(s.endTime)}`;
  return `${fmtDay(s.date).dow} ${s.hours}h`;
}
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return "agora";
  if (diff < 3600) return `há ${Math.floor(diff/60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff/3600)}h`;
  return `há ${Math.floor(diff/86400)}d`;
}

function statusChip(status: ContestationRow["status"]) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending:   { label: "Aguardando",  color: "#92400e", bg: "#fef3c730" },
    accepted:  { label: "Aceito ✓",   color: "#166534", bg: "#dcfce730" },
    refused:   { label: "Recusado",    color: "#991b1b", bg: "#fee2e230" },
    cancelled: { label: "Cancelado",   color: "#64748b", bg: "hsl(var(--muted))" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

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

// ── Componente principal ──────────────────────────────────────────────────────

export default function ReagendamentoPage() {
  usePageTitle("Reagendamentos");
  const { user } = useAuth();

  const [agendaData,      setAgendaData]      = useState<EditorRow[]>([]);
  const [loadingAgenda,   setLoadingAgenda]   = useState(true);
  const [selectedEditorId, setSelectedEditorId] = useState<number | null>(null);

  const [contestations,    setContestations]    = useState<ContestationRow[]>([]);
  const [loadingContests,  setLoadingContests]  = useState(true);
  const [contestTab,       setContestTab]       = useState<"sent" | "received">("sent");

  // Fluxo de proposta
  const [proposalTask,    setProposalTask]    = useState<{ task: AgendaTask; alloc: AllocRow } | null>(null);
  const [preview,         setPreview]         = useState<DisplacementPreview | null>(null);
  const [previewLoading,  setPreviewLoading]  = useState(false);
  const [sending,         setSending]         = useState(false);

  // Fluxo de recusa
  const [refuseId,        setRefuseId]        = useState<number | null>(null);
  const [refuseReason,    setRefuseReason]    = useState("");
  const [refusing,        setRefusing]        = useState(false);

  const days = useMemo(() => getNext8WorkingDays(), []);

  const fetchAgenda = useCallback(() => {
    setLoadingAgenda(true);
    apiFetch<EditorRow[]>("/api/agenda")
      .then(setAgendaData)
      .catch(() => toast.error("Erro ao carregar agendas"))
      .finally(() => setLoadingAgenda(false));
  }, []);

  const fetchContestations = useCallback(() => {
    setLoadingContests(true);
    apiFetch<ContestationRow[]>("/api/contestations")
      .then(setContestations)
      .catch(() => {})
      .finally(() => setLoadingContests(false));
  }, []);

  useEffect(() => { fetchAgenda(); fetchContestations(); }, [fetchAgenda, fetchContestations]);

  const selectedRow = agendaData.find(r => r.editor.id === selectedEditorId);

  // Quando clica em "Reagendar" em um bloco de outro coordenador
  const openProposal = useCallback(async (task: AgendaTask, alloc: AllocRow) => {
    setProposalTask({ task, alloc });
    setPreview(null);
    setPreviewLoading(true);
    try {
      const result = await apiPost<DisplacementPreview>("/api/escala/preview-displacement", {
        editorId:           selectedEditorId,
        newSlots:           [],
        conflictingTaskIds: [task.id],
      });
      setPreview(result);
    } catch {
      toast.error("Erro ao calcular novo horário");
      setProposalTask(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedEditorId]);

  const sendProposal = async () => {
    if (!proposalTask || !preview || !selectedRow) return;
    const cascadeItem = preview.cascade[0];
    if (!cascadeItem || !preview.feasible) return;

    if (!proposalTask.task.creator?.id) {
      toast.error("Não foi possível identificar o coordenador da tarefa");
      return;
    }

    setSending(true);
    try {
      await apiPost("/api/contestations", {
        editorId:            selectedEditorId,
        editorName:          selectedRow.editor.name,
        displacedTaskId:     proposalTask.task.id,
        displacedTaskTitle:  proposalTask.task.title,
        displacedTaskColor:  proposalTask.task.color,
        targetCoordinatorId: proposalTask.task.creator.id,
        originalSlots:       cascadeItem.originalSlots,
        proposedSlots:       cascadeItem.newSlots,
      });
      toast.success("Proposta enviada — aguardando resposta");
      setProposalTask(null);
      setPreview(null);
      fetchContestations();
    } catch (err: unknown) {
      toast.error((err as any)?.data?.error ?? "Erro ao enviar proposta");
    } finally {
      setSending(false);
    }
  };

  const acceptContestation = async (id: number) => {
    try {
      await apiPut(`/api/contestations/${id}/accept`, {});
      toast.success("Reagendamento aceito — horário atualizado");
      fetchContestations();
      fetchAgenda();
    } catch (err: unknown) {
      toast.error((err as any)?.data?.error ?? "Erro ao aceitar");
    }
  };

  const refuseContestation = async () => {
    if (!refuseId) return;
    setRefusing(true);
    try {
      await apiPut(`/api/contestations/${refuseId}/refuse`, { reason: refuseReason.trim() || undefined });
      toast.success("Proposta recusada");
      setRefuseId(null);
      setRefuseReason("");
      fetchContestations();
    } catch {
      toast.error("Erro ao recusar");
    } finally {
      setRefusing(false);
    }
  };

  const cancelContestation = async (id: number) => {
    try {
      await apiDelete(`/api/contestations/${id}`);
      toast.success("Proposta cancelada");
      fetchContestations();
    } catch {
      toast.error("Erro ao cancelar");
    }
  };

  const sentList     = contestations.filter(c => c.requesterId === user?.id);
  const receivedList = contestations.filter(c => c.targetCoordinatorId === user?.id);
  const pendingReceived = receivedList.filter(c => c.status === "pending").length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full pb-16" style={{ background: "hsl(var(--background))" }}>
      <div className="max-w-5xl mx-auto px-4 pt-8 space-y-8">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ArrowRightLeft className="h-4 w-4" style={{ color: "hsl(var(--primary))" }} />
            <p className="text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: "hsl(var(--primary))" }}>REAGENDAMENTO</p>
          </div>
          <h1 className="text-2xl font-black tracking-tight">Propor realocação</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Selecione um editor, encontre um horário ocupado por outro coordenador e proponha um novo slot.
          </p>
        </div>

        {/* ── Editor picker ──────────────────────────────────────────────── */}
        <section>
          <p className="text-[9px] font-black uppercase tracking-widest mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}>Ver agenda de</p>
          {loadingAgenda ? (
            <div className="flex gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 w-14 rounded-full animate-pulse"
                  style={{ background: "hsl(var(--muted))" }} />
              ))}
            </div>
          ) : (
            <div className="flex gap-3 flex-wrap">
              {agendaData.map(row => {
                const active = selectedEditorId === row.editor.id;
                return (
                  <motion.button
                    key={row.editor.id}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedEditorId(active ? null : row.editor.id)}
                    className="flex flex-col items-center gap-1.5 p-1"
                    title={row.editor.name}
                  >
                    <div className="relative">
                      <div className="rounded-full transition-all"
                        style={{
                          padding:    active ? 2 : 0,
                          background: active ? "hsl(var(--primary))" : "transparent",
                        }}>
                        <AvatarCircle name={row.editor.name} avatarUrl={row.editor.avatarUrl} size={44} />
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold max-w-[56px] truncate text-center"
                      style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                      {row.editor.name.split(" ")[0]}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Schedule grid ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedRow && (
            <motion.section
              key={selectedRow.editor.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22 }}
            >
              <p className="text-[9px] font-black uppercase tracking-widest mb-3"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                Agenda de {selectedRow.editor.name.split(" ")[0]} — próximos 8 dias
              </p>

              <div className="overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
                <div className="flex gap-2 min-w-max">
                  {days.map(dayStr => {
                    const { dow, num, mon } = fmtDay(dayStr);
                    const isToday = dayStr === toDateStr(d0(new Date()));
                    const dayAllocs = selectedRow.allocations.filter(a => a.workDate === dayStr);

                    return (
                      <div key={dayStr} className="flex flex-col gap-1.5" style={{ width: 148 }}>
                        {/* Day header */}
                        <div className="text-center py-1.5 rounded-xl"
                          style={{
                            background: isToday ? "hsl(var(--primary)/0.1)" : "hsl(var(--muted)/0.5)",
                          }}>
                          <p className="text-[9px] font-black uppercase tracking-widest"
                            style={{ color: isToday ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                            {dow}
                          </p>
                          <p className="text-base font-black leading-tight"
                            style={{ color: isToday ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
                            {num}
                          </p>
                          <p className="text-[9px]" style={{ color: "hsl(var(--muted-foreground))" }}>{mon}</p>
                        </div>

                        {/* Task blocks */}
                        <div className="flex flex-col gap-1 min-h-[80px]">
                          {dayAllocs.length === 0 && (
                            <div className="flex-1 rounded-xl border border-dashed flex items-center justify-center"
                              style={{ borderColor: "hsl(var(--border))", minHeight: 80 }}>
                              <p className="text-[9px]" style={{ color: "hsl(var(--muted-foreground)/0.4)" }}>livre</p>
                            </div>
                          )}
                          {dayAllocs.map(alloc => {
                            const task = selectedRow.tasks.find(t => t.id === alloc.taskId);
                            if (!task) return null;
                            const isOther = task.creator && task.creator.id !== user?.id;
                            return (
                              <TaskBlock
                                key={alloc.taskId}
                                task={task}
                                alloc={alloc}
                                isOther={!!isOther}
                                onPropose={() => openProposal(task, alloc)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ── Contestations list ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <p className="text-[9px] font-black uppercase tracking-widest"
              style={{ color: "hsl(var(--muted-foreground))" }}>Suas contestações</p>
            {pendingReceived > 0 && (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full text-white"
                style={{ background: "hsl(var(--primary))" }}>
                {pendingReceived} pendente{pendingReceived !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 p-1 rounded-xl w-fit"
            style={{ background: "hsl(var(--muted)/0.5)" }}>
            {(["sent","received"] as const).map(tab => (
              <button key={tab}
                onClick={() => setContestTab(tab)}
                className="px-4 py-1.5 rounded-lg text-xs font-black transition-all"
                style={contestTab === tab
                  ? { background: "hsl(var(--background))", color: "hsl(var(--foreground))", boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }
                  : { color: "hsl(var(--muted-foreground))" }}>
                {tab === "sent" ? `Enviadas (${sentList.length})` : `Recebidas (${receivedList.length})`}
              </button>
            ))}
          </div>

          {loadingContests ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
            </div>
          ) : (
            <div className="space-y-2">
              {(contestTab === "sent" ? sentList : receivedList).length === 0 && (
                <div className="text-center py-10 rounded-2xl border border-dashed"
                  style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {contestTab === "sent" ? "Nenhuma proposta enviada" : "Nenhuma proposta recebida"}
                  </p>
                </div>
              )}

              {(contestTab === "sent" ? sentList : receivedList).map(c => (
                <ContestationCard
                  key={c.id}
                  c={c}
                  isSent={contestTab === "sent"}
                  onAccept={() => acceptContestation(c.id)}
                  onRefuse={() => { setRefuseId(c.id); setRefuseReason(""); }}
                  onCancel={() => cancelContestation(c.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Proposal panel (bottom sheet) ──────────────────────────────── */}
      <AnimatePresence>
        {proposalTask && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.4)" }}
              onClick={() => { setProposalTask(null); setPreview(null); }}
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl shadow-2xl"
              style={{ background: "hsl(var(--card))", maxHeight: "80vh", overflowY: "auto" }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: "hsl(var(--muted-foreground)/0.3)" }} />
              </div>

              <div className="px-6 pb-8 pt-2 space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-1"
                      style={{ color: "hsl(var(--muted-foreground))" }}>propor reagendamento</p>
                    <p className="text-xl font-black leading-tight">{proposalTask.task.title}</p>
                    <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {proposalTask.task.creator?.name} · {selectedRow?.editor.name}
                      {proposalTask.alloc.startTime && proposalTask.alloc.endTime &&
                        ` · ${fmtTime(proposalTask.alloc.startTime)}–${fmtTime(proposalTask.alloc.endTime)}`}
                    </p>
                  </div>
                  <button onClick={() => { setProposalTask(null); setPreview(null); }}
                    className="h-8 w-8 rounded-full flex items-center justify-center transition-colors"
                    style={{ background: "hsl(var(--muted))" }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Preview */}
                {previewLoading ? (
                  <div className="flex items-center justify-center py-8 gap-3">
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: "hsl(var(--primary))" }} />
                    <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                      calculando novo slot…
                    </p>
                  </div>
                ) : preview ? (
                  <>
                    {(() => {
                      const item = preview.cascade[0];
                      if (preview.feasible && item?.possible) {
                        return (
                          <div className="rounded-2xl p-4 space-y-3"
                            style={{ background: "hsl(var(--muted)/0.5)" }}>
                            <p className="text-[9px] font-black uppercase tracking-widest"
                              style={{ color: "hsl(var(--muted-foreground))" }}>proposta de novo horário</p>
                            <div className="space-y-1.5">
                              <p className="text-xs line-through" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {item.originalSlots.map(fmtSlot).join(" · ")}
                              </p>
                              <p className="text-sm font-black" style={{ color: "hsl(var(--primary))" }}>
                                → {item.newSlots.map(fmtSlot).join(" · ")}
                              </p>
                            </div>
                            {item.dueDate && (
                              <p className="text-[10px] flex items-center gap-1"
                                style={{ color: "hsl(var(--muted-foreground))" }}>
                                <Clock className="h-3 w-3" />
                                prazo original: {fmtDate(item.dueDate)}
                              </p>
                            )}
                            {item.exceedsDeadline && (
                              <div className="rounded-xl px-3 py-2 flex items-start gap-2"
                                style={{ background: "hsl(38 92% 50% / 0.12)", outline: "1px solid hsl(38 92% 50% / 0.3)" }}>
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                  Novo slot ultrapassa o prazo original. O coordenador{" "}
                                  <strong>{proposalTask.task.creator?.name?.split(" ")[0]}</strong>{" "}
                                  precisará aceitar o prazo estendido.
                                </p>
                              </div>
                            )}
                            {!item.exceedsDeadline && (
                              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                                O coordenador{" "}
                                <strong>{proposalTask.task.creator?.name?.split(" ")[0]}</strong>{" "}
                                precisará aceitar para o reagendamento ser aplicado.
                              </p>
                            )}
                          </div>
                        );
                      }

                      // Motivo detalhado para impossibilidade
                      const expired = item?.deadlineExpired;
                      const noRoom  = !expired;
                      return (
                        <div className="rounded-2xl p-4 space-y-3"
                          style={{ background: "hsl(var(--muted)/0.4)", outline: "1px solid hsl(var(--border))" }}>
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                            <div>
                              <p className="text-sm font-black">
                                {expired ? "Prazo encerrado" : "Editor sem espaço disponível"}
                              </p>
                              <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {expired
                                  ? "O prazo desta tarefa já passou — o algoritmo não pode sugerir um novo horário automaticamente."
                                  : `${selectedRow?.editor.name.split(" ")[0]} não tem horas livres${item?.dueDate ? ` antes de ${fmtDate(item.dueDate)}` : " nos próximos 15 dias úteis"}.`
                                }
                              </p>
                            </div>
                          </div>
                          <div className="rounded-xl p-3 space-y-1.5"
                            style={{ background: "hsl(var(--muted))" }}>
                            <p className="text-[9px] font-black uppercase tracking-widest"
                              style={{ color: "hsl(var(--muted-foreground))" }}>o que fazer</p>
                            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {expired
                                ? "Converse diretamente com o coordenador para combinar um novo prazo antes de propor o reagendamento."
                                : "Fale com o coordenador para ver se há flexibilidade no prazo, ou escolha outro editor com disponibilidade."
                              }
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {preview.feasible && preview.cascade[0]?.possible && (
                      <button
                        onClick={sendProposal}
                        disabled={sending}
                        className="w-full h-12 rounded-2xl text-sm font-black text-white flex items-center justify-center gap-2 disabled:opacity-50"
                        style={{ background: "hsl(var(--primary))" }}>
                        {sending
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> enviando…</>
                          : <><ArrowRightLeft className="h-4 w-4" /> enviar proposta</>
                        }
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Refuse modal ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {refuseId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.4)" }}
              onClick={() => setRefuseId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed z-50 rounded-2xl shadow-2xl p-6 w-[340px]"
              style={{
                background: "hsl(var(--card))",
                top: "50%", left: "50%",
                transform: "translate(-50%, -50%)",
              }}
            >
              <p className="text-base font-black mb-1">Recusar proposta</p>
              <p className="text-sm mb-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                Você pode informar um motivo opcional.
              </p>
              <textarea
                value={refuseReason}
                onChange={e => setRefuseReason(e.target.value)}
                placeholder="Motivo (opcional)…"
                rows={3}
                className="w-full rounded-xl border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                style={{
                  borderColor: "hsl(var(--border))",
                  background:  "hsl(var(--background))",
                }}
              />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setRefuseId(null)}
                  className="flex-1 h-10 rounded-xl text-sm font-medium"
                  style={{ background: "hsl(var(--muted))" }}>
                  Cancelar
                </button>
                <button onClick={refuseContestation} disabled={refusing}
                  className="flex-1 h-10 rounded-xl text-sm font-black text-white disabled:opacity-50"
                  style={{ background: "#ef4444" }}>
                  {refusing ? "…" : "Recusar"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function TaskBlock({
  task, alloc, isOther, onPropose,
}: {
  task:      AgendaTask;
  alloc:     AllocRow;
  isOther:   boolean;
  onPropose: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative rounded-xl px-2.5 py-2 transition-all"
      style={{
        background:  `${task.color}18`,
        borderLeft:  `3px solid ${task.color}`,
        cursor:      isOther ? "pointer" : "default",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <p className="text-[11px] font-black leading-tight truncate">{task.title}</p>
      {task.creator && (
        <p className="text-[9px] mt-0.5 truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
          {task.creator.name.split(" ")[0]}
        </p>
      )}
      {alloc.startTime && alloc.endTime && (
        <p className="text-[9px] font-medium" style={{ color: "hsl(var(--muted-foreground)/0.7)" }}>
          {alloc.startTime.slice(0,5)}–{alloc.endTime.slice(0,5)}
        </p>
      )}

      {/* Reagendar overlay — só para tarefas de outros coordenadores */}
      <AnimatePresence>
        {isOther && hover && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onPropose}
            className="absolute inset-0 rounded-xl flex items-center justify-center gap-1 text-[10px] font-black text-white"
            style={{ background: `${task.color}cc` }}
          >
            <ArrowRightLeft className="h-3 w-3" />
            Reagendar
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function ContestationCard({
  c, isSent, onAccept, onRefuse, onCancel,
}: {
  c:        ContestationRow;
  isSent:   boolean;
  onAccept: () => void;
  onRefuse: () => void;
  onCancel: () => void;
}) {
  const originalSummary = c.originalSlots.map(fmtSlot).join(" · ");
  const proposedSummary = c.proposedSlots.map(fmtSlot).join(" · ");

  return (
    <div className="rounded-2xl p-4 space-y-2.5"
      style={{
        background:  "hsl(var(--card))",
        border:      "1px solid hsl(var(--border))",
        borderLeft:  `4px solid ${c.displacedTaskColor ?? "#6366f1"}`,
      }}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black truncate">{c.displacedTaskTitle}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {c.editorName} · {isSent ? `para ${c.targetCoordinator?.name ?? "—"}` : `de ${c.requester?.name ?? "—"}`}
            {" · "}{timeAgo(c.createdAt)}
          </p>
        </div>
        {statusChip(c.status)}
      </div>

      {/* Slots */}
      <div className="rounded-xl px-3 py-2 space-y-1"
        style={{ background: "hsl(var(--muted)/0.5)" }}>
        <p className="text-[10px] line-through" style={{ color: "hsl(var(--muted-foreground))" }}>
          {originalSummary}
        </p>
        <p className="text-[10px] font-semibold flex items-center gap-1"
          style={{ color: "hsl(var(--primary))" }}>
          <ChevronRight className="h-3 w-3" />
          {proposedSummary}
        </p>
      </div>

      {/* Refusal reason */}
      {c.status === "refused" && c.refusalReason && (
        <p className="text-[11px] px-3 py-1.5 rounded-lg"
          style={{ background: "#fee2e230", color: "#991b1b" }}>
          Motivo: {c.refusalReason}
        </p>
      )}

      {/* Actions */}
      {c.status === "pending" && (
        <div className="flex gap-2 pt-1">
          {isSent ? (
            <button onClick={onCancel}
              className="h-8 px-4 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors hover:opacity-80"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              <Trash2 className="h-3 w-3" /> Cancelar
            </button>
          ) : (
            <>
              <button onClick={onAccept}
                className="flex-1 h-9 rounded-xl text-xs font-black text-white flex items-center justify-center gap-1.5"
                style={{ background: "#16a34a" }}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Aceitar
              </button>
              <button onClick={onRefuse}
                className="flex-1 h-9 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors hover:opacity-80"
                style={{ background: "#fee2e2", color: "#991b1b" }}>
                <XCircle className="h-3.5 w-3.5" /> Recusar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
