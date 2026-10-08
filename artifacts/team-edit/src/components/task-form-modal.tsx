import { useState, useEffect, useMemo } from "react";
import { apiFetch, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ClientCombobox } from "@/components/ui/client-combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { FolderOpen, ExternalLink, AlertTriangle, X, Send, Save, CalendarDays, Check, Search, PanelRightClose, PanelRightOpen } from "lucide-react";
import { EditorAvailabilityModal } from "@/components/editor-availability-modal";
import { AbsenceBadge, InactiveBadge } from "@/components/ui/absence-badge";
import { isActiveUser, type Absence } from "@/lib/availability";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";

interface Editor { id: number; name: string; login: string; role: string; status?: string; avatarUrl?: string | null; absence?: Absence | null; }
interface EditorWorkload {
  id: number; score: number; taskCount: number; absence?: Absence | null;
  scheduledCount?: number; scheduledScore?: number; projectedScore?: number;
  byComplexity: { low: number; medium: number; high: number };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  editTaskId?: number | null;
  initialStartDate?: string;
  initialDueDate?: string;
  initialEditorId?: number;
  readOnlyDates?: boolean;
  hidePublish?: boolean;
}

const EMPTY_FORM = {
  title: "", description: "", startDateTime: "", dueDateTime: "", priority: "medium",
  complexity: "medium", assignedToId: "", folderUrl: "", client: "",
};
type FormState = typeof EMPTY_FORM;

