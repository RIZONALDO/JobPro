/**
 * Peças da barra superior:
 *  - NowChip: o "agora" de cada pessoa. Editor vê o job em edição (ou o próximo); gestor e supervisão veem
 *    quantas coisas esperam por eles (pedidos, travados, estimativas contestadas, jobs sem editor). Leva para a Fila.
 *  - QuickCreate: atalhos de criação (novo job, recado no mural, ausência), conforme o perfil.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useBoard, fmtH } from "@/lib/fila";
import { JobForm } from "@/components/fila/JobForm";
import { LiveDot } from "@/components/fila/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CheckCircle2, ClipboardList, Megaphone, Palmtree, Plus, ListOrdered } from "@/lib/icons";

const chip = "inline-flex h-9 min-w-0 max-w-full overflow-hidden items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] font-medium transition-colors hover:bg-[hsl(var(--foreground)/0.05)]";

export function NowChip() {
  const { user } = useAuth();
  const { board } = useBoard();
  const [, navigate] = useLocation();
  if (!user || !board) return null;
  const me = user.id, isSup = user.role === "admin" || user.role === "supervisor";
  const go = () => navigate("/fila");

  if (user.role === "editor") {
    const mine = board.tasks.filter(t => t.editorId === me);
    const playing = mine.find(t => t.playing);
    const next = mine.filter(t => t.slot).sort((a, b) => a.slot!.pos - b.slot!.pos)[0];
    if (playing) return (
      <button type="button" onClick={go} title={`Em edição: ${playing.title}`} className={cn(chip, "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300")}>
        <LiveDot className="h-2 w-2 shrink-0" />
        <span className="max-sm:hidden">Editando</span>
        <b className="min-w-0 max-w-[220px] truncate font-semibold">{playing.title}</b>
        <span className="shrink-0 tabular-nums opacity-80">{fmtH(playing.worked)}</span>
      </button>
    );
    return (
      <button type="button" onClick={go} className={cn(chip, "text-[hsl(var(--muted-foreground))]")}>
        <ListOrdered className="h-4 w-4 shrink-0" />
        {next ? <><span className="max-sm:hidden">Próximo:</span><b className="min-w-0 max-w-[220px] truncate font-semibold text-[hsl(var(--foreground))]">{next.title}</b></> : "Fila vazia"}
      </button>
    );
  }

  // gestor e supervisão: o que espera por eles
  const reqs = board.requests.filter(r => r.approverId === me || (isSup && r.escalated && r.approverId !== me)).length;
  const own = (coordId: number | null) => isSup || coordId === me;
  const blocked = board.tasks.filter(t => t.status === "paused" && own(t.coordId)).length;
  const disputes = board.tasks.filter(t => t.estDisputeOpen && t.coordId === me).length;
  const noEditor = board.tasks.filter(t => !t.editorId && t.status === "pending" && !t.hold && own(t.coordId)).length;
  const n = reqs + blocked + disputes + noEditor;
  const parts = [reqs && `${reqs} pedido${reqs > 1 ? "s" : ""}`, blocked && `${blocked} travado${blocked > 1 ? "s" : ""}`, disputes && `${disputes} estimativa${disputes > 1 ? "s" : ""} contestada${disputes > 1 ? "s" : ""}`, noEditor && `${noEditor} sem editor`].filter(Boolean).join(" · ");
  if (!n) return (
    <button type="button" onClick={go} className={cn(chip, "text-[hsl(var(--muted-foreground))]")} title="Nada esperando você na fila">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /><span className="max-sm:hidden">Tudo em dia</span>
    </button>
  );
  return (
    <button type="button" onClick={go} title={parts} className={cn(chip, "border-amber-500/35 bg-amber-500/[0.07]")}>
      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-black">{n}</span>
      <span className="max-sm:hidden">{n === 1 ? "precisa de você" : "precisam de você"}</span>
      <span className="hidden max-w-[260px] truncate text-[12px] text-[hsl(var(--muted-foreground))] 2xl:inline">· {parts}</span>
    </button>
  );
}

export function QuickCreate() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [job, setJob] = useState(false);
  if (!user) return null;
  const coord = ["admin", "supervisor", "coordinator"].includes(user.role);
  const sup = user.role === "admin" || user.role === "supervisor";
  const mural = user.role !== "admin";
  const items = [
    coord && { k: "job", icon: ClipboardList, label: "Novo job", hint: "Escolhe editor e prazo", on: () => setJob(true) },
    mural && { k: "mural", icon: Megaphone, label: "Recado no mural", hint: "Para a equipe toda", on: () => navigate("/feed") },
    sup && { k: "aus", icon: Palmtree, label: "Registrar ausência", hint: "Férias, folga, afastamento", on: () => navigate("/team/ausencias") },
  ].filter(Boolean) as { k: string; icon: typeof Plus; label: string; hint: string; on: () => void }[];
  if (!items.length) return null;
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Criar" className="inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[13px] font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--foreground)/0.05)] hover:text-[hsl(var(--foreground))] data-[state=open]:bg-[hsl(var(--foreground)/0.07)] data-[state=open]:text-[hsl(var(--foreground))]">
          <Plus className="h-4 w-4" /><span className="max-xl:hidden">Criar</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 p-1.5">
        {items.map(({ k, icon: I, label, hint, on }) => (
          <DropdownMenuItem key={k} onSelect={on} className="cursor-pointer gap-3 rounded-lg py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-[hsl(var(--background))]"><I className="h-4 w-4" /></span>
            <span className="min-w-0"><b className="block text-[13px] font-semibold">{label}</b><span className="block text-[11.5px] text-[hsl(var(--muted-foreground))]">{hint}</span></span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    {coord && <JobForm open={job} onOpenChange={setJob} />}
  </>;
}
