import { useCallback, useEffect, useMemo, useState } from "react";
import { roleName } from "@/lib/roles";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiDelete, apiFetch, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { getSocket } from "@/lib/socket";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { clientColor } from "@/components/fila/job-shared";
import { MentionTextarea, parseMentions, renderMentions, type MentionUser } from "@/components/feed/mentions";
import {
  AtSign, HandsClapping, Heart, Megaphone, MessageCircle, MoreHorizontal, PushPin, PushPinSlash, SealCheck, Search, Share, SmilePlus, X,
} from "@/lib/icons";

/**
 * Mural da equipe (rede social interna). Cada postagem é um cartão com a mesma estrutura:
 * etiqueta do tipo + tempo → quem postou → texto → cartão do job ou da pessoa → ações.
 * Fonte Inter em pesos leves; um destaque por nível (nome em peso médio, resto normal/cinza).
 * Aparecem recados, reconhecimentos entre colegas e entregas aprovadas pelo cliente. Problemas de job não viram post.
 */

interface Person { id: number; name: string; avatarUrl: string | null; login?: string; role?: string; jobTitle?: string | null }
interface Reaction { id: number; userId: number; emoji: string; userName: string | null }
interface Delivery { taskId: number; code: string; title: string; client: string | null; editor: Person | null; coordinator: Person | null; onTime: boolean | null }
interface Item {
  id: number; type: "manual_post" | "kudos" | "task_completed"; title: string; content: string | null; createdAt: string;
  actorId: number | null; actor: Person | null; actorRole: string | null; actorTitle?: string | null; target: Person | null; delivery: Delivery | null;
  pinnedAt: string | null; reactions: Reaction[]; commentCount: number;
}
interface Reply { id: number; userId: number; content: string; createdAt: string; userName: string | null; userAvatar: string | null; userLogin?: string | null }
interface Summary { delivered: number; deliveredLastWeek: number; days: number[]; onTime: number | null; today: number }
interface TeamUser extends MentionUser { login: string; role: string; absence: { label: string; endDate: string } | null }

type Kind = "all" | "post" | "kudos" | "delivery";
const TABS: [Kind, string][] = [["all", "Para você"], ["post", "Recados"], ["kudos", "Reconhecimentos"], ["delivery", "Entregas"]];
const LIKE = "❤️";
const EMOJIS = ["😀", "😂", "😍", "🙌", "👏", "🎉", "🔥", "💪", "🚀", "✅", "🎬", "☕"];
const MAX = 500;
const muted = "text-[hsl(var(--muted-foreground))]";
const hoverRow = "transition-colors hover:bg-[hsl(var(--foreground)/0.03)]";
const card = "rounded-2xl border bg-[hsl(var(--card))]";

