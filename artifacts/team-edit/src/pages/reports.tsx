import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, FileText, X, Download } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";
import { STATUS_LABEL, STATUS_CHIP } from "@/lib/status";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { fmtDate } from "@/lib/utils";

interface Person { id: number; name: string; avatarUrl: string | null }

interface ReportTask {
  id: number; taskCode?: string; title: string; status: string; priority: string;
  complexity: string; client: string | null; color: string;
  revisionCount: number; dueDate: string | null;
  createdAt: string; updatedAt: string;
  assignee: Person | null; coordinator: Person | null;
}

const STATUS_ORDER    = ["pending", "in_progress", "review", "completed"];
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const PRIORITY_LABEL:   Record<string, string> = { high: "Alta", medium: "Média", low: "Baixa" };
const COORD_ROLES     = ["admin", "supervisor", "coordinator"];

function fmtD(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}

// Inline status colors for the standalone HTML document
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending:     { bg: "#f1f5f9", color: "#475569" },
  in_progress: { bg: "#dbeafe", color: "#1d4ed8" },
  review:      { bg: "#ede9fe", color: "#6d28d9" },
  completed:   { bg: "#d1fae5", color: "#065f46" },
  cancelled:   { bg: "#fee2e2", color: "#991b1b" },
  paused:      { bg: "#f3e8ff", color: "#6b21a8" },
};

function Select({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-8 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs text-[hsl(var(--foreground))] outline-none focus:ring-1 focus:ring-[hsl(var(--primary))] min-w-[140px]"
    >
      {children}
    </select>
  );
}

