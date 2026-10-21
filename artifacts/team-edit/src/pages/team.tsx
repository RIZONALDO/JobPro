import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { apiFetch, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { HeadAction } from "@/components/fila/ui";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, LayoutGrid, List, Pencil, CalendarPlus, Palmtree, Users, KeyRound, Copy, UserX, Shuffle } from "@/lib/icons";
import { openHandoff } from "@/components/fila/HandoffDialog";
import { fmtShortDate, isActiveUser, type Absence } from "@/lib/availability";
import {
  MEMBER_GROUPS, groupOf, isAway, fmtJoined, fmtLastSeen,
  MemberAvatar, RoleChip, StatusChip, FirstAccessChip, type Member,
} from "@/components/team/shared";
import { AbsenceDialog } from "@/components/team/absence-form";
import { MemberFormDialog } from "@/components/team/member-form-dialog";
import { InactivateDialog } from "@/components/team/inactivate-dialog";

type Tab = "active" | "away" | "inactive" | "all";
const TABS: { id: Tab; label: string; test: (m: Member) => boolean }[] = [
  { id: "active",   label: "Ativos",    test: m => isActiveUser(m) },
  { id: "away",     label: "Fora hoje", test: m => isAway(m) },
  { id: "inactive", label: "Inativos",  test: m => !isActiveUser(m) },
  { id: "all",      label: "Todos",     test: () => true },
];

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function generatePassword(len = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => chars[n % chars.length]).join("");
}