/** Tempo no estilo do Twitter: 5min · 3h · 13 de out. */
const ago = (iso: string) => {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return "agora"; if (m < 60) return `${m}min`; if (m < 1440) return `${Math.floor(m / 60)}h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
};
const handle = (p?: { login?: string | null } | null) => (p?.login ? `@${p.login}` : "");

export default function FeedPage() {
  usePageTitle("Mural");
  const { user } = useAuth();
  const [kind, setKind] = useState<Kind>("all");
  const [pinned, setPinned] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    apiFetch<{ pinned: Item[]; items: Item[]; hasMore: boolean }>(`/api/feed?kind=${kind}`)
      .then(r => { setPinned(r.pinned); setItems(r.items); setHasMore(r.hasMore); }).catch(e => toast.error(e.message));
    apiFetch<Summary>("/api/feed/summary").then(setSummary).catch(() => {});
  }, [kind]);
  useEffect(() => { setItems(null); load(); }, [load]);
  useEffect(() => { apiFetch<TeamUser[]>("/api/users?active=1").then(setUsers).catch(() => {}); }, []);

  const more = async () => {
    const last = items?.[items.length - 1]; if (!last) return;
    const r = await apiFetch<{ items: Item[]; hasMore: boolean }>(`/api/feed?kind=${kind}&before=${last.id}`);
    setItems(x => [...(x ?? []), ...r.items]); setHasMore(r.hasMore);
  };

  useEffect(() => {
    const s = getSocket();
    const onReaction = ({ feedItemId, reactions }: { feedItemId: number; reactions: Reaction[] }) => {
      const upd = (l: Item[]) => l.map(i => (i.id === feedItemId ? { ...i, reactions } : i));
      setItems(l => (l ? upd(l) : l)); setPinned(upd);
    };
    s.on("feed:new_item", load); s.on("feed:changed", load); s.on("feed:reaction", onReaction);
    return () => { s.off("feed:new_item", load); s.off("feed:changed", load); s.off("feed:reaction", onReaction); };
  }, [load]);

  // busca da lateral: filtra o que já está na tela (texto, autor, cliente, job)
  const match = useCallback((it: Item) => {
    const t = q.trim().toLowerCase(); if (!t) return true;
    return [it.content, it.actor?.name, it.actor?.login, it.target?.name, it.delivery?.title, it.delivery?.client, it.delivery?.editor?.name].some(x => x?.toLowerCase().includes(t));
  }, [q]);
  const shownPinned = kind === "delivery" ? [] : pinned.filter(match);
  const shown = useMemo(() => (items ?? []).filter(match), [items, match]);

  if (!user) return null;
  const me = users.find(u => u.id === user.id);
  const ctx: Ctx = { me: user.id, meUser: me, role: user.role, users, reload: load };

  return (
    <div className="mx-auto grid max-w-[1020px] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <main className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Mural</h1>
            <p className={cn("text-[14px]", muted)}>Recados, reconhecimentos e as entregas que o cliente aprovou.</p>
          </div>
          <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={cn("h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] transition-colors",
                kind === k ? "bg-[hsl(var(--foreground))] font-medium text-[hsl(var(--background))]" : cn("font-normal hover:bg-[hsl(var(--accent))]", muted))}>{l}</button>
            ))}
          </nav>
        </header>

        <Composer ctx={ctx} onDone={load} />

        {shownPinned.map(it => <Post key={`p${it.id}`} it={it} ctx={ctx} />)}
        {items == null ? <p className={cn("py-16 text-center text-[15px]", muted)}>Carregando…</p>
          : !shown.length && !shownPinned.length ? <Empty kind={kind} searching={!!q.trim()} />
          : shown.map(it => <Post key={it.id} it={it} ctx={ctx} />)}
        {hasMore && !q && <button type="button" onClick={more} className={cn(card, "py-3 text-[14px] font-medium text-[hsl(var(--primary))]", hoverRow)}>Ver postagens anteriores</button>}
      </main>

      <aside className="hidden flex-col gap-4 lg:sticky lg:top-0 lg:flex">
        <label className="flex h-11 items-center gap-3 rounded-full border bg-[hsl(var(--card))] px-4 focus-within:border-[hsl(var(--primary))]">
          <Search className={cn("h-[18px] w-[18px]", muted)} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar no mural" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" className={cn("grid h-6 w-6 place-items-center rounded-full hover:bg-[hsl(var(--accent))]", muted)}><X className="h-3.5 w-3.5" /></button>}
        </label>
        <WeekBox s={summary} />
        <OffBox users={users} />
      </aside>
    </div>
  );
}

function Empty({ kind, searching }: { kind: Kind; searching: boolean }) {
  const [t, s] = searching ? ["Nada encontrado", "Tente outra palavra ou o nome de alguém."] : {
    all: ["Nada no mural ainda", "Publique um recado ou reconheça alguém da equipe."],
    post: ["Nenhum recado ainda", "Quando alguém publicar, aparece aqui."],
    kudos: ["Ninguém foi reconhecido ainda", "Seja o primeiro a agradecer um colega."],
    delivery: ["Nenhuma entrega aprovada", "As entregas que o cliente aprovar aparecem aqui."],
  }[kind];
  return <div className={cn(card, "px-6 py-12 text-center")}><p className="text-[17px] font-medium">{t}</p><p className={cn("mt-1 text-[14px]", muted)}>{s}</p></div>;
}

/* ── publicar ── */
interface Ctx { me: number; meUser?: TeamUser; role: string; users: TeamUser[]; reload: () => void }

function Composer({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const [text, setText] = useState("");
  const [kudos, setKudos] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const people = ctx.users.filter(u => u.id !== ctx.me);
  const tgt = people.find(p => p.id === target);
  const over = text.length > MAX;
  const ok = !!text.trim() && !over && (!kudos || !!target);
  const send = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await apiPost("/api/feed", { content: text.trim(), kind: kudos ? "kudos" : "post", targetUserId: target, mentions: parseMentions(text, ctx.users) });
      setText(""); setTarget(null); setKudos(false); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const tool = cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors hover:bg-[hsl(var(--accent))]", muted);
  return (
    <section className={cn(card, "p-4")}>
      <div className="flex gap-3">
        <AvatarDisplay name={ctx.meUser?.name ?? "?"} avatarUrl={ctx.meUser?.avatarUrl ?? null} size={40} />
        <div className="min-w-0 flex-1">
          {kudos && (
            <div className="mb-2">
              <p className="mb-1.5 text-[13px] text-amber-600 dark:text-amber-400">Quem você quer reconhecer?</p>
              <div className="flex flex-wrap gap-1.5">
                {tgt ? (
                  <button type="button" onClick={() => setTarget(null)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-amber-500/15 pl-1 pr-2.5 text-[13px] font-medium">
                    <AvatarDisplay name={tgt.name} avatarUrl={tgt.avatarUrl} size={24} />{tgt.name}<X className="h-3.5 w-3.5" />
                  </button>
                ) : people.map(u => (
                  <button key={u.id} type="button" onClick={() => setTarget(u.id)} className="inline-flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-3 text-[13px] hover:bg-[hsl(var(--accent))]">
                    <AvatarDisplay name={u.name} avatarUrl={u.avatarUrl} size={24} />{u.name.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <MentionTextarea value={text} onChange={setText} users={ctx.users} rows={2} className="min-h-[48px] py-2 text-[16px] leading-6"
            placeholder={kudos ? (tgt ? `Conte o que ${tgt.name.split(" ")[0]} fez de bom…` : "Escolha a pessoa acima") : "Escreva um recado para a equipe…"} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
        <div className="-ml-2 flex flex-wrap items-center">
          <button type="button" onClick={() => { setKudos(k => !k); setTarget(null); }} className={cn(tool, kudos && "bg-amber-500/15 text-amber-700 dark:text-amber-300")}><HandsClapping className="h-[18px] w-[18px]" /><span className="hidden sm:inline">Reconhecer alguém</span></button>
          <button type="button" onClick={() => setText(t => `${t}${t && !t.endsWith(" ") ? " " : ""}@`)} className={tool}><AtSign className="h-[18px] w-[18px]" /><span className="hidden sm:inline">Mencionar</span></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={tool}><SmilePlus className="h-[18px] w-[18px]" /><span className="hidden sm:inline">Emoji</span></button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="grid w-[216px] grid-cols-6 gap-0.5 p-1.5">
              {EMOJIS.map(e => <DropdownMenuItem key={e} onSelect={() => setText(t => t + e)} className="grid h-8 w-8 place-items-center p-0 text-lg">{e}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-3">
          {text.length > MAX - 80 && <span className={cn("text-[13px] tabular-nums", over ? "text-rose-500" : muted)}>{MAX - text.length}</span>}
          <button type="button" disabled={!ok || busy} onClick={send} className="h-9 rounded-full bg-[hsl(var(--primary))] px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40">Publicar</button>
        </div>
      </div>
    </section>
  );
}

/* ── postagem ── */
const canPin = (role: string) => ["admin", "supervisor", "coordinator"].includes(role);
const BADGE: Record<Item["type"], { label: string; cls: string; icon: React.ReactNode }> = {
  manual_post: { label: "Recado", cls: "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]", icon: <Megaphone className="h-3.5 w-3.5" /> },
  kudos: { label: "Reconhecimento", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: <HandsClapping className="h-3.5 w-3.5" /> },
  task_completed: { label: "Entrega aprovada", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: <SealCheck className="h-3.5 w-3.5" /> },
};

function Post({ it, ctx }: { it: Item; ctx: Ctx }) {
  const { openTask } = useTaskModal();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(it.content ?? "");
  const [count, setCount] = useState(it.commentCount);
  useEffect(() => setCount(it.commentCount), [it.commentCount]);
  const d = it.delivery;
  // entrega aparece como conquista de quem editou; recado e reconhecimento, de quem escreveu
  const author = d?.editor ?? it.actor;
  const role = d ? roleName(d.editor ? { role: "editor", ...d.editor } : { role: "editor" }) : roleName({ role: it.actorRole, jobTitle: it.actorTitle });
  const mine = it.actorId === ctx.me, canDelete = mine || ["admin", "supervisor"].includes(ctx.role);
  const likes = it.reactions.filter(r => r.emoji === LIKE), liked = likes.some(r => r.userId === ctx.me);
  const run = async (p: Promise<unknown>, ok?: string) => { try { await p; if (ok) toast.success(ok); ctx.reload(); } catch (e) { toast.error((e as Error).message); } };
  const like = () => apiPost(`/api/feed/${it.id}/reactions`, { emoji: LIKE }).catch(e => toast.error(e.message));
  const share = () => {
    const txt = d ? `${d.title}${d.client ? ` · ${d.client}` : ""} foi aprovado pelo cliente.` : `${it.actor?.name}: ${it.content}`;
    navigator.clipboard.writeText(txt).then(() => toast.success("Texto copiado"));
  };
  const b = BADGE[it.type];

  return (
    <article className={cn(card, "overflow-hidden", it.pinnedAt && "border-[hsl(var(--primary)/0.45)]")}>
      <div className="flex flex-col gap-3 p-4">
        {/* 1. tipo + tempo */}
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", b.cls)}>{b.icon}{b.label}</span>
          {it.pinnedAt && <span className={cn("inline-flex items-center gap-1 text-[12px]", muted)}><PushPin weight="fill" className="h-3.5 w-3.5" />Fixado</span>}
          <span className={cn("ml-auto text-[13px]", muted)} title={new Date(it.createdAt).toLocaleString("pt-BR")}>{ago(it.createdAt)}</span>
          {(canDelete || canPin(ctx.role)) && it.type !== "task_completed" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Mais opções" className={cn("-my-1 -mr-1.5 grid h-8 w-8 place-items-center rounded-full hover:bg-[hsl(var(--accent))]", muted)}><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px]">
                {canPin(ctx.role) && <DropdownMenuItem onSelect={() => run(apiPost(`/api/feed/${it.id}/pin`, {}), it.pinnedAt ? "Desafixado" : "Fixado no topo do mural")}>
                  {it.pinnedAt ? <PushPinSlash className="h-[18px] w-[18px]" /> : <PushPin className="h-[18px] w-[18px]" />}{it.pinnedAt ? "Desafixar" : "Fixar no topo do mural"}</DropdownMenuItem>}
                {mine && <DropdownMenuItem onSelect={() => setEditing(true)}>Editar postagem</DropdownMenuItem>}
                {canDelete && <DropdownMenuItem className="text-rose-500" onSelect={() => run(apiDelete(`/api/feed/${it.id}`), "Postagem excluída")}>Excluir postagem</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* 2. quem */}
        <div className="flex items-center gap-3">
          <AvatarDisplay name={author?.name ?? "?"} avatarUrl={author?.avatarUrl ?? null} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium leading-5">{author?.name ?? "Alguém"}</p>
            <p className={cn("truncate text-[13px] leading-5", muted)}>{[role || null, handle(author)].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {/* 3. texto */}
        {editing ? (
          <div className="rounded-xl border p-3">
            <MentionTextarea value={text} onChange={setText} users={ctx.users} rows={2} className="text-[15px]" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-full border px-4 text-[13px] font-medium">Cancelar</button>
              <button type="button" onClick={async () => { await run(apiPut(`/api/feed/${it.id}`, { content: text }), "Postagem atualizada"); setEditing(false); }} className="h-8 rounded-full bg-[hsl(var(--primary))] px-4 text-[13px] font-medium text-white">Salvar</button>
            </div>
          </div>
        ) : d ? (
          <p className="text-[15px] leading-[1.6]">O cliente aprovou a entrega{d.client ? ` de ${d.client}` : ""}.</p>
        ) : it.content && <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.6]">{renderMentions(it.content)}</p>}

        {/* 4. anexo: pessoa reconhecida ou job */}
        {it.type === "kudos" && it.target && (
          <div className="flex items-center gap-3 rounded-xl bg-amber-500/[0.08] p-3">
            <AvatarDisplay name={it.target.name} avatarUrl={it.target.avatarUrl} size={44} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-[12px]", muted)}>Reconhecimento para</p>
              <p className="truncate text-[15px] font-medium">{it.target.name}</p>
            </div>
            <HandsClapping className="h-7 w-7 shrink-0 text-amber-500" />
          </div>
        )}
        {d && (
          <button type="button" onClick={() => openTask(d.taskId)} className="flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-[hsl(var(--foreground)/0.03)]">
            <div className="flex items-center gap-2 text-[12.5px]"><i className="h-2 w-2 rounded-full" style={{ background: clientColor(d.client) }} /><span className={muted}>{d.client ?? "Sem cliente"}</span><span className={cn("ml-auto font-mono text-[12px]", muted)}>{d.code}</span></div>
            <p className="text-[15px] font-medium leading-5">{d.title}</p>
            <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]", muted)}>
              {d.editor && <span>Edição: {d.editor.name.split(" ")[0]}</span>}
              {d.coordinator && <span>Gestão: {d.coordinator.name.split(" ")[0]}</span>}
              {d.onTime && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><SealCheck className="h-4 w-4" />1ª versão no prazo</span>}
            </div>
          </button>
        )}
      </div>

      {/* 5. ações */}
      <div className="flex items-center gap-1 border-t px-2 py-1.5">
        <Action icon={<Heart className="h-[18px] w-[18px]" weight={liked ? "fill" : "light"} />} label={likes.length ? `${likes.length} ${likes.length === 1 ? "curtida" : "curtidas"}` : "Curtir"} tone="like" active={liked} onClick={like} title={likes.map(r => r.userName).filter(Boolean).join(", ")} />
        <Action icon={<MessageCircle className="h-[18px] w-[18px]" />} label={count ? `${count} ${count === 1 ? "resposta" : "respostas"}` : "Responder"} tone="primary" active={open} onClick={() => setOpen(o => !o)} />
        <span className="ml-auto"><Action icon={<Share className="h-[18px] w-[18px]" />} label="Copiar" tone="primary" onClick={share} /></span>
      </div>
      {open && <Replies it={it} ctx={ctx} onCount={setCount} />}
    </article>
  );
}

function Action({ icon, label, tone, active, onClick, title }: { icon: React.ReactNode; label: string; tone: "primary" | "like"; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" title={title || label} onClick={onClick}
      className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] transition-colors",
        active ? (tone === "like" ? "text-rose-500" : "text-[hsl(var(--primary))]") : muted,
        tone === "like" ? "hover:bg-rose-500/10 hover:text-rose-500" : "hover:bg-[hsl(var(--primary)/0.1)] hover:text-[hsl(var(--primary))]")}>
      {icon}{label}
    </button>
  );
}

/* ── respostas ── */
function Replies({ it, ctx, onCount }: { it: Item; ctx: Ctx; onCount: (n: number) => void }) {
  const [list, setList] = useState<Reply[] | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    apiFetch<Reply[]>(`/api/feed/${it.id}/comments`).then(setList).catch(() => setList([]));
    const s = getSocket();
    const onNew = ({ feedItemId, comment }: { feedItemId: number; comment: Reply }) => { if (feedItemId === it.id) setList(c => (c?.some(x => x.id === comment.id) ? c : [...(c ?? []), comment])); };
    const onDel = ({ feedItemId, commentId }: { feedItemId: number; commentId: number }) => { if (feedItemId === it.id) setList(c => c?.filter(x => x.id !== commentId) ?? c); };
    s.on("feed:comment", onNew); s.on("feed:comment_deleted", onDel);
    return () => { s.off("feed:comment", onNew); s.off("feed:comment_deleted", onDel); };
  }, [it.id]);
  useEffect(() => { if (list) onCount(list.length); }, [list, onCount]);
  const send = async () => {
    if (!text.trim()) return;
    try { const c = await apiPost<Reply>(`/api/feed/${it.id}/comments`, { content: text.trim(), mentions: parseMentions(text, ctx.users) }); setList(x => (x?.some(y => y.id === c.id) ? x : [...(x ?? []), c])); setText(""); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="flex flex-col gap-3 border-t bg-[hsl(var(--muted)/0.35)] p-4">
      {list?.map(r => (
        <div key={r.id} className="group flex gap-2.5">
          <AvatarDisplay name={r.userName ?? "?"} avatarUrl={r.userAvatar} size={32} />
          <div className="min-w-0 flex-1 rounded-2xl bg-[hsl(var(--card))] px-3.5 py-2">
            <p className="flex items-baseline gap-2 text-[13px]">
              <span className="font-medium">{r.userName}</span><span className={muted}>{ago(r.createdAt)}</span>
              {(r.userId === ctx.me || ["admin", "supervisor"].includes(ctx.role)) && (
                <button type="button" onClick={() => apiDelete(`/api/feed/comments/${r.id}`).then(() => setList(x => x?.filter(y => y.id !== r.id) ?? x)).catch(e => toast.error(e.message))}
                  className="ml-auto text-[12px] text-rose-500 opacity-0 group-hover:opacity-100">Excluir</button>
              )}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-[1.55]">{renderMentions(r.content)}</p>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2.5">
        <AvatarDisplay name={ctx.meUser?.name ?? "?"} avatarUrl={ctx.meUser?.avatarUrl ?? null} size={32} />
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-[hsl(var(--card))] py-1 pl-4 pr-1">
          <div className="min-w-0 flex-1"><MentionTextarea value={text} onChange={setText} onSend={send} users={ctx.users} placeholder="Escreva uma resposta…" className="py-1.5 text-[14px]" /></div>
          <button type="button" disabled={!text.trim()} onClick={send} className="h-8 shrink-0 rounded-full bg-[hsl(var(--primary))] px-4 text-[13px] font-medium text-white disabled:opacity-40">Enviar</button>
        </div>
      </div>
    </div>
  );
}

/* ── lateral ── */
function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={cn(card, "overflow-hidden")}><h2 className="px-4 pb-1 pt-4 text-[15px] font-medium">{title}</h2>{children}</section>;
}

function WeekBox({ s }: { s: Summary | null }) {
  const max = Math.max(1, ...(s?.days ?? [0]));
  const diff = s ? s.delivered - s.deliveredLastWeek : 0;
  return (
    <Box title="Esta semana na equipe">
      {!s ? <p className={cn("px-4 pb-4 text-[14px]", muted)}>Carregando…</p> : <>
        <div className="grid grid-cols-2 gap-2 px-4 pt-2">
          <div className="rounded-xl bg-[hsl(var(--muted)/0.6)] p-3"><p className="text-[22px] font-medium leading-none">{s.delivered}</p><p className={cn("mt-1.5 text-[12px] leading-4", muted)}>entregas aprovadas</p></div>
          <div className="rounded-xl bg-[hsl(var(--muted)/0.6)] p-3"><p className="text-[22px] font-medium leading-none">{s.onTime == null ? "—" : `${s.onTime}%`}</p><p className={cn("mt-1.5 text-[12px] leading-4", muted)}>1ª versão no prazo</p></div>
        </div>
        <div className="flex h-20 items-end gap-2 px-4 pt-3">
          {s.days.map((n, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${n} entrega(s)`}>
              <span className="flex w-full flex-1 items-end"><i className={cn("block w-full rounded-md", i > s.today ? "bg-[hsl(var(--muted))]" : "bg-[hsl(var(--primary)/0.8)]")} style={{ height: `${n ? 18 + (n / max) * 82 : 6}%` }} /></span>
              <span className={cn("text-[11px]", i === s.today ? "font-medium" : muted)}>{"STQQSSD"[i]}</span>
            </div>
          ))}
        </div>
        <p className={cn("px-4 pb-4 pt-2 text-[13px]", muted)}>{diff > 0 ? `${diff} a mais que na semana passada.` : diff < 0 ? `Semana passada: ${s.deliveredLastWeek}.` : "Mesmo ritmo da semana passada."}</p>
      </>}
    </Box>
  );
}

function OffBox({ users }: { users: TeamUser[] }) {
  const off = users.filter(u => u.absence);
  return (
    <Box title="Fora hoje">
      {!off.length ? <p className={cn("px-4 pb-4 pt-1 text-[14px]", muted)}>Toda a equipe está trabalhando hoje.</p>
        : <div className="pb-2">{off.map(u => (
          <div key={u.id} className={cn("flex items-center gap-3 px-4 py-2.5", hoverRow)}>
            <AvatarDisplay name={u.name} avatarUrl={u.avatarUrl} size={36} />
            <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium">{u.name}</p><p className={cn("truncate text-[12.5px]", muted)}>{u.absence!.label}</p></div>
          </div>
        ))}</div>}
    </Box>
  );
}