export default function Reports() {
  usePageTitle("Relatórios");
  const { user }  = useAuth();
  const isCoord   = COORD_ROLES.includes(user?.role ?? "");
  const today     = new Date();

  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0]);
  const [to, setTo]     = useState(today.toISOString().split("T")[0]);
  const [tasks, setTasks] = useState<ReportTask[]>([]);
  const [loading, setLoading] = useState(false);

  const defaultCoord = user ? String(user.id) : "all";
  const [search,      setSearch]      = useState("");
  const [fStatus,     setFStatus]     = useState("all");
  const [fClient,     setFClient]     = useState("all");
  const [fEditor,     setFEditor]     = useState("all");
  const [fCoord,      setFCoord]      = useState(() => user ? String(user.id) : "all");
  const [fPriority,   setFPriority]   = useState("all");
  const [fComplexity, setFComplexity] = useState("all");

  const load = () => {
    if (!isCoord) return;
    setLoading(true);
    apiFetch<{ tasks: ReportTask[] }>(`/api/reports?from=${from}&to=${to}`)
      .then(d => setTasks(d.tasks))
      .catch(() => toast.error("Erro ao carregar relatório"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [isCoord]);

  const clients = useMemo(() => [...new Set(tasks.map(t => t.client).filter(Boolean) as string[])].sort(), [tasks]);
  const editors = useMemo(() => {
    const map = new Map<number, string>();
    tasks.forEach(t => { if (t.assignee) map.set(t.assignee.id, t.assignee.name); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);
  const coords = useMemo(() => {
    const map = new Map<number, string>();
    tasks.forEach(t => { if (t.coordinator && t.coordinator.id !== user?.id) map.set(t.coordinator.id, t.coordinator.name); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks, user]);

  const filtered = useMemo(() => tasks.filter(t => {
    if (fStatus     !== "all" && t.status                       !== fStatus)     return false;
    if (fClient     !== "all" && (t.client ?? "")               !== fClient)     return false;
    if (fEditor     !== "all" && String(t.assignee?.id ?? "")   !== fEditor)     return false;
    if (fCoord      !== "all" && String(t.coordinator?.id ?? "") !== fCoord)     return false;
    if (fPriority   !== "all" && t.priority                     !== fPriority)   return false;
    if (fComplexity !== "all" && t.complexity                   !== fComplexity) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.title.toLowerCase().includes(q)
        && !(t.client?.toLowerCase().includes(q) ?? false)
        && !(t.assignee?.name.toLowerCase().includes(q) ?? false)
        && !(t.coordinator?.name.toLowerCase().includes(q) ?? false)) return false;
    }
    return true;
  }), [tasks, fStatus, fClient, fEditor, fCoord, fPriority, fComplexity, search]);

  const hasFilters = fStatus !== "all" || fClient !== "all" || fEditor !== "all"
    || fCoord !== defaultCoord || fPriority !== "all" || fComplexity !== "all" || search;
  const clearFilters = () => {
    setFStatus("all"); setFClient("all"); setFEditor("all");
    setFCoord(defaultCoord); setFPriority("all"); setFComplexity("all"); setSearch("");
  };

  const total       = filtered.length;
  const completed   = filtered.filter(t => t.status === "completed").length;
  const inReview    = filtered.filter(t => t.status === "review").length;
  const revTotal    = filtered.reduce((s, t) => s + t.revisionCount, 0);

  // ── Gerar documento HTML limpo em nova aba ───────────────────────────────
  const openDocument = () => {
    const rows = filtered.map(t => {
      const sc = STATUS_COLORS[t.status] ?? { bg: "#f1f5f9", color: "#475569" };
      return `
        <tr>
          <td class="code">${t.taskCode ?? "—"}</td>
          <td><span class="dot" style="background:${t.color}"></span>${escHtml(t.title)}</td>
          <td>${escHtml(t.client ?? "—")}</td>
          <td>${escHtml(t.assignee?.name ?? "—")}</td>
          <td>${escHtml(t.coordinator?.name ?? "—")}</td>
          <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${STATUS_LABEL[t.status] ?? t.status}</span></td>
          <td>${PRIORITY_LABEL[t.priority] ?? t.priority}</td>
          <td>${COMPLEXITY_LABEL[t.complexity] ?? t.complexity}</td>
          <td class="center">${t.revisionCount > 0 ? `<span class="rev">${t.revisionCount}×</span>` : "—"}</td>
          <td>${t.dueDate ? fmtD(t.dueDate) : "—"}</td>
          <td>${fmtD(t.createdAt)}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Tarefas — ${fmtD(from)} a ${fmtD(to)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; font-size:11px; color:#111; background:#fff; padding:28px 32px; }

  /* ── Header ── */
  .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:14px; border-bottom:2px solid #111; margin-bottom:16px; }
  .header-left h1 { font-size:20px; font-weight:800; letter-spacing:-0.3px; }
  .header-left p  { font-size:10px; color:#666; margin-top:3px; }
  .header-right   { text-align:right; font-size:10px; color:#555; line-height:1.7; }
  .header-right strong { font-size:12px; color:#111; display:block; }

  /* ── Summary ── */
  .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:18px; }
  .stat { border:1px solid #e5e5e5; border-radius:6px; padding:10px 12px; }
  .stat .lbl { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:#888; margin-bottom:2px; }
  .stat .val { font-size:22px; font-weight:800; }

  /* ── Table ── */
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  col.c-code { width:72px; }
  col.c-title { width:220px; }
  col.c-client { width:110px; }
  col.c-editor { width:120px; }
  col.c-coord { width:120px; }
  col.c-status { width:96px; }
  col.c-prio { width:60px; }
  col.c-comp { width:72px; }
  col.c-rev { width:56px; }
  col.c-due { width:68px; }
  col.c-created { width:68px; }

  thead tr { background:#f5f5f5; }
  th { padding:7px 8px; text-align:left; font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#555; white-space:nowrap; border-bottom:1px solid #ddd; overflow:hidden; }
  td { padding:6px 8px; border-bottom:1px solid #f0f0f0; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  tr:nth-child(even) { background:#fafafa; }

  .code { font-family:monospace; font-size:10px; font-weight:700; color:#555; }
  .dot  { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle; flex-shrink:0; }
  .badge { display:inline-block; padding:2px 7px; border-radius:20px; font-size:9px; font-weight:700; white-space:nowrap; }
  .rev  { display:inline-block; padding:1px 6px; background:#fef3c7; color:#92400e; border:1px solid #fde68a; border-radius:4px; font-size:9px; font-weight:700; }
  .center { text-align:center; }

  /* ── Print ── */
  @media print {
    @page { size:A4 landscape; margin:1.2cm 1.5cm; }
    body { padding:0; font-size:10px; }
    tr { page-break-inside:avoid; }
    .stat .val { font-size:18px; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>Relatório de Tarefas</h1>
    <p>Período: <strong>${fmtD(from)}</strong> → <strong>${fmtD(to)}</strong> &nbsp;·&nbsp; ${total} tarefa${total !== 1 ? "s" : ""}</p>
  </div>
  <div class="header-right">
    ${user?.name ? `<strong>${escHtml(user.name)}</strong>` : ""}
    Gerado em ${fmtD(new Date().toISOString().split("T")[0])}
  </div>
</div>

<div class="summary">
  <div class="stat"><div class="lbl">Total no período</div><div class="val">${total}</div></div>
  <div class="stat"><div class="lbl">Concluídas</div><div class="val" style="color:#16a34a">${completed}</div></div>
  <div class="stat"><div class="lbl">Em revisão</div><div class="val" style="color:#f59e0b">${inReview}</div></div>
  <div class="stat"><div class="lbl">Revisões totais</div><div class="val" style="color:#6366f1">${revTotal}</div></div>
</div>

<table>
  <colgroup>
    <col class="c-code"><col class="c-title"><col class="c-client"><col class="c-editor">
    <col class="c-coord"><col class="c-status"><col class="c-prio"><col class="c-comp">
    <col class="c-rev"><col class="c-due"><col class="c-created">
  </colgroup>
  <thead>
    <tr>
      <th>#</th><th>Tarefa</th><th>Cliente</th><th>Editor</th><th>Coordenador</th>
      <th>Status</th><th>Prior.</th><th>Compl.</th><th>Rev.</th><th>Entrega</th><th>Criada</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) { toast.error("Popup bloqueado. Permita pop-ups para este site."); return; }
    win.document.write(html);
    win.document.close();
  };

  // ── Exportar CSV ─────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ["#","Tarefa","Cliente","Editor","Coordenador","Status","Prioridade","Complexidade","Revisões","Entrega","Criada em"];
    const rows = filtered.map(t => [
      t.taskCode ?? "",
      t.title,
      t.client ?? "",
      t.assignee?.name ?? "",
      t.coordinator?.name ?? "",
      STATUS_LABEL[t.status] ?? t.status,
      PRIORITY_LABEL[t.priority] ?? t.priority,
      COMPLEXITY_LABEL[t.complexity] ?? t.complexity,
      t.revisionCount,
      t.dueDate ? fmtD(t.dueDate) : "",
      fmtD(t.createdAt),
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-${from}-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!isCoord)
    return <div className="text-[hsl(var(--muted-foreground))] text-sm py-8 text-center">Acesso restrito a coordenadores.</div>;

  return (
    <div className="space-y-3">

      {/* ── Período + Ações ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-[hsl(var(--card))] card-float p-4">
        <div className="space-y-1">
          <Label className="text-xs text-[hsl(var(--muted-foreground))]">De</Label>
          <DateTimePicker value={from} onChange={v => setFrom(v)} placeholder="Data inicial" className="w-44 h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[hsl(var(--muted-foreground))]">Até</Label>
          <DateTimePicker value={to} onChange={v => setTo(v)} placeholder="Data final" className="w-44 h-8 text-xs" />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>{loading ? "Buscando…" : "Buscar"}</Button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCSV} className="flex items-center gap-1.5" title="Exportar como CSV (Excel)">
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={openDocument} className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Gerar documento
          </Button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-[hsl(var(--card))] card-float p-3">
        <div className="flex items-center gap-2 rounded-md border bg-[hsl(var(--muted))]/30 px-2.5 h-8 w-52">
          <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
        </div>
        <Select value={fStatus} onChange={setFStatus}>
          <option value="all">Todos os status</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
        </Select>
        <Select value={fClient} onChange={setFClient}>
          <option value="all">Todos os clientes</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select value={fEditor} onChange={setFEditor}>
          <option value="all">Todos os editores</option>
          {editors.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </Select>
        <Select value={fCoord} onChange={setFCoord}>
          <option value="all">Geral</option>
          {user && <option value={String(user.id)}>Minhas</option>}
          {coords.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </Select>
        <Select value={fPriority} onChange={setFPriority}>
          <option value="all">Todas as prioridades</option>
          <option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option>
        </Select>
        <Select value={fComplexity} onChange={setFComplexity}>
          <option value="all">Todas as complexidades</option>
          <option value="high">Complexa</option><option value="medium">Moderada</option><option value="low">Simples</option>
        </Select>
        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors ml-1">
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
      </div>

      {/* ── Resumo ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total no período", value: total,     cls: "" },
          { label: "Concluídas",       value: completed, cls: "text-green-600" },
          { label: "Em revisão",       value: inReview,  cls: "text-amber-500" },
          { label: "Revisões totais",  value: revTotal,  cls: "text-[hsl(var(--primary))]" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border bg-[hsl(var(--card))] card-float p-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{k.label}</p>
            <p className={`text-xl font-semibold tabular-nums mt-0.5 ${k.cls || "text-[hsl(var(--foreground))]"}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* ── Prévia ── */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-[hsl(var(--muted))]/20">
          <span className="text-sm font-semibold">Prévia</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-2 py-0.5">{total}</span>
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando…</p>
        ) : total === 0 ? (
          <p className="py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">Nenhuma tarefa encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[hsl(var(--muted))]/10">
                  {["#","Tarefa","Cliente","Editor","Coordenador","Status","Prioridade","Complexidade","Rev.","Entrega","Criada"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-widest whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-[hsl(var(--muted))]/10 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs font-bold text-[hsl(var(--muted-foreground))]">{t.taskCode ?? "—"}</td>
                    <td className="px-4 py-2 max-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                        <span className="text-xs font-medium truncate">{t.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] max-w-[120px]"><span className="truncate block">{t.client ?? "—"}</span></td>
                    <td className="px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] max-w-[120px]"><span className="truncate block">{t.assignee?.name ?? "—"}</span></td>
                    <td className="px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] max-w-[120px]"><span className="truncate block">{t.coordinator?.name ?? "—"}</span></td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-[3px] rounded-[4px] text-[11px] font-medium leading-none whitespace-nowrap ${STATUS_CHIP[t.status] ?? "bg-slate-500/10 text-slate-500"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                    </td>
                    <td className="px-4 py-2"><PriorityBadge priority={t.priority} showLabel /></td>
                    <td className="px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">{COMPLEXITY_LABEL[t.complexity] ?? t.complexity}</td>
                    <td className="px-4 py-2 text-center">
                      {t.revisionCount > 0
                        ? <Badge className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 text-[10px] px-1.5">{t.revisionCount}×</Badge>
                        : <span className="text-xs text-[hsl(var(--muted-foreground))]/40">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">{t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
                    <td className="px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
