import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Moon, Play, Send } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiPost } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { coordColor, fmt, fmtH, inQueue, personName, useBoard, type Board, type QTask } from "@/lib/fila";
import { Alert, Btn, Chip, DeadlineChip, Free, Kv, Section, Who, inputCls, LiveDot } from "@/components/fila/ui";
import { Notices } from "@/components/fila/Notices";

const BLOCK_REASONS = ["Falta material do cliente", "Aguardando resposta do cliente", "Aguardando a coordenação", "Problema técnico"];

async function run(p: Promise<unknown>, ok?: string) {
  try { const r = await p as { message?: string } | undefined; toast.success(r?.message ?? ok ?? "Feito"); return true; }
  catch (e) { toast.error((e as Error).message); return false; }
}


/** Tela do editor: só os jobs dele, de todos os gestores, na ordem que os gestores definiram. Ele faz o 1º. */
export default function MinhaFila() {
  usePageTitle("Minha fila");
  const { board, error, reload } = useBoard();
  if (error) return <p className="p-6 text-sm text-rose-500">{error}</p>;
  if (!board) return <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">Carregando a fila…</p>;
  return <EditorView board={board} reload={reload} />;
}

function EditorView({ board, reload }: { board: Board; reload: () => void }) {
  const { openTask } = useTaskModal();
  const me = board.me, now = board.now;
  const ed = board.editors.find(e => e.id === me);
  const [filter, setFilter] = useState<number | "all">("all");
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState(BLOCK_REASONS[0]);
  const [blockText, setBlockText] = useState("");

  const q = useMemo(() => board.tasks.filter(t => inQueue(t) && t.editorId === me).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)), [board, me]);
  const head = q[0] ?? null;
  const rest = q.slice(1).filter(t => filter === "all" || t.coordId === filter);
  const coords = [...new Set(q.map(t => t.coordId).filter(Boolean))] as number[];
  const waiting = board.tasks.filter(t => t.editorId === me && t.status === "review");
  const blocked = board.tasks.filter(t => t.editorId === me && t.status === "paused");

  const act = async (path: string, body: unknown = {}, ok?: string) => { if (await run(apiPost(path, body), ok)) reload(); };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Minha fila</h1>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Você vê só os seus jobs. A ordem é dos gestores: faça o 1º e envie para aprovação quando terminar.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...coords] as (number | "all")[]).map(c => (
            <button key={c} type="button" onClick={() => setFilter(c)} aria-pressed={filter === c}
              className={cn("rounded-full border px-3 py-1 text-[12.5px] font-semibold text-[hsl(var(--muted-foreground))]", filter === c && "border-[hsl(var(--foreground)/0.4)] bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]")}>
              {c === "all" ? `Todos ${q.length}` : <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: coordColor(c) }} />de {personName(board, c).split(" ")[0]} {q.filter(t => t.coordId === c).length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          {ed?.offToday && <Alert tone="info" icon={<Moon />} title={`Hoje você está fora: ${ed.offToday}.`} />}

          {!head ? <Free>Nenhum job na sua fila. Você está livre.</Free>
            : filter !== "all" && head.coordId !== filter ? <Free>O job atual é de {personName(board, head.coordId)}. Filtro ativo.</Free>
            : <NowCard board={board} t={head} onOpen={() => openTask(head.id)}
                onPlay={() => act(`/api/queue/tasks/${head.id}/play`, {}, "Job em edição")}
                onSend={() => act(`/api/queue/tasks/${head.id}/send`, {}, "Enviado para aprovação")}
                blockOpen={blockOpen} setBlockOpen={setBlockOpen}
                blockUi={<div className="flex flex-col gap-2 rounded-xl border bg-[hsl(var(--background))] p-3 text-[13px]">
                  <b>Por que está travado?</b>
                  <div className="flex flex-wrap gap-2">
                    <select value={blockReason} onChange={e => setBlockReason(e.target.value)} className={inputCls}>{BLOCK_REASONS.map(r => <option key={r}>{r}</option>)}<option>Outro</option></select>
                    <input value={blockText} onChange={e => setBlockText(e.target.value)} placeholder="Detalhe (opcional)" className={cn(inputCls, "flex-1")} />
                  </div>
                  <div className="flex gap-2">
                    <Btn v="pri" size="sm" onClick={async () => { await act(`/api/queue/tasks/${head.id}/block`, { reason: [blockReason, blockText.trim()].filter(Boolean).join(": ") }, "Marcado como travado"); setBlockOpen(false); setBlockText(""); }}>Marcar travado</Btn>
                    <Btn v="ghost" size="sm" onClick={() => setBlockOpen(false)}>Cancelar</Btn>
                  </div>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">O job sai da sua fila e {personName(board, head.coordId)} é avisada(o). O próximo sobe.</span>
                </div>} />}

          <Section title="Depois" right={<span className="text-xs text-[hsl(var(--muted-foreground))]">{q.length > 1 ? `${q.length - 1} na fila` : ""}</span>}>
            {rest.length ? <ol className="flex flex-col gap-2">
              {rest.map(t => (
                <li key={t.id} className="flex flex-col gap-1.5 rounded-xl border border-l-4 bg-[hsl(var(--card))] px-3 py-2.5" style={{ borderLeftColor: coordColor(t.coordId) }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-[22px] text-[11.5px] font-bold text-[hsl(var(--muted-foreground))]">{(t.pos ?? 0) + 1}º</span>
                    <button type="button" onClick={() => openTask(t.id)} className="text-left text-sm font-semibold hover:underline">{t.title}</button>
                    <DeadlineChip t={t} now={now} />
                    {t.revisionCount > 0 && <Chip tone="warn">alteração {t.revisionCount}</Chip>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2"><Who id={t.coordId} name={personName(board, t.coordId)} /><span className="text-xs text-[hsl(var(--muted-foreground))]">· {t.client ?? "sem cliente"} · {fmtH(t.est)} · prazo {fmt(t.promised)}</span></div>
                </li>
              ))}
            </ol> : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nada depois deste job.</p>}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Section title="Com o cliente" sub="Esperando aprovação.">
            {waiting.length ? waiting.map(t => <Kv key={t.id} k={<button type="button" className="text-left hover:underline" onClick={() => openTask(t.id)}>{t.title}</button>} v={<span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">desde {fmt(t.sentAt)}</span>} />)
              : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nenhum.</p>}
            {blocked.length > 0 && <>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Travados</span>
              {blocked.map(t => <Kv key={t.id} k={t.title} v={<span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{t.blockReason ?? "—"}</span>} />)}
            </>}
          </Section>
          <Notices />
        </div>
      </div>
    </div>
  );
}

function NowCard({ board, t, onOpen, onPlay, onSend, blockOpen, setBlockOpen, blockUi }: {
  board: Board; t: QTask; onOpen: () => void; onPlay: () => void; onSend: () => void;
  blockOpen: boolean; setBlockOpen: (v: boolean) => void; blockUi: React.ReactNode;
}) {
  const c = coordColor(t.coordId), now = board.now;
  // "Começar" só marca que o job está em edição; não há contador. Job de alteração já começado também pode ser enviado.
  const started = t.playing || t.status !== "pending";
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-l-[5px] bg-[hsl(var(--card))] p-4", t.playing && "ring-1 ring-emerald-500/50")} style={{ borderLeftColor: c }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Agora</span>
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider", t.playing ? "text-emerald-500" : "text-[hsl(var(--muted-foreground))]")}>
          {t.playing ? <><LiveDot />Em edição</> : <><Play className="h-3.5 w-3.5" />Pronto para começar</>}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" onClick={onOpen} className="text-left text-[22px] font-bold leading-tight tracking-tight hover:underline">{t.title}</button>
        <div className="flex flex-wrap items-center gap-2">
          <Who id={t.coordId} name={personName(board, t.coordId)} /><span className="text-xs text-[hsl(var(--muted-foreground))]">· {t.client ?? "sem cliente"} · {t.code}</span>
          <DeadlineChip t={t} now={now} />{t.revisionCount > 0 && <Chip tone="warn">alteração {t.revisionCount}</Chip>}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 self-start rounded-xl border bg-[hsl(var(--background))] px-3 py-2"><span className="text-[11.5px] text-[hsl(var(--muted-foreground))]">Prazo de entrega</span><b className={cn("text-sm", t.late && "text-rose-500")}>{fmt(t.promised)}</b></div>
      <div className="flex flex-col gap-0.5 self-start rounded-xl border bg-[hsl(var(--background))] px-3 py-2"><span className="text-[11.5px] text-[hsl(var(--muted-foreground))]">Horas de trabalho</span><b className="text-sm">{fmtH(t.est)}</b></div>
      {(t.description || t.folderUrl) && (
        <div className="flex flex-col gap-1 text-[13px]">
          {t.description && <p className="line-clamp-3 whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{t.description}</p>}
          {t.folderUrl && <span className="inline-flex items-center gap-1.5 text-xs"><FolderOpen className="h-3.5 w-3.5" /><span className="truncate font-mono">{t.folderUrl}</span></span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!t.playing && <Btn size="lg" v="go" onClick={onPlay}><Play weight="fill" className="h-4 w-4" />Começar</Btn>}
        <Btn size="lg" v={t.playing ? "pri" : "def"} disabled={!started} onClick={onSend}><Send className="h-4 w-4" />Enviar para aprovação</Btn>
        <Btn size="lg" v="danger" onClick={() => setBlockOpen(!blockOpen)}>Travado</Btn>
      </div>
      {blockOpen && blockUi}
    </div>
  );
}