export default function Team() {
  usePageTitle("Membros");
  const { user } = useAuth();
  const isAdmin   = user?.role === "admin";
  const canManage = isAdmin || user?.role === "supervisor";

  const [members, setMembers]   = useState<Member[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading]   = useState(true);

  const [tab, setTab]       = useState<Tab>("active");
  const [roleFilter, setRoleFilter] = useState("all");
  const [query, setQuery]   = useState("");
  const [view, setView]     = useState<"grid" | "list">("grid");
  const [selId, setSelId]   = useState<number | null>(null);
  const [history, setHistory] = useState<(Absence & { createdAt?: string })[]>([]);

  const [formOpen, setFormOpen]   = useState(false);
  const [editing, setEditing]     = useState<Member | null>(null);
  const [inactivating, setInactivating] = useState<Member | null>(null);
  const [absenceOpen, setAbsenceOpen]   = useState(false);
  const [absencePreset, setAbsencePreset] = useState<number | null>(null);
  const [resetFor, setResetFor]   = useState<Member | null>(null);
  const [resetPw, setResetPw]     = useState("");

  const load = () => {
    apiFetch<Member[]>("/api/users")
      .then(setMembers)
      .catch(() => toast.error("Erro ao carregar membros"))
      .finally(() => setLoading(false));
    apiFetch<Absence[]>("/api/absences").then(setAbsences).catch(() => {});
  };
  useEffect(load, []);

  const sel = members.find(m => m.id === selId) ?? null;
  const loadHistory = (id: number) =>
    apiFetch<(Absence & { createdAt?: string })[]>(`/api/absences/history?userId=${id}`).then(setHistory).catch(() => setHistory([]));
  useEffect(() => { if (selId) void loadHistory(selId); else setHistory([]); }, [selId]);

  const reloadAll = () => { load(); if (selId) void loadHistory(selId); };

  const today = localIso(new Date());
  /** Próxima ausência programada (começa depois de hoje) — para o selo do cartão. */
  const upcomingOf = (id: number) => absences.find(a => a.userId === id && a.startDate > today) ?? null;

  const filtered = useMemo(() => {
    const t = TABS.find(x => x.id === tab)!;
    const q = query.trim().toLowerCase();
    return members
      .filter(t.test)
      .filter(m => roleFilter === "all" || groupOf(m.role) === roleFilter)
      .filter(m => !q || `${m.name} ${m.jobTitle ?? ""} ${m.login}`.toLowerCase().includes(q));
  }, [members, tab, roleFilter, query]);

  const groups = MEMBER_GROUPS
    .map(g => ({ ...g, items: filtered.filter(m => groupOf(m.role) === g.id) }))
    .filter(g => g.items.length > 0);

  const counts = Object.fromEntries(TABS.map(t => [t.id, members.filter(t.test).length])) as Record<Tab, number>;

  // ── Ações ────────────────────────────────────────────────────────────────
  const openNew  = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (m: Member) => { setEditing(m); setFormOpen(true); };
  const openAbsence = (userId?: number) => { setAbsencePreset(userId ?? null); setAbsenceOpen(true); };
  const canEdit = (m: Member) => canManage && (isAdmin || ["coordinator", "editor"].includes(m.role));

  const reactivate = async (m: Member) => {
    try { await apiPut(`/api/users/${m.id}`, { status: "active" }); toast.success(`${m.name} reativado`); reloadAll(); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao reativar"); }
  };

  /** Pessoa voltou antes: ausência passa a terminar ontem (ou é removida se começou hoje). */
  const endAbsenceToday = async (a: Absence, name: string) => {
    try {
      if (a.startDate >= today) {
        if (!confirm(`A ausência de ${name} começou hoje. Remover o registro?`)) return;
        await apiDelete(`/api/absences/${a.id}`);
      } else {
        const y = new Date(); y.setDate(y.getDate() - 1);
        await apiPut(`/api/absences/${a.id}`, { endDate: localIso(y) });
      }
      toast.success(`${name} está disponível a partir de hoje`);
      reloadAll();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao encerrar ausência"); }
  };

  const confirmReset = async () => {
    if (!resetFor) return;
    try {
      await apiPut(`/api/users/${resetFor.id}`, { password: resetPw, mustChangePassword: true });
      toast.success("Senha redefinida");
      reloadAll();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao redefinir senha"); }
  };

  const removeMember = async (m: Member) => {
    if (!confirm(`Excluir o cadastro de ${m.name}? Só é possível para quem não tem histórico.`)) return;
    try { await apiDelete(`/api/users/${m.id}`); toast.success("Cadastro excluído"); setSelId(null); load(); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao excluir"); }
  };

  const activeMembers = members.filter(isActiveUser);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
            <Users className="h-5 w-5 text-[hsl(var(--primary))]" />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Membros</h1>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {counts.active} ativos · {counts.away} fora hoje · {counts.inactive} inativos
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/team/ausencias"><Palmtree className="h-4 w-4 mr-2 text-amber-500" />Ausências</Link>
          </Button>
          {canManage && <HeadAction icon={Plus} label="Novo membro" short="Novo" onClick={openNew} />}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Situação" className="flex flex-wrap gap-1 rounded-xl border bg-[hsl(var(--card))] p-1">
          {TABS.map(t => {
            const on = t.id === tab;
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)}
                className={cn("h-9 rounded-lg px-3 text-sm font-semibold inline-flex items-center gap-2 transition-colors",
                  on ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")}>
                {t.label}
                <span className={cn("rounded-full px-1.5 text-[11px] leading-5",
                  t.id === "away" ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                  : on ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]")}>
                  {counts[t.id]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[200px]" aria-label="Filtrar por perfil"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os perfis</SelectItem>
              {MEMBER_GROUPS.map(g => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nome, cargo ou @login"
              aria-label="Buscar membro" className="pl-9 w-[240px]" />
          </div>
          <div className="flex rounded-lg border bg-[hsl(var(--card))] p-0.5">
            <Button variant="ghost" size="icon" aria-label="Ver em cartões" onClick={() => setView("grid")}
              className={cn("h-8 w-8", view === "grid" && "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]")}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Ver em lista" onClick={() => setView("list")}
              className={cn("h-8 w-8", view === "list" && "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]")}>
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        {/* Lista */}
        <div className="flex-[999_1_600px] min-w-0 space-y-6">
          {loading ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Carregando...</p>
          ) : groups.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">Ninguém encontrado.</div>
          ) : groups.map(g => (
            <section key={g.id} className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/70">
                {g.label} — {g.items.length}
              </h2>

              {view === "grid" ? (
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
                  {g.items.map(m => {
                    const up = upcomingOf(m.id);
                    return (
                      <article key={m.id}
                        className={cn("flex flex-col gap-3 rounded-2xl border bg-[hsl(var(--card))] p-4 card-float transition-colors",
                          selId === m.id && "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5",
                          !isActiveUser(m) && "opacity-80")}>
                        <button type="button" onClick={() => setSelId(m.id)} aria-label={`Abrir perfil de ${m.name}`}
                          className="flex items-center gap-3 text-left">
                          <MemberAvatar member={m} size={48} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{m.name}</span>
                            <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{m.jobTitle || ROLE_LABEL[m.role]}</span>
                            <span className="block font-mono text-[11px] text-[hsl(var(--muted-foreground))]/70">@{m.login}</span>
                          </span>
                        </button>
                        <div className="flex flex-wrap gap-1.5">
                          <RoleChip role={m.role} me={m.id === user?.id} />
                          <StatusChip member={m} />
                          {isActiveUser(m) && up && (
                            <span className="inline-flex items-center rounded-full border border-dashed border-amber-500/50 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                              {up.label} {fmtShortDate(up.startDate)}
                            </span>
                          )}
                          {isActiveUser(m) && m.mustChangePassword && <FirstAccessChip />}
                        </div>
                        <div className="mt-auto flex items-center justify-between border-t pt-2.5 text-xs text-[hsl(var(--muted-foreground))]">
                          <span>{fmtLastSeen(m)}</span>
                          {canEdit(m) && (
                            <span className="flex gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${m.name}`} onClick={() => openEdit(m)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {isActiveUser(m) && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Registrar ausência de ${m.name}`} onClick={() => openAbsence(m.id)}>
                                  <CalendarPlus className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border bg-[hsl(var(--card))]">
                  <div className="min-w-[680px] divide-y">
                    {g.items.map(m => (
                      <div key={m.id}
                        className={cn("grid items-center gap-3 px-4 py-2.5", selId === m.id && "bg-[hsl(var(--primary))]/5")}
                        style={{ gridTemplateColumns: "2.4fr 1fr 1.5fr 1fr 40px" }}>
                        <button type="button" onClick={() => setSelId(m.id)} className="flex min-w-0 items-center gap-2.5 text-left">
                          <MemberAvatar member={m} size={34} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{m.name}</span>
                            <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{m.jobTitle || ROLE_LABEL[m.role]}</span>
                          </span>
                        </button>
                        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">@{m.login}</span>
                        <span><StatusChip member={m} /></span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">{fmtLastSeen(m)}</span>
                        {canEdit(m) ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7 justify-self-end" aria-label={`Editar ${m.name}`} onClick={() => openEdit(m)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : <span />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Perfil */}
        <aside aria-label="Perfil do membro"
          className="flex-[1_1_320px] max-w-[400px] min-w-0 overflow-hidden rounded-2xl border bg-[hsl(var(--card))] lg:sticky lg:top-4">
          {!sel ? (
            <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              Selecione um membro para ver o perfil.
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2.5 border-b bg-[hsl(var(--muted))]/20 px-5 py-6 text-center">
                <MemberAvatar member={sel} size={72} />
                <div>
                  <p className="text-lg font-bold">{sel.name}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{sel.jobTitle || ROLE_LABEL[sel.role]}</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <RoleChip role={sel.role} me={sel.id === user?.id} />
                  <StatusChip member={sel} />
                </div>
              </div>

              {isAway(sel) && sel.absence && (
                <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-semibold text-amber-700 dark:text-amber-300">{sel.absence.label} até {fmtShortDate(sel.absence.endDate)}</span>
                    <span className="block text-xs text-amber-800/70 dark:text-amber-200/70">Aparece como ausente na agenda e nos plantões</span>
                  </span>
                  {canManage && (
                    <Button variant="outline" size="sm" className="shrink-0 border-amber-500/50"
                      onClick={() => endAbsenceToday(sel.absence!, sel.name)}>Encerrar hoje</Button>
                  )}
                </div>
              )}
              {!isActiveUser(sel) && (
                <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-xl border bg-[hsl(var(--muted))]/40 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-semibold">Inativo</span>
                    <span className="block text-xs text-[hsl(var(--muted-foreground))]">Sem acesso · histórico preservado</span>
                  </span>
                  {canEdit(sel) && <Button variant="outline" size="sm" onClick={() => reactivate(sel)}>Reativar</Button>}
                </div>
              )}

              <dl className="grid gap-x-3 gap-y-2.5 border-b px-5 py-4 text-sm" style={{ gridTemplateColumns: "120px minmax(0,1fr)" }}>
                <dt className="text-[hsl(var(--muted-foreground))]">Login</dt><dd className="font-mono">@{sel.login}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Perfil de acesso</dt><dd>{ROLE_LABEL[sel.role] ?? sel.role}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">E-mail</dt><dd className="truncate">{sel.email || "—"}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Telefone</dt><dd>{sel.phone || "—"}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Membro desde</dt><dd>{fmtJoined(sel.createdAt)}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Último acesso</dt><dd>{fmtLastSeen(sel)}</dd>
              </dl>

              <div className="space-y-2.5 border-b px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/70">Ausências</span>
                  {canManage && isActiveUser(sel) && (
                    <button type="button" className="text-xs font-medium text-[hsl(var(--primary))] hover:underline" onClick={() => openAbsence(sel.id)}>
                      + Registrar
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma ausência registrada.</p>
                ) : history.slice(0, 6).map(a => {
                  const tag = a.startDate > today ? "programada" : a.endDate < today ? "concluída" : "agora";
                  return (
                    <div key={a.id} className="flex items-center gap-2.5 rounded-lg bg-[hsl(var(--muted))]/40 px-3 py-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full",
                        tag === "agora" ? "bg-amber-500" : tag === "programada" ? "bg-sky-500" : "bg-[hsl(var(--muted-foreground))]/40")} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{a.label}</span>
                        <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                          {a.startDate === a.endDate ? fmtShortDate(a.startDate) : `${fmtShortDate(a.startDate)} a ${fmtShortDate(a.endDate)}`}
                        </span>
                      </span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        tag === "agora" ? "border-amber-500/40 text-amber-600 dark:text-amber-300"
                        : tag === "programada" ? "border-sky-500/40 text-sky-600 dark:text-sky-300"
                        : "text-[hsl(var(--muted-foreground))]")}>{tag}</span>
                    </div>
                  );
                })}
              </div>

              {canEdit(sel) && (
                <div className="flex flex-wrap gap-2 px-5 py-4">
                  <Button className="flex-[1_1_140px]" onClick={() => openEdit(sel)}>Editar dados</Button>
                  <Button variant="outline" className="flex-[1_1_140px]" onClick={() => { setResetPw(generatePassword()); setResetFor(sel); }}>
                    <KeyRound className="h-4 w-4 mr-1.5" />Redefinir senha
                  </Button>
                  {sel.id !== user?.id && (
                    <Button variant="outline" className="flex-[1_1_100%]"
                      onClick={() => openHandoff({ userId: sel.id, context: "queue", onDone: reloadAll })}>
                      <Shuffle className="h-4 w-4 mr-1.5" />Redistribuir jobs…
                    </Button>
                  )}
                  {isActiveUser(sel) && sel.id !== user?.id && (
                    <Button variant="outline" className="flex-[1_1_100%] border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => setInactivating(sel)}>
                      <UserX className="h-4 w-4 mr-1.5" />Inativar membro…
                    </Button>
                  )}
                  {sel.id !== user?.id && (
                    <button type="button" onClick={() => removeMember(sel)}
                      className="w-full pt-1 text-center text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600 hover:underline">
                      Excluir cadastro
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* Diálogos */}
      {canManage && (
        <>
          <MemberFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing}
            canManageAdmins={isAdmin} onSaved={reloadAll} onRequestInactivate={m => setInactivating(m)} />
          <InactivateDialog member={inactivating} onOpenChange={v => { if (!v) setInactivating(null); }} onDone={reloadAll} />
          <AbsenceDialog open={absenceOpen} onOpenChange={setAbsenceOpen} members={activeMembers}
            presetUserId={absencePreset} onSaved={reloadAll} />
          <Dialog open={!!resetFor} onOpenChange={v => { if (!v) setResetFor(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Redefinir senha de {resetFor?.name}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-[hsl(var(--muted-foreground))]">
                  Uma senha temporária foi gerada. A pessoa precisará trocá-la no próximo acesso.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2">
                  <code className="flex-1 font-mono text-base tracking-wider">{resetPw}</code>
                  <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(resetPw).then(() => toast.success("Senha copiada"))}>
                    <Copy className="h-3.5 w-3.5 mr-1" />Copiar
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetFor(null)}>Cancelar</Button>
                <Button onClick={async () => { await confirmReset(); setResetFor(null); }}>Redefinir</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
