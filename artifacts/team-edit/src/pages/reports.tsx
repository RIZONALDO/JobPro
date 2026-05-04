import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Search, TrendingUp, Users, FolderOpen } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";

interface ReportTask {
  task: { id: number; title: string; priority: string; complexity: string; updatedAt: string; revisionCount: number };
  job: { id: number; name: string; dueDate: string | null };
  project: { id: number; name: string; client: string | null; color: string };
  assignee: { id: number; name: string; avatarUrl: string | null } | null;
  revisionCount: number;
}
interface ReportSummary {
  totalDelivered: number;
  byProject: { projectId: number; projectName: string; count: number }[];
  byEditor: { userId: number; name: string; count: number }[];
}
interface ReportData { data: ReportTask[]; summary: ReportSummary; }

const PRIORITY_LABEL: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const COMPLEXITY_LABEL: Record<string, string> = { low: "Simples", medium: "Moderada", high: "Complexa" };
const PRIORITY_CLS: Record<string, string> = {
  low: "text-green-600", medium: "text-amber-600", high: "text-red-600",
};

export default function Reports() {
  usePageTitle("Relatórios");
  const { toast } = useToast();
  const today = new Date();
  const [from, setFrom] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0]
  );
  const [to, setTo] = useState(today.toISOString().split("T")[0]);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    apiFetch<ReportData>(`/api/reports?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => toast({ title: "Erro ao carregar relatório", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = data?.data?.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.task.title.toLowerCase().includes(q) ||
      t.project.name.toLowerCase().includes(q) ||
      t.job.name.toLowerCase().includes(q) ||
      (t.assignee?.name.toLowerCase().includes(q) ?? false)
    );
  }) ?? [];

  return (
    <div className="space-y-4">

      {/* Filtros */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-[hsl(var(--muted-foreground))]">De</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40 h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-[hsl(var(--muted-foreground))]">Até</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40 h-8 text-sm" />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? "Buscando..." : "Aplicar filtro"}
        </Button>
        <div className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--muted))]/40 px-2.5 h-8 w-52 ml-auto">
          <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar tarefa, projeto, editor..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          />
        </div>
      </div>

      {/* Cards de resumo */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

          {/* Total entregue */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-5 flex items-center gap-4">
            <div className="h-11 w-11 rounded-2xl bg-green-500/10 flex items-center justify-center shrink-0">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-3xl font-bold tracking-tight text-green-500">{data.summary.totalDelivered}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Tarefas entregues no período</p>
            </div>
          </div>

          {/* Por projeto */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-4">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="h-4 w-4 text-[hsl(var(--primary))]" />
              <p className="text-sm font-semibold">Por projeto</p>
            </div>
            <div className="space-y-2">
              {data.summary.byProject.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum dado</p>
              ) : data.summary.byProject.slice(0, 5).map(p => (
                <div key={p.projectId} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="truncate text-[hsl(var(--foreground))]">{p.projectName}</span>
                      <span className="font-semibold shrink-0 ml-2">{p.count}</span>
                    </div>
                    <div className="h-1 rounded-full bg-[hsl(var(--muted))]">
                      <div
                        className="h-full rounded-full bg-[hsl(var(--primary))]"
                        style={{ width: `${Math.round(p.count / data.summary.totalDelivered * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Por editor */}
          <div className="rounded-xl border bg-[hsl(var(--card))] card-float p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-[hsl(var(--primary))]" />
              <p className="text-sm font-semibold">Por editor</p>
            </div>
            <div className="space-y-2">
              {data.summary.byEditor.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Nenhum dado</p>
              ) : data.summary.byEditor.slice(0, 5).map(e => (
                <div key={e.userId} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="truncate text-[hsl(var(--foreground))]">{e.name}</span>
                      <span className="font-semibold shrink-0 ml-2">{e.count}</span>
                    </div>
                    <div className="h-1 rounded-full bg-[hsl(var(--muted))]">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{ width: `${Math.round(e.count / data.summary.totalDelivered * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-[hsl(var(--muted))]/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Tarefas entregues</span>
            <span className="text-[11px] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] rounded-full px-2 py-0.5">
              {filtered.length}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Nenhuma tarefa encontrada no período.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[hsl(var(--muted))]/10">
                  {["Tarefa", "Projeto / Job", "Editor", "Entregue em", "Prioridade", "Complexidade", "Revisões"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(t => (
                  <tr key={t.task.id} className="hover:bg-[hsl(var(--muted))]/20 transition-colors">
                    <td className="px-4 py-3 font-medium max-w-[200px]">
                      <p className="truncate">{t.task.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div style={{ borderLeft: `3px solid ${t.project.color}88` }} className="pl-2.5">
                        <p className="text-xs font-medium truncate max-w-[140px]">{t.project.name}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{t.job.name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                      {t.assignee?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                      {fmtDate(t.task.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${PRIORITY_CLS[t.task.priority] ?? ""}`}>
                        {PRIORITY_LABEL[t.task.priority] ?? t.task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                      {COMPLEXITY_LABEL[t.task.complexity] ?? t.task.complexity}
                    </td>
                    <td className="px-4 py-3">
                      {t.revisionCount > 0 ? (
                        <Badge className="bg-orange-100 text-orange-700 border border-orange-200 text-[10px] px-1.5">
                          {t.revisionCount}×
                        </Badge>
                      ) : (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                      )}
                    </td>
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
