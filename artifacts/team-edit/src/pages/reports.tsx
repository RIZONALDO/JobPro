import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Printer, X } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";
import { STATUS_LABEL, STATUS_CLASS } from "@/lib/status";
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

const STATUS_ORDER = ["pending", "in_progress", "in_revision", "review", "completed"];
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const COORD_ROLES = ["admin", "supervisor", "coordinator"];

function fmtPeriod(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

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

  const [from, setFrom]   = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0]);
  const [to, setTo]       = useState(today.toISOString().split("T")[0]);
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
  const editors  = useMemo(() => {
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

  const total     = filtered.length;
  const completed = filtered.filter(t => t.status === "completed").length;
  const inRev     = filtered.filter(t => t.status === "in_revision").length;
  const revTotal  = filtered.reduce((s, t) => s + t.revisionCount, 0);

  if (!isCoord)
    return <div className="text-[hsl(var(--muted-foreground))] text-sm py-8 text-center">Acesso restrito a coordenadores.</div>;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          table { font-size: 11px; }
          th, td { padding: 6px 8px !important; }
        }
      `}</style>

      <div className="space-y-3">

        {/* ── Período + Imprimir ── */}
        <div className="no-print flex flex-wrap items-end gap-3 rounded-xl border bg-[hsl(var(--card))] card-float p-4">
          <div className="space-y-1">
            <Label className="text-xs text-[hsl(var(--muted-foreground))]">De</Label>
            <DateTimePicker value={from} onChange={v => setFrom(v)} placeholder="Data inicial" className="w-44 h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-[hsl(var(--muted-foreground))]">Até</Label>
            <DateTimePicker value={to} onChange={v => setTo(v)} placeholder="Data final" className="w-44 h-8 text-xs" />
          </div>
          <Button size="sm" onClick={load} disabled={loading}>{loading ? "Buscando…" : "Buscar"}</Button>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={() => window.print()} className="flex items-center gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Button>
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border bg-[hsl(var(--card))] card-float p-3">
          <div className="flex items-center gap-2 rounded-md border bg-[hsl(var(--muted))]/30 px-2.5 h-8 w-52">
            <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar…"
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
            <option value="high">Alta</option>
            <option value="medium">Média</option>
            <option value="low">Baixa</option>
          </Select>
          <Select value={fComplexity} onChange={setFComplexity}>
            <option value="all">Todas as complexidades</option>
            <option value="high">Complexa</option>
            <option value="medium">Moderada</option>
            <option value="low">Simples</option>
          </Select>
          {hasFilters && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors ml-1">
              <X className="h-3 w-3" /> Limpar
            </button>
          )}
        </div>

        {/* ── Resumo ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4">
          {[
            { label: "Total no período", value: total,     cls: "" },
            { label: "Concluídas",       value: completed, cls: "text-green-600" },
            { label: "Em revisão",       value: inRev,     cls: "text-orange-500" },
            { label: "Revisões totais",  value: revTotal,  cls: "text-[hsl(var(--primary))]" },
          ].map(k => (
            <div key={k.label} className="rounded-xl border bg-[hsl(var(--card))] card-float p-4">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{k.label}</p>
              <p className={`text-xl font-semibold tabular-nums mt-0.5 ${k.cls || "text-[hsl(var(--foreground))]"}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* ── Cabeçalho de impressão ── */}
        <div className="hidden print:block mb-4 border-b pb-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Relatório de Tarefas</h1>
              <p className="text-sm text-gray-500 mt-1">
                Período: <strong>{fmtPeriod(from)}</strong> → <strong>{fmtPeriod(to)}</strong>
                &nbsp;·&nbsp;{total} tarefa{total !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="text-right text-sm text-gray-500">
              {user?.name && (
                <p className="font-semibold text-gray-800">{user.name}</p>
              )}
              <p>Gerado em {fmtPeriod(new Date().toISOString().split("T")[0])}</p>
            </div>
          </div>
        </div>

        {/* ── Tabela ── */}
        <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
          <div className="no-print flex items-center justify-between px-5 py-3 border-b bg-[hsl(var(--muted))]/20">
            <span className="text-sm font-semibold">Tarefas</span>
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
                    {[
                      { h: "#",           w: "w-20"  },
                      { h: "Tarefa",      w: "w-64"  },
                      { h: "Cliente",     w: "w-36"  },
                      { h: "Editor",      w: "w-36"  },
                      { h: "Coordenador", w: "w-36"  },
                      { h: "Status",      w: "w-32"  },
                      { h: "Prioridade",  w: "w-24"  },
                      { h: "Complexidade",w: "w-28"  },
                      { h: "Revisões",    w: "w-20 text-center" },
                      { h: "Entrega",     w: "w-24"  },
                      { h: "Criada em",   w: "w-24"  },
                    ].map(({ h, w }) => (
                      <th key={h} className={`text-left px-4 py-2.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-widest whitespace-nowrap ${w}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-[hsl(var(--muted))]/10 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-[hsl(var(--muted-foreground))]">
                        {t.taskCode ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 max-w-[256px]">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color ?? "#6366f1" }} />
                          <span className="text-xs font-medium truncate">{t.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] max-w-[144px]">
                        <span className="truncate block">{t.client ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] max-w-[144px]">
                        <span className="truncate block">{t.assignee?.name ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] max-w-[144px]">
                        <span className="truncate block">{t.coordinator?.name ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge className={`text-[10px] px-1.5 whitespace-nowrap ${STATUS_CLASS[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <PriorityBadge priority={t.priority} showLabel />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {COMPLEXITY_LABEL[t.complexity] ?? t.complexity}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {t.revisionCount > 0
                          ? <Badge className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 text-[10px] px-1.5">{t.revisionCount}×</Badge>
                          : <span className="text-xs text-[hsl(var(--muted-foreground))]/40">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {t.dueDate ? fmtDate(t.dueDate) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                        {fmtDate(t.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