const PRIORITIES = [
  { value: "low",    label: "Baixa", on: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
  { value: "medium", label: "Média", on: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  { value: "high",   label: "Alta",  on: "bg-rose-500/15 text-rose-600 dark:text-rose-300" },
];
const COMPLEXITIES = [
  { value: "low", label: "Simples" }, { value: "medium", label: "Moderada" }, { value: "high", label: "Complexa" },
];
const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };

// cinza=disponível | amarelo=ocupado | laranja=muito ocupado | vermelho=no limite
function scoreColor(score: number): string {
  if (score === 0)  return "#94a3b8";
  if (score <= 6)   return "#eab308";
  if (score <= 11)  return "#f97316";
  return "#ef4444";
}
function scoreLabel(score: number): string {
  if (score === 0)  return "Disponível";
  if (score <= 6)   return "Ocupado";
  if (score <= 11)  return "Muito ocupado";
  return "No limite";
}

// ── Datas (sempre no fuso local, no mesmo formato que o DatePicker devolve) ──
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const localIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function tzOffset(): string {
  const off = new Date().getTimezoneOffset();
  const abs = Math.abs(off);
  return `${off <= 0 ? "+" : "-"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
const withTime = (d: Date, hhmm: string) => `${localIsoDate(d)}T${hhmm}:00${tzOffset()}`;
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

/** "qui 08/10 · 09:00" */
function fmtDateTime(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${DOW[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDateLabel(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return `${DOW[dt.getDay()]} ${pad(d)}/${pad(m)}/${y}`;
}
/** Compara só a data (ignora hora e fuso) */
const datePart = (s: string) => { if (!s) return ""; try { return localIsoDate(new Date(s)); } catch { return ""; } };
const sameMinute = (a: string, b: string) => {
  if (!a || !b) return a === b;
  return Math.floor(new Date(a).getTime() / 60000) === Math.floor(new Date(b).getTime() / 60000);
};

/** Atalhos de período: início 09:00 → entrega 18:00 */
function quickRanges(): { id: string; label: string; start: string; due: string }[] {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const dow = today.getDay();
  const toFriday = dow === 6 ? 6 : dow === 0 ? 5 : 5 - dow;
  const nextMonday = addDays(today, dow === 0 ? 1 : 8 - dow);
  return [
    { id: "today",    label: "Hoje",           start: withTime(today, "09:00"),            due: withTime(today, "18:00") },
    { id: "tomorrow", label: "Amanhã",         start: withTime(addDays(today, 1), "09:00"), due: withTime(addDays(today, 1), "18:00") },
    { id: "friday",   label: "Até sexta",      start: withTime(today, "09:00"),            due: withTime(addDays(today, toFriday), "18:00") },
    { id: "nextweek", label: "Próxima semana", start: withTime(nextMonday, "09:00"),       due: withTime(addDays(nextMonday, 4), "18:00") },
  ];
}

function SectionTitle({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {n !== undefined && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/12 text-xs font-bold text-[hsl(var(--primary))]">{n}</span>
      )}
      <h3 className="text-[15px] font-bold">{children}</h3>
    </div>
  );
}

function FieldLabel({ children, changed, htmlFor }: { children: React.ReactNode; changed?: boolean; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className={cn("flex items-center gap-1.5 text-xs font-medium",
      changed ? "text-amber-600 dark:text-amber-400" : "text-[hsl(var(--muted-foreground))]")}>
      {children}
      {changed && <><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />alterado</>}
    </Label>
  );
}

export function TaskFormModal({ open, onOpenChange, onSaved, editTaskId, initialStartDate, initialDueDate, initialEditorId, readOnlyDates, hidePublish }: Props) {
  const editMode = !!editTaskId;
  const { user } = useAuth();
  // Coordenadores e supervisores não veem complexidade — só admin pode definir manualmente
  const hideComplexity = user?.role !== "admin";

  const [form, setForm]               = useState<FormState>(EMPTY_FORM);
  const [orig, setOrig]               = useState<FormState>(EMPTY_FORM);
  const [taskStatus, setTaskStatus]   = useState<string>("");
  const [taskCode, setTaskCode]       = useState<string>("");
  const [saving, setSaving]           = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [editors, setEditors]         = useState<Editor[]>([]);
  const [workload, setWorkload]             = useState<EditorWorkload[]>([]);
  const [projectedWorkload, setProjectedWorkload] = useState<EditorWorkload[]>([]);
  const [selectedEditorIds, setSelectedEditorIds] = useState<number[]>([]);
  const [availModalEditorId, setAvailModalEditorId] = useState<number | null>(null);
  const [periodCheck,   setPeriodCheck]   = useState<{ blocked: boolean; conflictDays: string[]; maxScore: number; absenceMessage?: string | null } | null>(null);
  const [checkingPeriod, setCheckingPeriod] = useState(false);
  const [origEditorIds, setOrigEditorIds] = useState<number[]>([]);
  const [showSummary, setShowSummary] = useState(true);
  const [editorQuery, setEditorQuery] = useState("");

  useEffect(() => {
    apiFetch<Editor[]>("/api/users")
      .then(u => setEditors(u.filter(x => x.role === "editor")))
      .catch(() => {});
    apiFetch<EditorWorkload[]>("/api/workload").then(setWorkload).catch(() => {});
  }, []);

  // Quando startDateTime muda, busca carga projetada para aquela data
  useEffect(() => {
    if (!form.startDateTime) { setProjectedWorkload([]); return; }
    const date = datePart(form.startDateTime);
    apiFetch<EditorWorkload[]>(`/api/workload?date=${date}`).then(setProjectedWorkload).catch(() => {});
  }, [form.startDateTime]);

  // Nível 3 — verifica conflito de capacidade no período completo da tarefa
  useEffect(() => {
    const primaryId = selectedEditorIds[0];
    if (!primaryId || !form.startDateTime || !form.dueDateTime) {
      setPeriodCheck(null); return;
    }
    const startDate = datePart(form.startDateTime);
    const endDate   = datePart(form.dueDateTime);
    if (startDate > endDate) { setPeriodCheck(null); return; }
    setCheckingPeriod(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ editorId: String(primaryId), startDate, endDate, complexity: form.complexity });
      if (editMode && editTaskId) params.set("excludeTaskId", String(editTaskId));
      apiFetch<{ blocked: boolean; conflictDays: string[]; maxScore: number; absenceMessage?: string | null }>(
        `/api/workload/period-check?${params}`
      ).then(r => { setPeriodCheck(r); setCheckingPeriod(false); })
       .catch(() => { setPeriodCheck(null); setCheckingPeriod(false); });
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEditorIds[0], form.startDateTime, form.dueDateTime, form.complexity, editMode, editTaskId]);

  useEffect(() => {
    if (!open) return;
    setEditorQuery("");
    if (editMode && editTaskId) {
      setForm(EMPTY_FORM);
      setSelectedEditorIds([]);
      setLoadingEdit(true);
      apiFetch<{
        taskCode?: string;
        title: string; description: string | null; startDate: string | null; dueDate: string | null;
        priority: string; complexity: string; assignedToId: number | null;
        folderUrl: string | null; client: string | null; status: string;
        editors?: { id: number }[];
      }>(`/api/tasks/${editTaskId}`)
        .then(t => {
          setTaskStatus(t.status ?? "");
          setTaskCode(t.taskCode ?? "");
          const loaded: FormState = {
            title: t.title ?? "", description: t.description ?? "",
            startDateTime: t.startDate ?? "",
            dueDateTime: t.dueDate ?? "", priority: t.priority ?? "medium",
            complexity: t.complexity ?? "medium",
            assignedToId: t.assignedToId ? String(t.assignedToId) : "",
            folderUrl: t.folderUrl ?? "", client: t.client ?? "",
          };
          setForm(loaded);
          setOrig(loaded);
          // Principal primeiro
          const ids = t.editors?.map(e => e.id) ?? [];
          const ordered = t.assignedToId ? [t.assignedToId, ...ids.filter(i => i !== t.assignedToId)] : ids;
          setSelectedEditorIds(ordered);
          setOrigEditorIds(ordered);
        })
        .catch(() => { toast.error("Erro ao carregar tarefa"); onOpenChange(false); })
        .finally(() => setLoadingEdit(false));
    } else {
      const fresh = { ...EMPTY_FORM, startDateTime: initialStartDate ?? "", dueDateTime: initialDueDate ?? "" };
      setForm(fresh);
      setOrig(fresh);
      setTaskStatus(""); setTaskCode("");
      setSelectedEditorIds(initialEditorId ? [initialEditorId] : []);
      setOrigEditorIds([]);
    }
  }, [open, editTaskId]);

  useEffect(() => {
    const primary = selectedEditorIds[0] ?? null;
    setForm(prev => ({ ...prev, assignedToId: primary ? String(primary) : "" }));
  }, [selectedEditorIds]);

  const toggleEditor = (id: number) =>
    setSelectedEditorIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Se há startDate futura, usa carga projetada; senão, usa carga atual
  const todayIso = localIsoDate(new Date());
  const isFutureStart = !!form.startDateTime && datePart(form.startDateTime) > todayIso;
  const activeWorkload = (isFutureStart && projectedWorkload.length > 0) ? projectedWorkload : workload;
  const primaryWorkload = activeWorkload.find(w => w.id === selectedEditorIds[0]);
  const scoreOf = (id: number) => {
    const wl = activeWorkload.find(w => w.id === id);
    return isFutureStart ? (wl?.projectedScore ?? wl?.score ?? 0) : (wl?.score ?? 0);
  };

  const isDraft = editMode && taskStatus === "rascunho";
  const isPublishedEditMode = editMode && taskStatus !== "rascunho";

  // ── Checklist para publicar ────────────────────────────────────────────
  const checks = [
    { label: "Cliente",            ok: !!form.client.trim() },
    { label: "Título",             ok: !!form.title.trim() },
    { label: "Direcionamento",     ok: !!form.description.trim() },
    { label: "Pasta / arquivos",   ok: !!form.folderUrl.trim() },
    { label: "Início e entrega",   ok: !!form.startDateTime && !!form.dueDateTime },
    { label: "Ao menos um editor", ok: selectedEditorIds.length > 0 },
  ];
  const missing = checks.filter(c => !c.ok).length;

  // ── Diferenças em relação ao que foi carregado (edição) ────────────────
  const nameOf = (id: number) => editors.find(e => e.id === id)?.name ?? "Editor";
  const changes = useMemo(() => {
    if (!editMode) return [] as { field: string; from?: string; to: string }[];
    const out: { field: string; from?: string; to: string }[] = [];
    if (form.client !== orig.client) out.push({ field: "Cliente", from: orig.client || "—", to: form.client || "—" });
    if (form.title !== orig.title) out.push({ field: "Título", from: orig.title, to: form.title });
    if (form.description !== orig.description) out.push({ field: "Direcionamento", to: "texto alterado" });
    if (form.folderUrl !== orig.folderUrl) out.push({ field: "Pasta / arquivos", to: "link alterado" });
    if (!sameMinute(form.startDateTime, orig.startDateTime)) out.push({ field: "Início", from: fmtDateTime(orig.startDateTime) || "—", to: fmtDateTime(form.startDateTime) || "—" });
    if (!sameMinute(form.dueDateTime, orig.dueDateTime)) out.push({ field: "Entrega", from: fmtDateTime(orig.dueDateTime) || "—", to: fmtDateTime(form.dueDateTime) || "—" });
    if (form.priority !== orig.priority) out.push({ field: "Prioridade", from: PRIORITY_LABEL[orig.priority], to: PRIORITY_LABEL[form.priority] });
    if (!hideComplexity && form.complexity !== orig.complexity) out.push({ field: "Complexidade", from: COMPLEXITY_LABEL[orig.complexity], to: COMPLEXITY_LABEL[form.complexity] });
    const added = selectedEditorIds.filter(id => !origEditorIds.includes(id));
    const removed = origEditorIds.filter(id => !selectedEditorIds.includes(id));
    if (selectedEditorIds[0] !== origEditorIds[0] && selectedEditorIds[0]) out.push({ field: "Editor principal", from: origEditorIds[0] ? nameOf(origEditorIds[0]) : "—", to: nameOf(selectedEditorIds[0]) });
    if (added.filter(id => id !== selectedEditorIds[0]).length) out.push({ field: "Editores", to: `+ ${added.filter(id => id !== selectedEditorIds[0]).map(nameOf).join(", ")}` });
    if (removed.filter(id => id !== origEditorIds[0]).length) out.push({ field: "Editores", to: `− ${removed.filter(id => id !== origEditorIds[0]).map(nameOf).join(", ")}` });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, form, orig, selectedEditorIds, origEditorIds, editors, hideComplexity]);

  /** Quem o sistema vai avisar ao salvar (espelha as notificações do backend). */
  const notified = useMemo(() => {
    if (!isPublishedEditMode) return [] as string[];
    const out: string[] = [];
    const first = (id: number) => nameOf(id).split(" ")[0];
    const added = selectedEditorIds.filter(id => !origEditorIds.includes(id));
    const removedPrimary = origEditorIds[0] && origEditorIds[0] !== selectedEditorIds[0] ? origEditorIds[0] : null;
    if (datePart(form.dueDateTime) !== datePart(orig.dueDateTime)) {
      selectedEditorIds.filter(id => !added.includes(id)).forEach(id => out.push(`${first(id)} — novo prazo`));
    }
    added.forEach(id => out.push(`${first(id)} — ${id === selectedEditorIds[0] ? "passa a ser o principal" : "adicionado à tarefa"}`));
    if (removedPrimary) out.push(`${first(removedPrimary)} — tarefa reatribuída`);
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublishedEditMode, form.dueDateTime, orig.dueDateTime, selectedEditorIds, origEditorIds, editors]);

  const save = async (publishStatus?: "rascunho" | "pending") => {
    // ── Validações globais ─────────────────────────────────────────────────
    if (!form.title.trim())       { toast.error("Título obrigatório");           return; }
    if (!form.description.trim()) { toast.error("Direcionamento obrigatório");   return; }
    if (!form.client?.trim())     { toast.error("Cliente obrigatório");          return; }

    // Datas obrigatórias ao criar ou publicar um rascunho.
    // Em edição de tarefa já ativa as datas já foram validadas na criação.
    const isPublishedEdit = editMode && taskStatus !== "rascunho" && publishStatus !== "pending";
    if (!isPublishedEdit) {
      if (!form.startDateTime) { toast.error("Data de início obrigatória");  return; }
      if (!form.dueDateTime)   { toast.error("Data de entrega obrigatória"); return; }
    }

    if (!form.folderUrl?.trim())  { toast.error("Pasta / Arquivos obrigatório"); return; }
    if (selectedEditorIds.length === 0) {
      toast.error("Atribua ao menos um editor"); return;
    }

    const datesChanged = isPublishedEdit && (
      datePart(form.startDateTime) !== datePart(orig.startDateTime) ||
      datePart(form.dueDateTime)   !== datePart(orig.dueDateTime)
    );
    const editorChanged = isPublishedEdit && (
      JSON.stringify([...selectedEditorIds].sort()) !== JSON.stringify([...origEditorIds].sort())
    );

    // ── Nível 1: bloqueio se editor já está no limite de capacidade ────────
    // Só aplica em criação nova (não em edição de tarefa já ativa)
    if (!editMode && selectedEditorIds.length > 0) {
      const WEIGHT: Record<string, number> = { low: 3, medium: 6, high: 12 };
      const newWeight = WEIGHT[form.complexity] ?? 6;
      if (scoreOf(selectedEditorIds[0]) + newWeight > 12) {
        toast.error(`${nameOf(selectedEditorIds[0])} está no limite de capacidade. Escolha outro editor ou altere a data de início.`);
        return;
      }
    }

    // ── Nível 3: bloqueio por conflito de período ──────────────────────────
    // Em edição de tarefa ativa, só bloqueia se datas ou editor mudaram.
    const applyPeriodBlock = !isPublishedEdit || datesChanged || editorChanged;
    if (periodCheck?.blocked && applyPeriodBlock) {
      const days = periodCheck.conflictDays.slice(0, 3)
        .map(d => { const [, m, day] = d.split("-"); return `${day}/${m}`; }).join(", ");
      const extra = periodCheck.conflictDays.length > 3 ? ` +${periodCheck.conflictDays.length - 3} dias` : "";
      toast.error(`Conflito de capacidade no período: ${days}${extra}. Ajuste as datas ou escolha outro editor.`);
      return;
    }

    const dueDatePayload = form.dueDateTime ? form.dueDateTime
      : (editMode && taskStatus !== "rascunho" ? undefined : null);
    const payload: Record<string, unknown> = {
      title: form.title, description: form.description || null,
      startDate: form.startDateTime || null,
      dueDate: dueDatePayload, priority: form.priority,
      ...(!hideComplexity ? { complexity: form.complexity } : {}),
      assignedToId: selectedEditorIds[0] ?? null, editorIds: selectedEditorIds,
      folderUrl: form.folderUrl || null, client: form.client || null,
    };
    if (!editMode && publishStatus) payload.status = publishStatus;
    if (editMode && publishStatus === "pending") payload.status = "pending";
    setSaving(true);
    try {
      if (editMode && editTaskId) {
        await apiPut(`/api/tasks/${editTaskId}`, payload);
        // O PUT só troca o principal; editores de apoio têm rota própria
        const primary = selectedEditorIds[0];
        const addedSupport = selectedEditorIds.slice(1).filter(id => !origEditorIds.includes(id));
        const removedSupport = origEditorIds.filter(id => !selectedEditorIds.includes(id) && id !== origEditorIds[0]);
        for (const id of addedSupport) await apiPost(`/api/tasks/${editTaskId}/editors`, { editorId: id });
        for (const id of removedSupport) if (id !== primary) await apiDelete(`/api/tasks/${editTaskId}/editors/${id}`);
        toast.success(publishStatus === "pending" ? "Tarefa publicada" : "Tarefa atualizada");
      } else {
        await apiPost("/api/tasks", payload);
        toast.success(publishStatus === "rascunho" ? "Rascunho salvo" : "Tarefa publicada");
      }
      onOpenChange(false); onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const f = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));
  const changed = (k: keyof FormState) => editMode && !loadingEdit && (
    k === "startDateTime" || k === "dueDateTime" ? !sameMinute(form[k], orig[k]) : form[k] !== orig[k]);

  // Opções: ativos + quem já está atribuído (mesmo inativo, na edição)
  const editorOptions = editors.filter(e => isActiveUser(e) || selectedEditorIds.includes(e.id));
  const quick = quickRanges();
  const activeQuick = quick.find(q => sameMinute(q.start, form.startDateTime) && sameMinute(q.due, form.dueDateTime))?.id;

  // Avisos sobre quem foi escolhido
  const absenceMsg = periodCheck
    ? (periodCheck.absenceMessage ?? null)
    : (() => {
      const away = selectedEditorIds
        .map(id => ({ ed: editors.find(e => e.id === id), wl: activeWorkload.find(w => w.id === id) }))
        .filter(x => x.ed && isActiveUser(x.ed) && (x.wl?.absence ?? x.ed.absence));
      return away.length
        ? away.map(x => `${x.ed!.name}: ${(x.wl?.absence ?? x.ed!.absence)!.label.toLowerCase()} até ${(x.wl?.absence ?? x.ed!.absence)!.endDate.split("-").reverse().slice(0, 2).join("/")}`).join("; ")
        : null;
    })();
  const primaryScore = primaryWorkload ? (isFutureStart ? (primaryWorkload.projectedScore ?? primaryWorkload.score) : primaryWorkload.score) : 0;


  const showPublish = editMode ? taskStatus === "rascunho" : !hidePublish;
  const filteredEditors = editorQuery.trim()
    ? editorOptions.filter(e => e.name.toLowerCase().includes(editorQuery.trim().toLowerCase()) || selectedEditorIds.includes(e.id))
    : editorOptions;
  const missingLabels = checks.filter(c => !c.ok).map(c => c.label);

  // ── Blocos reaproveitados (lateral no desktop, linha compacta no celular) ──
  const summaryPanel = isPublishedEditMode ? (
    <>
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Alterações · {changes.length}</p>
        {changes.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Nada alterado ainda.</p>
        ) : changes.map((c, i) => (
          <div key={i} className="space-y-0.5 rounded-lg border bg-[hsl(var(--card))] px-3 py-2">
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{c.field}</p>
            <p className="text-[13px] leading-snug">
              {c.from !== undefined && <><span className="text-[hsl(var(--muted-foreground))] line-through">{c.from}</span> → </>}
              <strong className="font-semibold">{c.to}</strong>
            </p>
          </div>
        ))}
      </div>
      {notified.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Quem será avisado</p>
          <ul className="space-y-1 text-[13px]">
            {notified.map((n, i) => (
              <li key={i} className="flex gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]" />{n}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  ) : (
    <>
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Como vai aparecer</p>
        <div className="space-y-1.5 rounded-lg border bg-[hsl(var(--card))] p-3">
          <p className="truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{taskCode || "nova"} · {form.client || "—"}</p>
          <p className="text-[14px] font-bold leading-snug">{form.title || "Sem título ainda"}</p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className={cn("rounded-md px-2 py-0.5 font-semibold", STATUS_CHIP.pending)}>{isDraft ? "Rascunho" : "Pendente"}</span>
            <span className={cn("rounded-md px-2 py-0.5 font-semibold", PRIORITIES.find(p => p.value === form.priority)?.on)}>
              Prioridade {PRIORITY_LABEL[form.priority]?.toLowerCase()}
            </span>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {form.startDateTime && form.dueDateTime ? `${fmtDateTime(form.startDateTime)} → ${fmtDateTime(form.dueDateTime)}` : "Período não definido"}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{selectedEditorIds.length ? selectedEditorIds.map(nameOf).join(", ") : "Sem editor"}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Para publicar</p>
        <ul className="space-y-1.5">
          {checks.map(c => (
            <li key={c.label} className="flex items-center gap-2 text-[13px]">
              <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                c.ok ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "border-[1.5px] border-[hsl(var(--muted-foreground))]/40")}>
                {c.ok && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span className={c.ok ? "" : "text-[hsl(var(--muted-foreground))]"}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Ao publicar, os editores são avisados. Como rascunho, ninguém é notificado.</p>
    </>
  );

  const segBtn = (on: boolean, onCls: string) => cn(
    "h-8 rounded-md px-2 text-[13px] font-semibold transition-colors",
    on ? onCls : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]");

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 [&>button]:hidden",
          // celular: tela cheia; a partir de sm: janela centralizada que cresce até 90% da altura
          "h-[100dvh] w-full max-w-none rounded-none border-0",
          "sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-32px)] sm:rounded-2xl sm:border",
          showSummary ? "sm:max-w-[1040px]" : "sm:max-w-[760px]",
        )}
        onInteractOutside={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}>

        {/* ══ HEADER ══════════════════════════════════════════════════════ */}
        <DialogHeader className="shrink-0 flex-row items-center gap-2 space-y-0 border-b px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {editMode && taskCode && <span className="font-mono text-[13px] font-semibold text-[hsl(var(--muted-foreground))]">{taskCode}</span>}
            <DialogTitle className="truncate text-base font-bold">{editMode ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
            {editMode && taskStatus && (
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold", STATUS_CHIP[taskStatus] ?? "")}>
                {STATUS_LABEL[taskStatus] ?? taskStatus}
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="hidden h-8 gap-1.5 px-2 text-xs text-[hsl(var(--muted-foreground))] lg:inline-flex"
            onClick={() => setShowSummary(v => !v)} aria-pressed={showSummary}>
            {showSummary ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            {showSummary ? "Ocultar resumo" : "Mostrar resumo"}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Fechar" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* ══ CORPO — um único contêiner rolável ═════════════════════════ */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loadingEdit ? (
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
              {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-[hsl(var(--muted))]/50" />)}
            </div>
          ) : (
            <div className="flex min-h-full">
              <div className="@container min-w-0 flex-1 space-y-6 px-4 py-4 sm:px-6 sm:py-5">

                {/* O quê */}
                <section className="space-y-3">
                  <SectionTitle n={editMode ? undefined : 1}>O quê</SectionTitle>
                  <div className="grid grid-cols-1 gap-3 @lg:grid-cols-[minmax(160px,220px)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel changed={changed("client")}>Cliente *</FieldLabel>
                      <ClientCombobox value={form.client} onChange={v => f({ client: v })} />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel htmlFor="tf-title" changed={changed("title")}>Título *</FieldLabel>
                      <Input id="tf-title" value={form.title} onChange={e => f({ title: e.target.value })}
                        placeholder="Ex.: VT institucional 30s" className="h-10 rounded-xl" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="tf-brief" changed={changed("description")}>Direcionamento *</FieldLabel>
                    <Textarea id="tf-brief" value={form.description} onChange={e => f({ description: e.target.value })}
                      rows={4} placeholder="Briefing, referências, formato de entrega, duração…"
                      className="field-sizing-content min-h-[96px] max-h-[40dvh] resize-y rounded-xl text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="tf-folder" changed={changed("folderUrl")}>Pasta / arquivos *</FieldLabel>
                    <div className="flex gap-1.5">
                      <div className="relative min-w-0 flex-1">
                        <FolderOpen className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]/60" />
                        <Input id="tf-folder" value={form.folderUrl} onChange={e => f({ folderUrl: e.target.value })}
                          placeholder="Link do Drive ou caminho da pasta" className="h-10 rounded-xl pl-9" />
                      </div>
                      {form.folderUrl && /^https?:\/\//.test(form.folderUrl) && (
                        <a href={form.folderUrl} target="_blank" rel="noreferrer" aria-label="Abrir pasta"
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border hover:bg-[hsl(var(--muted))]">
                          <ExternalLink className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                        </a>
                      )}
                    </div>
                  </div>
                </section>

                {/* Quando */}
                <section className="space-y-3">
                  <SectionTitle n={editMode ? undefined : 2}>Quando</SectionTitle>
                  {!readOnlyDates && (
                    <div role="group" aria-label="Atalhos de período" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                      {quick.map(q => (
                        <button key={q.id} type="button" onClick={() => f({ startDateTime: q.start, dueDateTime: q.due })}
                          className={cn("h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition-colors",
                            activeQuick === q.id
                              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                              : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
                          {q.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel changed={changed("startDateTime")}>Início *</FieldLabel>
                      {readOnlyDates ? (
                        <div className="flex h-10 items-center gap-2 rounded-xl border bg-[hsl(var(--muted))]/30 px-3 text-sm">
                          <span className="flex-1 truncate">{fmtDateLabel(form.startDateTime)}</span>
                          <input type="time" aria-label="Hora de início" value={form.startDateTime.split("T")[1]?.slice(0, 5) ?? "08:30"}
                            onChange={e => f({ startDateTime: form.startDateTime.split("T")[0] + "T" + e.target.value })}
                            className="border-l bg-transparent pl-2 text-sm outline-none" />
                        </div>
                      ) : (
                        <DatePicker
                          value={form.startDateTime}
                          onChange={v => {
                            const newStart = v ? datePart(v) : "";
                            const curEnd = form.dueDateTime ? datePart(form.dueDateTime) : "";
                            if (newStart && curEnd && newStart > curEnd) f({ startDateTime: v, dueDateTime: "" });
                            else f({ startDateTime: v });
                          }}
                          placeholder="DD/MM/AAAA HH:MM" minDate={todayIso} withTime />
                      )}
                      {isFutureStart && <p className="text-[11px] font-medium text-sky-500">Agendada — começa no futuro</p>}
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel changed={changed("dueDateTime")}>Entrega *</FieldLabel>
                      {readOnlyDates ? (
                        <div className="flex h-10 items-center gap-2 rounded-xl border bg-[hsl(var(--muted))]/30 px-3 text-sm">
                          <span className="flex-1 truncate">{fmtDateLabel(form.dueDateTime)}</span>
                          <input type="time" aria-label="Hora de entrega" value={form.dueDateTime.split("T")[1]?.slice(0, 5) ?? "17:30"}
                            onChange={e => f({ dueDateTime: form.dueDateTime.split("T")[0] + "T" + e.target.value })}
                            className="border-l bg-transparent pl-2 text-sm outline-none" />
                        </div>
                      ) : (
                        <DatePicker value={form.dueDateTime} onChange={v => f({ dueDateTime: v })}
                          placeholder="DD/MM/AAAA HH:MM"
                          minDate={form.startDateTime ? datePart(form.startDateTime) : todayIso} withTime />
                      )}
                      {editMode && changed("dueDateTime") && orig.dueDateTime && (
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Antes: <span className="line-through">{fmtDateTime(orig.dueDateTime)}</span></p>
                      )}
                    </div>
                  </div>
                  <div className={cn("grid grid-cols-1 gap-3", !hideComplexity && "@lg:grid-cols-2")}>
                    <div className="min-w-0 space-y-1.5">
                      <FieldLabel changed={changed("priority")}>Prioridade</FieldLabel>
                      <div role="radiogroup" aria-label="Prioridade" className="grid grid-cols-3 gap-1 rounded-xl border p-1">
                        {PRIORITIES.map(p => (
                          <button key={p.value} type="button" role="radio" aria-checked={form.priority === p.value}
                            onClick={() => f({ priority: p.value })} className={segBtn(form.priority === p.value, p.on)}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Complexidade — só admin; coordenador usa o padrão (o editor define ao iniciar) */}
                    {!hideComplexity && (
                      <div className="min-w-0 space-y-1.5">
                        <FieldLabel changed={changed("complexity")}>Complexidade</FieldLabel>
                        <div role="radiogroup" aria-label="Complexidade" className="grid grid-cols-3 gap-1 rounded-xl border p-1">
                          {COMPLEXITIES.map(c => (
                            <button key={c.value} type="button" role="radio" aria-checked={form.complexity === c.value}
                              onClick={() => f({ complexity: c.value })}
                              className={segBtn(form.complexity === c.value, "bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))]")}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Quem */}
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionTitle n={editMode ? undefined : 3}>Quem</SectionTitle>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {selectedEditorIds.length ? "O primeiro escolhido é o principal" : isFutureStart ? "Carga projetada para o início" : "Carga de hoje"}
                    </span>
                  </div>
                  {editorOptions.length > 6 && (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                      <Input value={editorQuery} onChange={e => setEditorQuery(e.target.value)} placeholder="Buscar editor"
                        aria-label="Buscar editor" className="h-9 rounded-xl pl-9" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 @md:grid-cols-2 @3xl:grid-cols-3">
                    {filteredEditors.map(e => {
                      const idx = selectedEditorIds.indexOf(e.id);
                      const on = idx >= 0;
                      const wl = activeWorkload.find(w => w.id === e.id);
                      const absence = isActiveUser(e) ? (wl?.absence ?? e.absence) : null;
                      const sc = scoreOf(e.id);
                      const isNew = editMode && on && !origEditorIds.includes(e.id);
                      const role = on ? (idx === 0 ? "Principal" : "Apoio") : null;
                      return (
                        <div key={e.id}
                          className={cn("flex min-w-0 items-center rounded-xl border transition-colors",
                            on ? (isNew ? "border-amber-500/70 bg-amber-500/5" : "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5") : "hover:bg-[hsl(var(--muted))]/40",
                            absence && !on && "opacity-75")}>
                          <button type="button" aria-pressed={on} onClick={() => toggleEditor(e.id)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2.5 pr-1 text-left">
                            <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} size={32} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold">{e.name}</span>
                                {!isActiveUser(e) && <InactiveBadge />}
                              </span>
                              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                {absence
                                  ? <AbsenceBadge absence={absence} />
                                  : <span className="text-[11px] font-semibold" style={{ color: scoreColor(sc) }}>{scoreLabel(sc)}</span>}
                                {role && (
                                  <span className={cn("rounded-full px-1.5 py-px text-[10px] font-bold",
                                    isNew ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]")}>
                                    {isNew ? `Novo · ${role.toLowerCase()}` : role}
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                          <button type="button" onClick={() => setAvailModalEditorId(e.id)} aria-label={`Disponibilidade de ${e.name}`}
                            className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary))]/10 hover:text-[hsl(var(--primary))]">
                            <CalendarDays className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                    {filteredEditors.length === 0 && (
                      <p className="col-span-full py-3 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhum editor encontrado.</p>
                    )}
                  </div>

                  {primaryWorkload && primaryScore > 6 && !periodCheck?.blocked && (
                    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
                      primaryScore >= 12 ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300")}>
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {primaryScore >= 12 ? `${nameOf(selectedEditorIds[0])} está no limite de capacidade.` : `${nameOf(selectedEditorIds[0])} está muito ocupado.`}
                    </div>
                  )}
                  {periodCheck?.blocked && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <strong>Conflito de capacidade no período.</strong> Dias sobrecarregados:{" "}
                        {periodCheck.conflictDays.slice(0, 3).map(d => { const [, m, day] = d.split("-"); return `${day}/${m}`; }).join(", ")}
                        {periodCheck.conflictDays.length > 3 ? ` +${periodCheck.conflictDays.length - 3}` : ""}
                      </span>
                    </div>
                  )}
                  {absenceMsg && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span><strong>Editor ausente no período.</strong> {absenceMsg}. Você ainda pode atribuir.</span>
                    </div>
                  )}
                  {checkingPeriod && selectedEditorIds.length > 0 && (
                    <p className="animate-pulse text-[11px] text-[hsl(var(--muted-foreground))]">Verificando disponibilidade no período…</p>
                  )}
                </section>
              </div>

              {/* Resumo — fixo na lateral enquanto o formulário rola (desktop) */}
              {showSummary && (
                <aside aria-label={isPublishedEditMode ? "Alterações" : "Resumo"}
                  className="hidden w-[272px] shrink-0 border-l bg-[hsl(var(--muted))]/20 lg:block">
                  <div className="sticky top-0 space-y-4 p-4">{summaryPanel}</div>
                </aside>
              )}
            </div>
          )}
        </div>

        {/* ══ FOOTER ══════════════════════════════════════════════════════ */}
        <div className="shrink-0 border-t bg-[hsl(var(--background))] px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-5">
          {/* Linha compacta de estado quando o resumo não está visível (celular ou resumo oculto) */}
          {!loadingEdit && (
            <p className={cn("mb-2 truncate text-xs text-[hsl(var(--muted-foreground))]", showSummary && "lg:hidden")}>
              {isPublishedEditMode
                ? (changes.length ? `${changes.length} ${changes.length === 1 ? "alteração" : "alterações"}: ${changes.map(c => c.field).join(", ")}` : "Nenhuma alteração")
                : (missingLabels.length ? `Falta: ${missingLabels.join(", ")}` : "Tudo pronto para publicar")}
            </p>
          )}
          <div className="flex items-center gap-2">
            {isPublishedEditMode && changes.length > 0 ? (
              <Button variant="ghost" size="sm" className="h-9 px-3" onClick={() => { setForm(orig); setSelectedEditorIds(origEditorIds); }}>
                Descartar
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-9 px-3" onClick={() => onOpenChange(false)}>Cancelar</Button>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {(!editMode || isDraft) && (
                <Button variant="outline" size="sm" className="h-9 gap-1.5 px-3" onClick={() => save(editMode ? undefined : "rascunho")} disabled={saving || loadingEdit}>
                  <Save className="h-4 w-4" /><span className="hidden min-[380px]:inline">{saving ? "Salvando…" : "Rascunho"}</span>
                </Button>
              )}
              {isPublishedEditMode && (
                <Button size="sm" className="h-9 px-4" onClick={() => save(undefined)} disabled={saving || loadingEdit || changes.length === 0}>
                  {saving ? "Salvando…" : changes.length ? `Salvar ${changes.length === 1 ? "alteração" : `${changes.length} alterações`}` : "Salvar"}
                </Button>
              )}
              {showPublish && (
                <Button size="sm" className="h-9 gap-1.5 px-4" onClick={() => save("pending")} disabled={saving || loadingEdit}>
                  <Send className="h-4 w-4" />{saving ? "Publicando…" : "Publicar"}
                </Button>
              )}
            </div>
          </div>
        </div>

      </DialogContent>
    </Dialog>

    <EditorAvailabilityModal
      open={availModalEditorId !== null}
      onOpenChange={v => { if (!v) setAvailModalEditorId(null); }}
      editor={availModalEditorId !== null ? (editors.find(e => e.id === availModalEditorId) ?? null) : null}
    />
  </>
  );
}
