import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, Question } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiDelete, apiFetch, apiPost } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { coordColor, fmtH, inQueue, personName, useBoard, type Board } from "@/lib/fila";
import { Alert, Btn, Chip, Kv, Section, Who, inputCls } from "@/components/fila/ui";
import { JobForm } from "@/components/fila/JobForm";
import { QueueTrack } from "@/components/fila/QueueTrack";

/** Supervisão: jobs na fila de cada editor, jobs sem editor e quem mexe na fila. */
export default function Supervisao() {
  usePageTitle("Supervisão da fila");
  const { board, error, reload } = useBoard();
  if (error) return <p className="p-6 text-sm text-rose-500">{error}</p>;
  if (!board) return <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Carregando…</p>;
  return <View board={board} reload={reload} />;
}

function View({ board, reload }: { board: Board; reload: () => void }) {
  const { openTask } = useTaskModal();
  const [move, setMove] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<{ day: string; name: string }[]>([]);
  const [hDay, setHDay] = useState(""); const [hName, setHName] = useState("");
  const loadH = () => apiFetch<{ day: string; name: string }[]>("/api/queue/holidays").then(setHolidays).catch(() => {});
  useEffect(() => { loadH(); }, []);

  const coords = [...new Set(board.tasks.map(t => t.coordId).filter(Boolean))] as number[];
  const statCoords = [...new Set([...coords, ...Object.keys(board.stats ?? {}).map(Number)])];
  const scale = Math.max(1, ...board.editors.map(e => e.count));
  const noEditor = board.tasks.filter(t => !t.editorId && t.status === "pending" && !t.hold);
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Supervisão da fila</h1>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Quantos jobs cada editor tem na fila, de quais gestores e quantos estão atrasados.</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {board.editors.map(o => {
          const pl = board.tasks.find(t => t.editorId === o.id && t.playing), nx = board.tasks.find(t => t.editorId === o.id && inQueue(t) && t.pos === 0);
          return (
            <Section key={o.id} title={<span className="inline-flex items-center gap-2">{o.name}{o.offToday && <Chip tone="warn">{o.offToday}</Chip>}</span>}
              right={<Chip tone={o.late ? "bad" : "neu"}>{o.count} na fila{o.late ? ` · ${o.late} atrasado${o.late > 1 ? "s" : ""}` : ""}</Chip>}>
              <div className="flex h-3.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                {Object.entries(o.byCoord).map(([c, n]) => <i key={c} className="block h-full" style={{ width: `${(n / scale) * 100}%`, background: coordColor(+c) }} title={`${personName(board, +c)}: ${n}`} />)}
              </div>
              {Object.entries(o.byCoord).map(([c, n]) => <Kv key={c} k={<Who id={+c} name={personName(board, +c)} />} v={`${n} job${n > 1 ? "s" : ""}`} />)}
              <Kv k="Agora" v={pl ? <span className="text-emerald-600 dark:text-emerald-400">em edição: {pl.title}</span> : nx ? <span className="font-normal">próximo: {nx.title}</span> : <span className="font-normal">disponível para novos jobs</span>} />
            </Section>
          );
        })}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Precisa de você">
            {noEditor.length === 0 && <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nada pendente. Jobs sem editor aparecem aqui.</p>}
            {noEditor.map(t => (
              <Alert key={t.id} tone="warn" icon={<Question />} title={`“${t.title}” sem editor (${personName(board, t.coordId)})`}>
                <span>{fmtH(t.est)} de trabalho. {personName(board, t.coordId).split(" ")[0]} pediu à supervisão para escolher o editor.</span>
                <div className="flex flex-wrap gap-2"><Btn v="pri" size="sm" onClick={() => setMove(t.id)}>Escolher editor</Btn><Btn size="sm" v="ghost" onClick={() => openTask(t.id)}>Ver job</Btn></div>
              </Alert>
            ))}
          </Section>
          <Section title="Quem mexe na fila" sub="Últimos 30 dias. Não é punição: mostra onde o planejamento muda.">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                  {["Gestor", "Jobs na fila", "Jobs movidos", "Alterações do cliente"].map((h, i) => <th key={h} className={cn("whitespace-nowrap px-2 py-1.5 font-semibold", i ? "text-right" : "text-left")}>{h}</th>)}
                </tr></thead>
                <tbody>{statCoords.map(c => {
                  const st = board.stats?.[c] ?? { moves: 0, changes: 0 };
                  const n = board.tasks.filter(t => inQueue(t) && t.coordId === c).length;
                  return <tr key={c} className="border-t">
                    <td className="px-2 py-1.5"><Who id={c} name={personName(board, c)} /></td>
                    {[n, st.moves, st.changes].map((v, i) => <td key={i} className="px-2 py-1.5 text-right font-mono">{v}</td>)}
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </Section>
        </div>
        <Section title="Feriados" sub="Nesses dias não há expediente: as horas de trabalho não contam e o sistema não manda lembretes. Ausências (férias, folga) vêm de Membros.">
          <div className="flex flex-wrap gap-2">
            <input type="date" value={hDay} onChange={e => setHDay(e.target.value)} className={inputCls} />
            <input value={hName} onChange={e => setHName(e.target.value)} placeholder="Nome" className={cn(inputCls, "min-w-0 flex-1")} />
            <Btn size="sm" v="pri" onClick={async () => { try { await apiPost("/api/queue/holidays", { day: hDay, name: hName }); setHDay(""); setHName(""); loadH(); reload(); } catch (e) { toast.error((e as Error).message); } }}>Adicionar</Btn>
          </div>
          <ul className="flex max-h-72 flex-col gap-1 overflow-auto text-[13px]">
            {holidays.filter(h => h.day >= todayKey).map(h => (
              <li key={h.day} className="flex items-center justify-between gap-2 border-t pt-1 first:border-t-0">
                <span><span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{h.day.split("-").reverse().join("/")}</span> {h.name}</span>
                <button type="button" aria-label={`Remover ${h.name}`} className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:text-rose-500" onClick={async () => { await apiDelete(`/api/queue/holidays/${h.day}`).catch(e => toast.error(e.message)); loadH(); reload(); }}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <QueueTrack board={board} me={null} onOpen={t => openTask(t.id)} onMove={async (id, editorId, index) => {
        try { const r = await apiPost<{ message?: string }>(`/api/queue/tasks/${id}/move`, { editorId, index }); toast.success(r?.message ?? "Movido"); reload(); }
        catch (e) { toast.error((e as Error).message); }
      }} />
      <JobForm open={move != null} onOpenChange={o => { if (!o) setMove(null); }} taskId={move} mode="move" onSaved={reload} />
    </div>
  );
}
