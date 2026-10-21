import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Link2 } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { readJobNav } from "@/contexts/TaskModalContext";
import { JobDetail, type JobHead } from "@/components/JobDetail";
import { clientColor } from "@/components/fila/job-shared";

const FROM_LABEL: [RegExp, string][] = [[/^\/tasks/, "Jobs"], [/^\/fila\/supervisao/, "Supervisão"], [/^\/fila/, "Fila"], [/^\/feed/, "Feed"], [/^\/reports/, "Relatórios"], [/^\/$/, "Dashboard"]];
const muted = "text-[hsl(var(--muted-foreground))]";
const kbd = "rounded border bg-[hsl(var(--muted))] px-1 font-mono text-[10px] leading-4";

/**
 * Página do job. Barra de cima: voltar para onde estava, onde está (Jobs › Cliente › código),
 * anterior / próximo da lista de origem e copiar link. Teclado: Esc volta, J/K ou ← → navegam.
 */
export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [head, setHead] = useState<JobHead | null>(null);
  usePageTitle(head ? `${head.taskCode ?? ""} ${head.title}`.trim() : "Job");

  const nav = useMemo(() => readJobNav(), []);
  const home = user?.role === "editor" ? "/fila" : "/tasks";
  const from = nav?.from ?? home;
  const fromLabel = FROM_LABEL.find(([re]) => re.test(from))?.[1] ?? "Voltar";
  const ids = nav?.ids ?? [];
  const pos = ids.indexOf(taskId);
  const prevId = pos > 0 ? ids[pos - 1] : null, nextId = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null;

  const back = useCallback(() => navigate(from), [navigate, from]);
  // anterior/próximo troca o endereço sem empilhar histórico: o "voltar" do navegador volta para a lista
  const go = useCallback((n: number | null) => { if (n != null) navigate(`/jobs/${n}`, { replace: true }); }, [navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable]") || document.querySelector("[role=dialog], [role=menu]")) return;
      if (e.key === "Escape") back();
      else if (e.key === "k" || e.key === "ArrowLeft") go(prevId);
      else if (e.key === "j" || e.key === "ArrowRight") go(nextId);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, go, prevId, nextId]);

  const copy = () => { navigator.clipboard.writeText(`${window.location.origin}/jobs/${taskId}`); toast.success("Link do job copiado"); };
  const iconBtn = "grid h-8 w-8 place-items-center rounded-lg border text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] disabled:pointer-events-none disabled:opacity-35";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-10">
      {/* barra de navegação: gruda no topo ao rolar */}
      <nav className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center gap-2 border-b bg-[hsl(var(--background)/0.85)] px-4 py-2.5 backdrop-blur md:-mx-6 md:-mt-6 md:px-6">
        <button type="button" onClick={back} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]">
          <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{fromLabel}</span>
        </button>
        <ol className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
          {head && <>
            {head.client && <li className="hidden min-w-0 items-center gap-1.5 md:flex"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientColor(head.client) }} /><span className="truncate">{head.client}</span><span className={cn("ml-1.5", muted)}>/</span></li>}
            <li className="min-w-0 truncate font-semibold"><span className={cn("mr-1.5 font-mono text-xs font-normal", muted)}>{head.taskCode}</span>{head.title}</li>
          </>}
        </ol>
        {ids.length > 1 && pos >= 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn("hidden text-xs lg:inline", muted)}>{nav?.label ? `${nav.label} · ` : ""}{pos + 1} de {ids.length}</span>
            <button type="button" className={iconBtn} disabled={prevId == null} onClick={() => go(prevId)} title="Job anterior (K ou ←)" aria-label="Job anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className={iconBtn} disabled={nextId == null} onClick={() => go(nextId)} title="Próximo job (J ou →)" aria-label="Próximo job"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
        <button type="button" className={iconBtn} onClick={copy} title="Copiar link do job" aria-label="Copiar link do job"><Link2 className="h-4 w-4" /></button>
      </nav>

      <JobDetail key={taskId} taskId={taskId} onLoaded={setHead} onGone={back} />

      <p className={cn("hidden items-center justify-center gap-3 text-[11px] lg:flex", muted)}>
        <span><kbd className={kbd}>Esc</kbd> volta para {fromLabel}</span>
        {ids.length > 1 && pos >= 0 && <span><kbd className={kbd}>K</kbd> <kbd className={kbd}>J</kbd> anterior / próximo</span>}
      </p>
    </div>
  );
}
