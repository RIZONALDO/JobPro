import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, ArrowsDownUp, Question, Moon, Lock, Play, Pause, Send, Timer } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { apiFetch, apiPost } from "@/lib/api";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { useRealtime } from "@/hooks/use-realtime";
import { DAY, clock, coordColor, fmt, fmtDay, fmtH, inQueue, personName, rem, shiftState, useBoard, type Board, type QEditor, type QTask } from "@/lib/fila";
import { Alert, Btn, Chip, DeadlineChip, Free, Kv, Section, Who, inputCls, LiveDot } from "@/components/fila/ui";

const BLOCK_REASONS = ["Falta material do cliente", "Aguardando resposta do cliente", "Aguardando a coordenação", "Problema técnico"];

async function run(p: Promise<unknown>, ok?: string) {
  try { const r = await p as { message?: string } | undefined; toast.success(r?.message ?? ok ?? "Feito"); return true; }
  catch (e) { toast.error((e as Error).message); return false; }
}

interface Notif { id: number; type: string; title: string; message: string; read: boolean; createdAt: string; taskId: number | null }

/** Tela do editor: só os jobs dele, de todos os coordenadores. A ordem é da coordenação; ele faz o 1º. */
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
  const [remH, setRemH] = useState("2");
  const [estInput, setEstInput] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Notif[]>([]);
  const [prevEnds, setPrevEnds] = useState<Record<number, number>>({});
  const [changed, setChanged] = useState<Set<number>>(new Set());

  const loadNotes = () => apiFetch<Notif[]>("/api/notifications").then(setNotes).catch(() => {});
  useEffect(() => { loadNotes(); }, []);
  useRealtime({ onTasksChanged: loadNotes });

  const q = useMemo(() => board.tasks.filter(t => inQueue(t) && t.editorId === me && t.slot).sort((a, b) => a.slot!.pos - b.slot!.pos), [board, me]);
  // destaca os jobs cuja previsão mudou desde a última atualização
  useEffect(() => {
    const ends: Record<number, number> = {}, ch = new Set<number>();
    for (const t of q) { ends[t.id] = t.slot!.end; if (prevEnds[t.id] !== undefined && prevEnds[t.id] !== t.slot!.end) ch.add(t.id); }
    setPrevEnds(ends); setChanged(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const head = q[0] ?? null;
  const rest = q.slice(1).filter(t => filter === "all" || t.coordId === filter);
  const coords = [...new Set(q.map(t => t.coordId).filter(Boolean))] as number[];
  const waiting = board.tasks.filter(t => t.editorId === me && t.status === "review");
  const blocked = board.tasks.filter(t => t.editorId === me && t.status === "paused");
  const myReqs = board.requests.filter(r => r.requestedById === me);
  const unconfirmed = q.filter(t => !t.estConfirmed);

  const act = async (path: string, body: unknown = {}, ok?: string) => { if (await run(apiPost(path, body), ok)) reload(); };

  // fazer antes: troca na hora; os gestores são avisados pelo servidor
  const doFirst = async (t: QTask) => {
    let r: { newlyLate: number[]; coords: number[] };
    try { r = await apiPost(`/api/queue/tasks/${t.id}/request-first`, {}); } catch (e) { toast.error((e as Error).message); return; }
    reload();
    if (r.newlyLate.length) toast.warning(`Feito. ${r.newlyLate.length > 1 ? `${r.newlyLate.length} jobs passam` : "1 job passa"} do prazo: ${r.coords.map(c => personName(board, c).split(" ")[0]).join(", ")} foi avisado(a) para decidir.`);
    else toast.success("Feito. Ninguém atrasa e os gestores foram avisados.");
  };

  // meu dia
  const today = Math.floor(now / DAY);
  let planned = 0;
  for (const t of q) for (const [a, b] of t.slot!.segs) planned += Math.max(0, Math.min(b, (today + 1) * DAY) - Math.max(a, today * DAY));
  const cap = ed?.todayCap ?? 0, done = Math.min(cap, ed?.todayDone ?? 0);
  const last = q.length ? Math.max(...q.map(t => t.slot!.end)) : ed?.freeFrom ?? now;
  const gaps = q.filter(t => t.slot!.gapBefore > 0 && t.slot!.pos > 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Minha fila</h1>
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Você vê só os seus jobs. A ordem é definida pela coordenação. Você faz o 1º e pode adiantar outro: os gestores são avisados.</p>
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
          {ed?.offToday && <Alert tone="info" icon={<Moon />} title={`Hoje sem expediente para você: ${ed.offToday}.`}>A fila conta só os dias em que você trabalha.</Alert>}
          {head && !head.playing && (ed?.idleMinutes ?? 0) >= 30 && ["on", "ending"].includes(shiftState(ed, now).state) && (
            <Alert tone="info" title={`Seu próximo job é “${head.title}”.`}>
              <span>Quando começar, toque em “Começar” para as horas contarem certo. Se algo está impedindo, use “Travado” e conte o motivo.</span>
            </Alert>
          )}
          {head?.waitingEst && (
            <Alert tone="warn" title={`As horas estimadas de “${head.title}” acabaram.`}>
              <span>Se terminou, envie para aprovação. Se não, diga quanto falta. Até lá o sistema reserva +1h.</span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[12.5px] text-[hsl(var(--muted-foreground))]">Faltam <input type="number" min="0.5" step="0.5" value={remH} onChange={e => setRemH(e.target.value)} className={cn(inputCls, "w-16")} /> horas</label>
                <Btn v="pri" size="sm" onClick={() => act(`/api/queue/tasks/${head.id}/inform`, { minutes: Math.round(parseFloat(remH) * 60) }, "Estimativa atualizada")}>Salvar</Btn>
              </div>
            </Alert>
          )}
          {unconfirmed.map(t => (
            <Alert key={t.id} tone="info" icon={<Question />} title={`${personName(board, t.coordId)} colocou “${t.title}” na sua fila com ${fmtH(t.est - t.worked)}${t.revisionCount ? " (alteração)" : ""}. Confere?`}>
              <span>Você não recusa o job, mas a sua estimativa fica registrada e a fila é recalculada com ela.</span>
              <div className="flex flex-wrap items-center gap-2">
                <Btn v="pri" size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/estimate`, { confirm: true }, "Estimativa confirmada")}>Confere, {fmtH(t.est)}</Btn>
                <label className="text-[12.5px] text-[hsl(var(--muted-foreground))]">Acho que preciso de <input type="number" min="0.5" step="0.5" value={estInput[t.id] ?? String(t.est / 60 + 2)} onChange={e => setEstInput(s => ({ ...s, [t.id]: e.target.value }))} className={cn(inputCls, "w-16")} /> horas</label>
                <Btn size="sm" onClick={() => act(`/api/queue/tasks/${t.id}/estimate`, { minutes: Math.round(parseFloat(estInput[t.id] ?? String(t.est / 60 + 2)) * 60) }, "Estimativa enviada")}>Enviar minha estimativa</Btn>
              </div>
            </Alert>
          ))}
          {myReqs.map(r => {
            const t = board.tasks.find(x => x.id === r.taskId);
            return (
              <Alert key={r.id} tone="info" icon={<ArrowsDownUp />} title={`Pedido de troca aguardando ${r.escalated ? `${personName(board, r.approverId)} ou a supervisão` : personName(board, r.approverId)}`}>
                <span>Fazer “{t?.title}” antes. Enquanto isso, siga no job atual.</span>
                <div><Btn size="sm" v="ghost" onClick={() => act(`/api/queue/requests/${r.id}/cancel`, {}, "Pedido cancelado")}>Cancelar pedido</Btn></div>
              </Alert>
            );
          })}

          {!head ? <Free>Nenhum job na sua fila. Você está livre.</Free>
            : filter !== "all" && head.coordId !== filter ? <Free>O job atual é de {personName(board, head.coordId)}. Filtro ativo.</Free>
            : <NowCard board={board} ed={ed} t={head} onOpen={() => openTask(head.id)}
                onPlay={() => act(`/api/queue/tasks/${head.id}/play`, {}, "Job em execução")}
                onPause={() => act(`/api/queue/tasks/${head.id}/pause`, {}, "Pausado")}
                onSend={() => act(`/api/queue/tasks/${head.id}/send`, {}, "Enviado para aprovação")}
                onMore={m => act(`/api/queue/tasks/${head.id}/inform`, { minutes: m }, `${personName(board, head.coordId).split(" ")[0]} foi avisado(a). A fila já foi recalculada.`)}
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

          <Section title="Depois" right={<span className="text-xs text-[hsl(var(--muted-foreground))]">{q.length > 1 ? `${fmtH(q.slice(1).reduce((s, t) => s + rem(t), 0))} na fila` : ""}</span>}>
            {rest.length ? <ol className="flex flex-col gap-2">
              {rest.map(t => {
                const s = t.slot!, locked = t.notBefore != null && t.notBefore > now;
                const pending = myReqs.find(r => r.taskId === t.id);
                return (
                  <li key={t.id} className={cn("flex flex-col gap-1.5 rounded-xl border border-l-4 bg-[hsl(var(--card))] px-3 py-2.5", changed.has(t.id) && "ring-1 ring-amber-500/60")} style={{ borderLeftColor: coordColor(t.coordId) }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-[22px] text-[11.5px] font-bold text-[hsl(var(--muted-foreground))]">{s.pos + 1}º</span>
                      <button type="button" onClick={() => openTask(t.id)} className="text-left text-sm font-semibold hover:underline">{t.title}</button>
                      <DeadlineChip t={t} now={now} />
                      {!t.estConfirmed && <Chip tone="acc">confirme a estimativa</Chip>}
                      {t.revisionCount > 0 && <Chip tone="warn">alteração {t.revisionCount}</Chip>}
                    </div>
                    {t.estDisputeOpen || t.estEditor ? <span className="text-xs text-[hsl(var(--muted-foreground))]">Estimativa: sua {fmtH(t.estEditor)} · {personName(board, t.coordId).split(" ")[0]} {fmtH(t.estCoord)}{t.estDisputeOpen ? ` · aguardando ${personName(board, t.coordId).split(" ")[0]}` : ` · valendo a de ${personName(board, t.estOwnerId).split(" ")[0]}`}</span> : null}
                    <div className="flex flex-wrap items-center gap-2"><Who id={t.coordId} name={personName(board, t.coordId)} /><span className="text-xs text-[hsl(var(--muted-foreground))]">· {t.client ?? "sem cliente"} · {fmtH(rem(t))}</span></div>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">Começa {fmt(s.start)} · pronto {fmt(s.end)} · prazo {fmt(t.promised)}</span>
                    {t.notBefore != null && <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><Lock className="h-3.5 w-3.5 shrink-0" />Não começar antes de {fmt(t.notBefore)}{t.lockReason ? `: ${t.lockReason}` : ""} ({personName(board, t.coordId).split(" ")[0]})</span>}
                    {s.filled && <span className="text-xs text-[hsl(var(--primary))]">Encaixado no buraco antes de “{board.tasks.find(x => x.id === s.filled)?.title}”, que só pode começar depois.</span>}
                    {pending ? <Chip tone="acc" className="self-start">Pedido enviado: aguardando {pending.escalated ? "a supervisão" : personName(board, pending.approverId)}</Chip>
                      : s.pos === 1 && head?.playing ? <span className="text-xs text-[hsl(var(--muted-foreground))]">É o próximo, logo depois do job atual.</span>
                      : !locked && <div><Btn size="sm" onClick={() => doFirst(t)}>Fazer antes</Btn></div>}
                  </li>
                );
              })}
            </ol> : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nada depois deste job.</p>}
            {gaps.map(t => <Free key={t.id}>Livre {fmtH(t.slot!.gapBefore)} antes de “{t.title}”. A coordenação vê esse espaço.</Free>)}
            <Free>Livre para novos jobs a partir de <b>{fmt(last)}</b></Free>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Section title={`Meu dia · ${fmtDay(today)}`}>
            {cap ? <>
              <div className="flex h-3 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                <i className="block h-full bg-[hsl(var(--muted-foreground)/0.5)]" style={{ width: `${(done / cap) * 100}%` }} />
                <i className="block h-full bg-[hsl(var(--primary))]" style={{ width: `${(Math.min(planned, cap - done) / cap) * 100}%` }} />
              </div>
              <Kv k="Expediente" v={fmtH(cap)} /><Kv k="Já passou" v={fmtH(done)} /><Kv k="Planejado até o fim do dia" v={fmtH(planned)} /><Kv k="Livre hoje" v={fmtH(Math.max(0, cap - done - planned))} />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Almoço 12h–14h não conta. Sábado até 13h.</span>
            </> : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Sem expediente hoje.</p>}
          </Section>
          <Section title="Com o cliente" sub="Esperando aprovação. Não ocupa suas horas.">
            {waiting.length ? waiting.map(t => <Kv key={t.id} k={<button type="button" className="text-left hover:underline" onClick={() => openTask(t.id)}>{t.title}</button>} v={<span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">desde {fmt(t.sentAt)}</span>} />)
              : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nenhum.</p>}
            {blocked.length > 0 && <>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Travados</span>
              {blocked.map(t => <Kv key={t.id} k={t.title} v={<span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{t.blockReason ?? "—"}</span>} />)}
            </>}
          </Section>
          <Section title="Avisos">
            {notes.length ? <ul className="flex max-h-80 flex-col gap-2 overflow-auto">
              {notes.slice(0, 12).map(n => (
                <li key={n.id} className="flex flex-col gap-0.5 border-t pt-2 text-[12.5px] first:border-t-0 first:pt-0">
                  <time className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{new Date(n.createdAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                  <span className="flex items-start gap-1.5">{!n.read && <LiveDot pulse={false} className="mt-1.5 h-1.5 w-1.5 text-[hsl(var(--primary))]" />}<span>{n.message}</span></span>
                </li>
              ))}
            </ul> : <p className="text-[13px] text-[hsl(var(--muted-foreground))]">Nenhum aviso.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}

function NowCard({ board, ed, t, onOpen, onPlay, onPause, onSend, onMore, blockOpen, setBlockOpen, blockUi }: {
  board: Board; ed: QEditor | undefined; t: QTask; onOpen: () => void; onPlay: () => void; onPause: () => void; onSend: () => void; onMore: (minutes: number) => Promise<unknown> | void;
  blockOpen: boolean; setBlockOpen: (v: boolean) => void; blockUi: React.ReactNode;
}) {
  const s = t.slot!, c = coordColor(t.coordId), now = board.now;
  const locked = t.notBefore != null && t.notBefore > now;
  // fora do expediente o contador não conta; com ▶ ligado ele volta sozinho no próximo expediente (sem novo "Começar")
  const sh = shiftState(ed, now);
  const offHours = sh.state === "off" || sh.state === "before";
  const closed = !t.playing && offHours, resting = t.playing && offHours;
  // "Preciso de mais tempo": o editor diz quanto ainda falta; a previsão muda, o prazo do cliente não
  const [more, setMore] = useState(false);
  const [left, setLeft] = useState("2");
  const leftMin = Math.round((parseFloat(left.replace(",", ".")) || 0) * 60);
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-l-[5px] bg-[hsl(var(--card))] p-4", t.playing && "ring-1 ring-emerald-500/50", closed && "bg-[hsl(var(--muted)/0.35)]")} style={{ borderLeftColor: c }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Agora</span>
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider", t.playing ? "text-emerald-500" : locked ? "text-amber-500" : "text-[hsl(var(--muted-foreground))]")}>
          {resting ? <><Moon className="h-3.5 w-3.5" />Volta sozinho {fmt(sh.resumes)}</>
            : t.playing ? <><LiveDot />Em execução</>
            : closed ? <><Moon className="h-3.5 w-3.5" />{sh.state === "before" ? "Expediente ainda não começou" : `Expediente encerrado${sh.end != null ? ` · ${clock(sh.end)}` : ""}`}</>
            : locked ? <><Lock className="h-3.5 w-3.5" />Só a partir de {fmt(t.notBefore)}</> : <><Play className="h-3.5 w-3.5" />Pronto para começar</>}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" onClick={onOpen} className="text-left text-[22px] font-bold leading-tight tracking-tight hover:underline">{t.title}</button>
        <div className="flex flex-wrap items-center gap-2">
          <Who id={t.coordId} name={personName(board, t.coordId)} /><span className="text-xs text-[hsl(var(--muted-foreground))]">· {t.client ?? "sem cliente"} · {t.code}</span>
          <DeadlineChip t={t} now={now} />{t.revisionCount > 0 && <Chip tone="warn">alteração {t.revisionCount}</Chip>}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><i className="block h-full" style={{ width: `${Math.min(100, (t.worked / Math.max(1, t.est)) * 100)}%`, background: c }} /></div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        {[["Feito", `${fmtH(t.worked)} de ${fmtH(t.est)}`], ["Fica pronto", fmt(s.end)], ["Prazo", fmt(t.promised)]].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 rounded-xl border bg-[hsl(var(--background))] px-2.5 py-2"><span className="text-[11.5px] text-[hsl(var(--muted-foreground))]">{k}</span><b className="text-sm">{v}</b></div>
        ))}
      </div>
      {(t.description || t.folderUrl) && (
        <div className="flex flex-col gap-1 text-[13px]">
          {t.description && <p className="line-clamp-3 whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{t.description}</p>}
          {t.folderUrl && <span className="inline-flex items-center gap-1.5 text-xs"><FolderOpen className="h-3.5 w-3.5" /><span className="truncate font-mono">{t.folderUrl}</span></span>}
        </div>
      )}
      {/* fim do dia: uma decisão só, no próprio card */}
      {t.playing && sh.state === "ending" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-[hsl(var(--background))] px-3 py-2.5 text-[13px]">
          <Moon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <span className="min-w-0 flex-1">O expediente acaba às <b className="font-mono">{clock(sh.end!)}</b> (em {fmtH(sh.left)}). O contador para e volta sozinho no próximo expediente: não precisa tocar em Começar de novo.</span>
        </div>
      )}
      {resting && <span className="text-[13px] text-[hsl(var(--muted-foreground))]">Fora do expediente o contador não conta. Ele volta sozinho {fmt(sh.resumes)}, sem precisar tocar em Começar. Se não for continuar este job, toque em Pausar.</span>}
      {closed && <span className="text-[13px] text-[hsl(var(--muted-foreground))]">Contador parado em <b className="text-[hsl(var(--foreground))]">{fmtH(t.worked)}</b>. Retoma {fmt(sh.resumes)} quando você tocar em Começar.</span>}
      <div className="flex flex-wrap gap-2">
        {t.playing ? <Btn size="lg" onClick={onPause}><Pause weight="fill" className="h-4 w-4" />Pausar</Btn>
          : closed ? <Btn size="lg" disabled><Moon className="h-4 w-4" />Retoma {fmt(sh.resumes)}</Btn>
          : <Btn size="lg" v="go" disabled={locked} onClick={onPlay}><Play weight="fill" className="h-4 w-4" />Começar</Btn>}
        <Btn size="lg" disabled={!t.worked && !t.playing} onClick={onSend}><Send className="h-4 w-4" />Enviar para aprovação</Btn>
        {(t.playing || t.worked > 0) && <Btn size="lg" onClick={() => { setMore(!more); setBlockOpen(false); }}><Timer className="h-4 w-4" />Preciso de mais tempo</Btn>}
        <Btn size="lg" v="danger" onClick={() => { setBlockOpen(!blockOpen); setMore(false); }}>Travado</Btn>
      </div>
      {more && (
        <div className="flex flex-col gap-2 rounded-xl border bg-[hsl(var(--background))] p-3 text-[13px]">
          <b>Quanto ainda falta para terminar?</b>
          <div className="flex flex-wrap items-center gap-2">
            {["1", "2", "4", "8"].map(h => <Btn key={h} size="sm" v={left === h ? "pri" : "def"} onClick={() => setLeft(h)}>{h}h</Btn>)}
            <input type="number" min="0.5" step="0.5" value={left} onChange={e => setLeft(e.target.value)} className={cn(inputCls, "w-20")} aria-label="Horas que faltam" /> horas
          </div>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Total do job passa a {fmtH(t.worked + leftMin)} (era {fmtH(t.est)}). {personName(board, t.coordId)} é avisado(a). O prazo do cliente não muda: se passar dele, quem decide é o gestor (outro editor ou novo prazo com o cliente).
          </span>
          <div className="flex gap-2">
            <Btn v="pri" size="sm" disabled={leftMin <= 0} onClick={async () => { await onMore(leftMin); setMore(false); }}>Avisar</Btn>
            <Btn v="ghost" size="sm" onClick={() => setMore(false)}>Cancelar</Btn>
          </div>
        </div>
      )}
      {blockOpen && blockUi}
    </div>
  );
}
