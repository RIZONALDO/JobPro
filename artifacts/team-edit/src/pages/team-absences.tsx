import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { apiFetch, apiPut, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { fmtShortDate, isActiveUser, type Absence } from "@/lib/availability";
import type { Member } from "@/components/team/shared";
import { AbsenceForm, AbsenceDialog } from "@/components/team/absence-form";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEK = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const range = (a: Absence) => a.startDate === a.endDate ? fmtShortDate(a.startDate) : `${fmtShortDate(a.startDate)} a ${fmtShortDate(a.endDate)}`;

export default function TeamAbsences() {
  usePageTitle("Ausências");
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "supervisor";

  const [members, setMembers]   = useState<Member[]>([]);
  const [monthAbs, setMonthAbs] = useState<Absence[]>([]);
  const [upcoming, setUpcoming] = useState<Absence[]>([]);
  const [past, setPast]         = useState<Absence[]>([]);
  const [cursor, setCursor]     = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [editing, setEditing]   = useState<Absence | null>(null);

  const now = new Date();
  const today = iso(now);

  // Grade do mês: começa na segunda anterior ao dia 1 e cobre 6 semanas
  const cells = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const loadMonth = () => {
    apiFetch<Absence[]>(`/api/absences?from=${iso(cells[0])}&to=${iso(cells[41])}`).then(setMonthAbs).catch(() => {});
  };
  const loadLists = () => {
    apiFetch<Absence[]>("/api/absences").then(setUpcoming).catch(() => {});
    apiFetch<Absence[]>(`/api/absences?from=${iso(addDays(now, -90))}&to=${iso(addDays(now, -1))}`)
      .then(r => setPast(r.filter(a => a.endDate < today).reverse().slice(0, 10))).catch(() => {});
  };
  const reload = () => { loadMonth(); loadLists(); };

  useEffect(() => { apiFetch<Member[]>("/api/users").then(setMembers).catch(() => toast.error("Erro ao carregar membros")); loadLists(); }, []);
  useEffect(loadMonth, [cells]);

  const byId = (id: number) => members.find(m => m.id === id);
  const current = upcoming.filter(a => a.startDate <= today);
  const scheduled = upcoming.filter(a => a.startDate > today);

  const endToday = async (a: Absence) => {
    const name = byId(a.userId)?.name ?? "A pessoa";
    try {
      if (a.startDate >= today) {
        if (!confirm(`A ausência de ${name} começou hoje. Remover o registro?`)) return;
        await apiDelete(`/api/absences/${a.id}`);
      } else {
        await apiPut(`/api/absences/${a.id}`, { endDate: iso(addDays(now, -1)) });
      }
      toast.success(`${name} está disponível a partir de hoje`);
      reload();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao encerrar"); }
  };
  const remove = async (a: Absence) => {
    if (!confirm("Remover esta ausência?")) return;
    try { await apiDelete(`/api/absences/${a.id}`); toast.success("Ausência removida"); reload(); }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro ao remover"); }
  };

  const Row = ({ a, kind }: { a: Absence; kind: "now" | "next" | "past" }) => {
    const m = byId(a.userId);
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-[hsl(var(--muted))]/40 px-3 py-2">
        <AvatarDisplay name={m?.name ?? "?"} avatarUrl={m?.avatarUrl ?? null} size={30} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{m?.name ?? "—"}</span>
          <span className="block text-xs text-[hsl(var(--muted-foreground))]">{a.label} · {range(a)}</span>
        </span>
        {canManage && kind === "now" && (
          <Button variant="outline" size="sm" className="h-7 shrink-0 border-amber-500/50 text-xs" onClick={() => endToday(a)}>Encerrar hoje</Button>
        )}
        {canManage && kind !== "past" && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar ausência" onClick={() => setEditing(a)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-[hsl(var(--destructive))]" aria-label="Remover ausência" onClick={() => remove(a)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </>
        )}
      </div>
    );
  };

  const Section = ({ title, items, kind }: { title: string; items: Absence[]; kind: "now" | "next" | "past" }) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]/70">{title} — {items.length}</p>
      {items.length === 0
        ? <p className="text-sm text-[hsl(var(--muted-foreground))]">Nenhuma.</p>
        : items.map(a => <Row key={a.id} a={a} kind={kind} />)}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <Link href="/team" className="inline-flex items-center gap-1 text-sm text-[hsl(var(--primary))] hover:underline">
          <ChevronLeft className="h-4 w-4" />Membros
        </Link>
        <h1 className="text-[28px] font-semibold tracking-tight">Ausências</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Férias, afastamentos, licenças e folgas da equipe.</p>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        {canManage && (
          <div className="flex-[1_1_320px] max-w-[380px] space-y-4 rounded-2xl border bg-[hsl(var(--card))] p-5">
            <h2 className="font-semibold">Registrar ausência</h2>
            <AbsenceForm members={members.filter(isActiveUser)} onSaved={reload} />
          </div>
        )}

        <section aria-label="Calendário de ausências" className="flex-[999_1_480px] min-w-0 space-y-3 rounded-2xl border bg-[hsl(var(--card))] p-4">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Mês anterior"
              onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="font-bold">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Próximo mês"
              onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {WEEK.map(w => <span key={w}>{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map(d => {
              const ds = iso(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const away = monthAbs.filter(a => a.startDate <= ds && a.endDate >= ds);
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={ds}
                  className={cn("flex min-h-[78px] flex-col gap-1 overflow-hidden rounded-lg border p-1.5",
                    away.length ? "border-amber-500/40 bg-amber-500/10" : weekend ? "border-transparent bg-[hsl(var(--muted))]/20" : "border-transparent bg-[hsl(var(--muted))]/40",
                    ds === today && "border-[hsl(var(--primary))]",
                    !inMonth && "opacity-40")}>
                  <span className={cn("text-xs", ds === today ? "font-bold text-[hsl(var(--primary))]" : "font-medium")}>{d.getDate()}</span>
                  <div className="flex flex-wrap gap-1">
                    {away.map(a => {
                      const m = byId(a.userId);
                      return (
                        <span key={a.id} title={`${m?.name ?? "?"} — ${a.label}`}>
                          <AvatarDisplay name={m?.name ?? "?"} avatarUrl={m?.avatarUrl ?? null} size={22} className="ring-2 ring-amber-500" />
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-label="Lista de ausências" className="flex-[1_1_300px] max-w-[380px] min-w-0 space-y-5 rounded-2xl border bg-[hsl(var(--card))] p-4">
          <Section title="Agora" items={current} kind="now" />
          <Section title="Programadas" items={scheduled} kind="next" />
          <Section title="Histórico recente" items={past} kind="past" />
        </section>
      </div>

      {canManage && (
        <AbsenceDialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}
          members={members.filter(isActiveUser)} editing={editing} onSaved={reload} />
      )}
    </div>
  );
}
