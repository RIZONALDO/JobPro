/**
 * Relatórios: como a ilha está entregando, no mesmo layout do Dashboard (faixa de indicadores + grade em pares).
 * Inspirado no que Jira/Asana fazem bem:
 *  - período com atalhos e comparação automática com o período anterior (setas de tendência);
 *  - "Destaques": frases geradas a partir dos números (o que mudou, onde está o gargalo);
 *  - vazão por semana, tempo em cada fase ("time in status"), gráfico de controle do tempo de ciclo;
 *  - recortes por editor, cliente e gestor; riscos e retrabalho;
 *  - drill-down: clicar numa barra, linha ou destaque filtra a tabela de jobs embaixo;
 *  - visões salvas (no navegador) e exportação (CSV e documento para imprimir).
 * Os dados vêm de GET /api/reports/analytics (ciclo de vida já calculado, em minutos de expediente).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/hooks/use-realtime";
import { usePageTitle } from "@/lib/use-page-title";
import { useTaskModal } from "@/contexts/TaskModalContext";
import { roleName } from "@/lib/roles";
import { DAY, fmt, fmtDay, fmtH } from "@/lib/fila";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { FilterPop, type Opt } from "@/components/fila/FilterPop";
import { clientColor } from "@/components/fila/job-shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, Briefcase, Check, ChevronDown, Clock, Download, FileText, HandPalm,
  Hourglass, Scales, Shield, Bookmark, Timer, Users, X, AlertTriangle, ArrowRight, Trash2, Save,
} from "@/lib/icons";

/* ── bloco de relatório: seção plana de documento (título, explicação, conteúdo), sem cartão ── */
function Widget({ title, sub, right, children, className }: {
  title: string; sub?: React.ReactNode; right?: React.ReactNode; icon?: unknown; children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {sub && <p className={cn("text-[12.5px]", muted)}>{sub}</p>}
        </div>
        {right}
      </div>
      <div className="flex min-w-0 flex-col">{children}</div>
    </section>
  );
}

/* ── dados ── */
interface RJob {
  id: number; code: string; title: string; client: string | null; status: string; editorId: number | null; coordId: number | null;
  created: number; firstStart: number | null; firstReview: number | null; closedAt: number | null; cancelledAt: number | null;
  due: number | null; dueOriginal: number | null; est: number; worked: number; estCoord: number | null; estEditor: number | null;
  revisions: number; leadFirst: number | null; leadClose: number | null;
  stage: { fila: number; edicao: number; travado: number; cliente: number };
  blocks: number; blockReasons: string[]; reneg: number; reassign: number; furou: number; clientChanges: number; estContest: number; estExpired: number;
}
interface RPerson { id: number; name: string; role: string; jobTitle: string | null; avatarUrl: string | null; status: string }
/** algo que esperou uma resposta: travado, estimativa contestada, job sem editor, pedido */
interface Wait { taskId: number | null; coordId?: number | null; at: number; resolvedBy?: number | null; open: boolean; wait: number }
interface RReq extends Wait { id: number; kind: string; requestedById: number; approverId: number | null; decidedById: number | null; status: string; escalated: boolean }
interface RTeam {
  blocks: Wait[]; disputes: Wait[]; noEditor: Wait[]; requests: RReq[];
  actions: { actorId: number; kind: string; taskId: number | null; at: number }[];
}
interface RData { now: number; me: number; role: string; jobs: RJob[]; people: RPerson[]; team: RTeam }

const muted = "text-[hsl(var(--muted-foreground))]";
const STAGES = [
  { k: "fila", label: "Na fila", tone: "bg-[hsl(var(--foreground)/0.22)]" },
  { k: "edicao", label: "Em edição", tone: "bg-[hsl(var(--foreground)/0.7)]" },
  { k: "travado", label: "Travado", tone: "bg-amber-500" },
  { k: "cliente", label: "Com o cliente", tone: "bg-[hsl(var(--foreground)/0.42)]" },
] as const;
type StageK = typeof STAGES[number]["k"];
const STATUS: Record<string, string> = {
  pending: "Na fila", in_progress: "Em edição", in_revision: "Alteração", reopened: "Reaberto", paused: "Travado",
  review: "Com o cliente", completed: "Aprovado", cancelled: "Cancelado",
};

/* ── período ── */
type Preset = "7" | "30" | "90" | "mes" | "mespassado" | "ano" | "custom";
const PRESETS: [Preset, string][] = [["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["mes", "Este mês"], ["mespassado", "Mês passado"], ["ano", "Este ano"]];
const dUTC = (day: number) => new Date(day * 86_400_000);
const dayOfIso = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000);
const isoOfDay = (day: number) => dUTC(day).toISOString().slice(0, 10);
function range(p: Preset, today: number, custom: { from: string; to: string }): [number, number] {
  const x = dUTC(today), y = x.getUTCFullYear(), m = x.getUTCMonth();
  const md = (yy: number, mm: number) => Math.round(Date.UTC(yy, mm, 1) / 86_400_000);
  switch (p) {
    case "7": return [today - 6, today + 1];
    case "30": return [today - 29, today + 1];
    case "90": return [today - 89, today + 1];
    case "mes": return [md(y, m), today + 1];
    case "mespassado": return [md(y, m - 1), md(y, m)];
    case "ano": return [md(y, 0), today + 1];
    default: {
      const a = custom.from ? dayOfIso(custom.from) : today - 29, b = custom.to ? dayOfIso(custom.to) + 1 : today + 1;
      return [Math.min(a, b - 1), b];
    }
  }
}

/* ── estatística ── */
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pctl = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const onTime = (j: RJob) => j.firstReview != null && j.dueOriginal != null ? j.firstReview <= j.dueOriginal : null;
const ratio = (j: RJob) => (j.est > 0 && j.worked > 0 ? j.worked / j.est : null);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);

function metrics(js: RJob[]) {
  const ot = js.map(onTime).filter((x): x is boolean => x != null);
  const rs = js.map(ratio).filter((x): x is number => x != null);
  return {
    n: js.length,
    onTime: pct(ot.filter(Boolean).length, ot.length),
    lead: median(js.map(j => j.leadFirst).filter((x): x is number => x != null)),
    hours: js.reduce((s, j) => s + j.worked, 0),
    est: rs.length ? Math.round((median(rs) ?? 0) * 100) : null,
    revisions: js.length ? js.reduce((s, j) => s + j.revisions, 0) / js.length : null,
  };
}
type M = ReturnType<typeof metrics>;

/* ── visões salvas ── */
interface View { name: string; preset: Preset; custom: { from: string; to: string }; compare: boolean; mine: boolean; clients: string[]; editors: number[]; coords: number[] }
const VIEWS_KEY = "reports:views";
const loadViews = (): View[] => { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"); } catch { return []; } };
const saveViews = (v: View[]) => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* ok */ } };

interface Focus { label: string; ids: number[] }

/* ── catálogo de relatórios ── */
const REPORTS = [
  { k: "resumo", group: "Visão geral", label: "Resumo do período", q: "Como a ilha entregou no período, comparado ao período anterior, e onde olhar primeiro." },
  { k: "entregas", group: "Entrega", label: "Entregas e prazos", q: "Quantos jobs saíram por semana e quantos cumpriram o prazo combinado com o cliente." },
  { k: "ciclo", group: "Entrega", label: "Tempo de ciclo", q: "Quanto expediente cada job levou da criação até a 1ª versão, e quais fugiram do padrão." },
  { k: "fases", group: "Entrega", label: "Onde o tempo vai", q: "Em que fase os jobs passam mais tempo: fila, edição, travado ou esperando o cliente." },
  { k: "estimativa", group: "Qualidade", label: "Estimado × realizado", q: "As horas estimadas batem com as horas feitas? Quem estima para mais ou para menos." },
  { k: "riscos", group: "Qualidade", label: "Riscos e retrabalho", q: "O que atrasou ou encareceu a entrega: alterações, prazos empurrados, travamentos." },
  { k: "equipe", group: "Equipe", label: "Equipe toda", q: "Como cada pessoa contribuiu no período: quem entrega, quem decide e quanto tempo as coisas esperaram por cada um." },
  { k: "editores", group: "Equipe", label: "Editores", q: "Entregas, prazo, tempo até a 1ª versão e estimativa de cada editor." },
  { k: "gestores", group: "Equipe", label: "Gestores", q: "Resultado dos jobs de cada gestor e quanto tempo ele leva para responder ao que depende dele." },
  { k: "supervisao", group: "Equipe", label: "Supervisão", q: "O que chegou à supervisão, quanto esperou por uma decisão e o que está esperando agora." },
  { k: "clientes", group: "Clientes", label: "Clientes", q: "Quem mais demanda, quem mais pede alteração e quem demora para aprovar." },
] as const;
type RepK = typeof REPORTS[number]["k"];

const SUP_ONLY: RepK[] = ["equipe", "supervisao"];
const visibleReports = (isSup: boolean) => REPORTS.filter(r => isSup || !SUP_ONLY.includes(r.k)).map(r => (!isSup && r.k === "gestores" ? { ...r, label: "Meu desempenho", q: "Resultado dos seus jobs e quanto tempo você leva para responder ao que depende de você." } : r));
function Catalog({ current, onPick, isSup, teaser }: { current: RepK; onPick: (k: RepK) => void; isSup: boolean; teaser: Partial<Record<RepK, string>> }) {
  const list = visibleReports(isSup);
  const groups = [...new Set(list.map(r => r.group))];
  return (
    <nav aria-label="Relatórios" className="min-w-0 lg:sticky lg:top-2">
      {/* celular: lista horizontal */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {list.map(r => (
          <button key={r.k} type="button" onClick={() => onPick(r.k)} aria-current={current === r.k ? "page" : undefined}
            className={cn("h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold", current === r.k ? "border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]" : muted)}>{r.label}</button>
        ))}
      </div>
      {/* desktop: índice agrupado, com a prévia do número de cada relatório */}
      <div className="hidden flex-col gap-4 lg:flex">
        {groups.map(g => (
          <div key={g}>
            <p className={cn("mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider", muted)}>{g}</p>
            <ul className="flex flex-col">
              {list.filter(r => r.group === g).map(r => {
                const on = current === r.k;
                return (
                  <li key={r.k}>
                    <button type="button" onClick={() => onPick(r.k)} aria-current={on ? "page" : undefined}
                      className={cn("relative flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors", on ? "bg-[hsl(var(--accent))]" : "hover:bg-[hsl(var(--accent)/0.6)]")}>
                      {on && <i className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[hsl(var(--foreground))]" />}
                      <span className={cn("text-[13.5px]", on ? "font-semibold" : "font-medium")}>{r.label}</span>
                      {teaser[r.k] && <span className={cn("text-[11.5px] tabular-nums", muted)}>{teaser[r.k]}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** Texto de leitura do relatório: o que os números dizem, em frases. */
function Lede({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl space-y-2 text-[14.5px] leading-relaxed [&_b]:font-semibold">{children}</div>;
}
const cmpTxt = (a: number | null, b: number | null | undefined, unit: string, better: "up" | "down", f: (n: number) => string = n => String(n)) => {
  if (a == null || b == null || a === b) return null;
  const up = a > b, good = up === (better === "up");
  return <span className={good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}> ({up ? "+" : "−"}{f(Math.abs(a - b))}{unit} vs período anterior)</span>;
};
function ledeEntregas(cur: RJob[], mc: M, mp: M | null) {
  if (!cur.length) return <p className={muted}>Nenhum job entregue no período.</p>;
  const late = cur.filter(j => onTime(j) === false), noDue = cur.filter(j => onTime(j) == null).length;
  return <>
    <p>Foram <b>{mc.n} entregas</b>{cmpTxt(mc.n, mp?.n, "", "up")}. <b>{mc.onTime ?? "—"}%</b> saíram dentro do prazo combinado no início{cmpTxt(mc.onTime, mp?.onTime, " p.p.", "up")}{late.length ? <>; <b>{late.length}</b> passaram do prazo</> : ""}{noDue ? `, e ${noDue} não tinham prazo` : ""}.</p>
    {late.length > 0 && <p className={muted}>O prazo considerado é o prometido ao cliente quando o job foi criado, mesmo que tenha sido renegociado depois.</p>}
  </>;
}
function ledeCiclo(cur: RJob[], mc: M, mp: M | null) {
  const ys = cur.map(j => j.leadFirst).filter((x): x is number => x != null);
  if (!ys.length) return <p className={muted}>Nenhum job entregue no período.</p>;
  const p85 = pctl(ys, 0.85)!, out = cur.filter(j => (j.leadFirst ?? 0) > p85);
  return <p>Metade dos jobs chegou à 1ª versão em até <b>{fmtH(mc.lead!)}</b> de expediente{cmpTxt(mc.lead, mp?.lead, "", "down", fmtH)}, e 85% em até <b>{fmtH(p85)}</b>. {out.length > 0 && <><b>{out.length}</b> {out.length === 1 ? "job ficou" : "jobs ficaram"} acima disso: são os pontos no alto do gráfico, bons candidatos para entender o que travou.</>}</p>;
}
function ledeFases(cur: RJob[]) {
  if (!cur.length) return <p className={muted}>Nenhum job entregue no período.</p>;
  const t = STAGES.map(st => ({ st, m: cur.reduce((a, j) => a + j.stage[st.k], 0) / cur.length }));
  const all = t.reduce((a, x) => a + x.m, 0), top = [...t].sort((a, b) => b.m - a.m)[0];
  const edit = t.find(x => x.st.k === "edicao")!.m;
  return <p>Em média, um job leva <b>{fmtH(all)}</b> de expediente do início ao fim, mas só <b>{fmtH(edit)}</b> ({all ? Math.round((edit / all) * 100) : 0}%) são de edição de fato. A fase mais longa é <b>{top.st.label.toLowerCase()}</b>, com {all ? Math.round((top.m / all) * 100) : 0}% do tempo.</p>;
}

/** Leitura de um recorte (editor, cliente, gestor): quem concentra as entregas e quem vai melhor no prazo. */
function ledeGroup(cur: RJob[], key: (j: RJob) => string | null, one: string, many: string) {
  const g = groupBy(cur.filter(j => key(j)), j => key(j)!).map(([k, js]) => ({ k, js, m: metrics(js) }));
  if (!g.length) return <p className={muted}>Nenhum job entregue no período.</p>;
  const most = [...g].sort((a, b) => b.js.length - a.js.length)[0];
  const rated = g.filter(x => x.js.length >= 2 && x.m.onTime != null);
  const best = [...rated].sort((a, b) => b.m.onTime! - a.m.onTime!)[0], worst = [...rated].sort((a, b) => a.m.onTime! - b.m.onTime!)[0];
  return <p><b>{g.length}</b> {g.length === 1 ? one : many} com entregas no período. <b>{most.k}</b> concentra <b>{Math.round((most.js.length / cur.length) * 100)}%</b> delas ({most.js.length} de {cur.length}).{best && worst && best.k !== worst.k && <> No prazo, o melhor resultado é de <b>{best.k}</b> ({best.m.onTime}%) e o mais baixo, de <b>{worst.k}</b> ({worst.m.onTime}%).</>}</p>;
}
function ledeRiscos(cur: RJob[]) {
  if (!cur.length) return <p className={muted}>Nenhum job entregue no período.</p>;
  const hit = cur.filter(j => j.revisions + j.reneg + j.blocks + j.estExpired + j.reassign > 0);
  const rev = cur.reduce((a, j) => a + j.revisions, 0), rn = cur.reduce((a, j) => a + j.reneg, 0);
  return <p><b>{hit.length} de {cur.length}</b> jobs ({Math.round((hit.length / cur.length) * 100)}%) tiveram algum evento de risco ou retrabalho. Foram <b>{rev}</b> {rev === 1 ? "rodada" : "rodadas"} de alteração do cliente e <b>{rn}</b> {rn === 1 ? "prazo empurrado" : "prazos empurrados"}.</p>;
}

/* ── resumo do período: texto, tabela comparativa e pontos de atenção ── */
function Summary({ cur, prev, mc, mp, name, periodLabel, onDrill, onGo, isSup }: {
  cur: RJob[]; prev: RJob[] | null; mc: M; mp: M | null; name: (id: number | null) => string; periodLabel: string; onDrill: (f: Focus) => void; onGo: (k: RepK) => void; isSup: boolean;
}) {
  const ins = buildInsights(cur, prev, mc, mp, name);
  const rows: { l: string; a: number | null; b: number | null | undefined; f: (n: number) => string; better: "up" | "down" | null; go: RepK }[] = [
    { l: "Jobs entregues (1ª versão)", a: mc.n, b: mp?.n, f: n => String(n), better: "up", go: "entregas" },
    { l: "Entregues no prazo", a: mc.onTime, b: mp?.onTime, f: n => `${n}%`, better: "up", go: "entregas" },
    { l: "Tempo até a 1ª versão (mediana)", a: mc.lead, b: mp?.lead, f: fmtH, better: "down", go: "ciclo" },
    { l: "Horas editadas", a: mc.hours, b: mp?.hours, f: fmtH, better: null, go: "estimativa" },
    { l: "Realizado sobre o estimado", a: mc.est, b: mp?.est, f: n => `${n}%`, better: null, go: "estimativa" },
    { l: "Alterações por job", a: mc.revisions == null ? null : Math.round(mc.revisions * 10) / 10, b: mp?.revisions == null ? null : Math.round(mp.revisions * 10) / 10, f: n => n.toFixed(1).replace(".", ","), better: "down", go: "riscos" },
  ];
  return <>
    <Lede>
      <p>De {periodLabel}, a ilha entregou <b>{mc.n} {mc.n === 1 ? "job" : "jobs"}</b>{cmpTxt(mc.n, mp?.n, "", "up")}{mc.onTime != null && <>, <b>{mc.onTime}%</b> dentro do prazo combinado</>}. A mediana até a 1ª versão foi de <b>{mc.lead == null ? "—" : fmtH(mc.lead)}</b> de expediente{mc.revisions != null && <>, e cada job teve em média <b>{mc.revisions.toFixed(1).replace(".", ",")}</b> rodada de alteração do cliente</>}.</p>
    </Lede>

    <Widget title="Números do período" sub={mp ? "Comparados ao período imediatamente anterior, de mesma duração" : "Ative “vs período anterior” para comparar"}>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[520px] text-[13.5px]">
          <thead><tr className={cn("border-b bg-[hsl(var(--muted)/0.35)] text-[11px] uppercase tracking-wider", muted)}>
            <th className="px-4 py-2 text-left font-semibold">Indicador</th><th className="px-4 py-2 text-right font-semibold">Este período</th>
            {mp && <><th className="px-4 py-2 text-right font-semibold">Anterior</th><th className="px-4 py-2 text-right font-semibold">Variação</th></>}
            <th className="w-8" />
          </tr></thead>
          <tbody>{rows.map(r => {
            const d = r.a != null && r.b != null ? r.a - r.b : null;
            const good = d == null || d === 0 || r.better == null ? null : (d > 0) === (r.better === "up");
            return (
              <tr key={r.l} onClick={() => onGo(r.go)} className="group cursor-pointer border-b last:border-b-0 hover:bg-[hsl(var(--accent)/0.5)]">
                <td className="px-4 py-2.5">{r.l}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.a == null ? "—" : r.f(r.a)}</td>
                {mp && <>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums", muted)}>{r.b == null ? "—" : r.f(r.b)}</td>
                  <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", good == null ? muted : good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>
                    {d == null ? "—" : d === 0 ? "=" : <span className="inline-flex items-center gap-0.5">{d > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{r.f(Math.abs(d)).replace("%", r.f === fmtH ? "" : " p.p.")}</span>}
                  </td>
                </>}
                <td className="pr-3 text-right"><ArrowRight className={cn("inline h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100", muted)} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Widget>

    <Widget title="Pontos de atenção" sub="Gerados a partir dos números · clique para ver os jobs">
      {ins.length ? (
        <ol className="flex flex-col divide-y rounded-xl border">
          {ins.map((x, i) => {
            const I = x.icon;
            return (
              <li key={i}>
                <button type="button" disabled={!x.focus} onClick={() => x.focus && onDrill(x.focus)} className="group flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[hsl(var(--accent)/0.5)] disabled:hover:bg-transparent">
                  <span className={cn("mt-0.5 w-5 shrink-0 text-[12px] font-semibold tabular-nums", muted)}>{i + 1}.</span>
                  <I className={cn("mt-0.5 h-4 w-4 shrink-0", x.tone === "bad" ? "text-rose-500" : x.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : muted)} />
                  <span className="min-w-0 flex-1 text-[13.5px] leading-snug [&_b]:font-semibold">{x.text}</span>
                  {x.focus && <span className={cn("shrink-0 text-xs font-semibold opacity-0 transition-opacity group-hover:opacity-100", muted)}>ver jobs</span>}
                </button>
              </li>
            );
          })}
        </ol>
      ) : <p className={cn("text-[13.5px]", muted)}>Nada fora do comum em prazo, fases, alterações ou estimativa.</p>}
    </Widget>

    <Widget title="Continue lendo" sub="Os outros relatórios deste período">
      <div className="grid gap-px overflow-hidden rounded-xl border bg-[hsl(var(--border))] sm:grid-cols-2">
        {visibleReports(isSup).filter(r => r.k !== "resumo").map(r => (
          <button key={r.k} type="button" onClick={() => onGo(r.k)} className="group flex items-start justify-between gap-3 bg-[hsl(var(--card))] px-4 py-3 text-left hover:bg-[hsl(var(--accent)/0.5)]">
            <span className="min-w-0"><b className="block text-[13.5px] font-semibold">{r.label}</b><span className={cn("block text-[12px] leading-snug", muted)}>{r.q}</span></span>
            <ArrowRight className={cn("mt-1 h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5", muted)} />
          </button>
        ))}
      </div>
    </Widget>
  </>;
}

/* ── entregas por semana em tabela ── */
function WeekTable({ jobs, d0, d1, onDrill }: { jobs: RJob[]; d0: number; d1: number; onDrill: (f: Focus) => void }) {
  const monday = (d: number) => d - ((dUTC(d).getUTCDay() + 6) % 7);
  const rows: { a: number; b: number; js: RJob[] }[] = [];
  for (let a = monday(d0); a < d1; a += 7) rows.push({ a: Math.max(a, d0), b: Math.min(a + 7, d1), js: jobs.filter(j => { const d = Math.floor(j.firstReview! / DAY); return d >= Math.max(a, d0) && d < Math.min(a + 7, d1); }) });
  return (
    <Widget title="Semana a semana" sub="Clique numa semana para ver os jobs">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead><tr className={cn("border-b bg-[hsl(var(--muted)/0.35)] text-[11px] uppercase tracking-wider", muted)}>
            {["Semana", "Entregues", "No prazo", "Fora do prazo", "% no prazo"].map((h, i) => <th key={h} className={cn("px-4 py-2 font-semibold", i ? "text-right" : "text-left")}>{h}</th>)}
          </tr></thead>
          <tbody>{[...rows].reverse().map(r => {
            const ok = r.js.filter(j => onTime(j) === true).length, late = r.js.filter(j => onTime(j) === false).length;
            return (
              <tr key={r.a} onClick={() => r.js.length && onDrill({ label: `Entregues de ${fmtDay(r.a)} a ${fmtDay(r.b - 1)}`, ids: r.js.map(j => j.id) })}
                className={cn("border-b last:border-b-0", r.js.length ? "cursor-pointer hover:bg-[hsl(var(--accent)/0.5)]" : muted)}>
                <td className="px-4 py-2">{fmtDay(r.a).slice(4)} a {fmtDay(r.b - 1).slice(4)}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.js.length}</td>
                <td className="px-4 py-2 text-right tabular-nums">{ok}</td>
                <td className={cn("px-4 py-2 text-right tabular-nums", late && "font-semibold text-rose-500")}>{late}</td>
                <td className="px-4 py-2 text-right"><OnTimeBar n={pct(ok, ok + late)} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Widget>
  );
}

/* ── distribuição do tempo até a 1ª versão ── */
function Histogram({ jobs, onDrill }: { jobs: RJob[]; onDrill: (f: Focus) => void }) {
  const bins = [[0, 240, "até 4h"], [240, 480, "4h a 1 dia"], [480, 960, "1 a 2 dias"], [960, 1440, "2 a 3 dias"], [1440, 2400, "3 a 5 dias"], [2400, Infinity, "mais de 5 dias"]] as const;
  const xs = jobs.filter(j => j.leadFirst != null);
  const rows = bins.map(([a, b, l]) => ({ l, js: xs.filter(j => j.leadFirst! >= a && j.leadFirst! < b) }));
  const max = Math.max(1, ...rows.map(r => r.js.length));
  return (
    <Widget title="Distribuição" sub="Quantos jobs em cada faixa de tempo (1 dia = 8h de expediente)">
      <ul className="flex flex-col gap-1">
        {rows.map(r => (
          <li key={r.l}>
            <button type="button" disabled={!r.js.length} onClick={() => onDrill({ label: `Chegaram à 1ª versão em ${r.l}`, ids: r.js.map(j => j.id) })}
              className="grid w-full grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.6)] disabled:opacity-55 disabled:hover:bg-transparent">
              <span>{r.l}</span>
              <span className="h-5 overflow-hidden rounded bg-[hsl(var(--muted)/0.6)]"><i className="block h-full rounded bg-[hsl(var(--foreground)/0.5)]" style={{ width: `${(r.js.length / max) * 100}%` }} /></span>
              <span className="text-right tabular-nums"><b className="font-semibold">{r.js.length}</b><span className={cn("text-xs", muted)}> · {xs.length ? Math.round((r.js.length / xs.length) * 100) : 0}%</span></span>
            </button>
          </li>
        ))}
      </ul>
    </Widget>
  );
}

/* ── estimado × realizado ── */
function Estimates({ jobs, name, people, onOpen, onDrill }: { jobs: RJob[]; name: (id: number | null) => string; people: RPerson[]; onOpen: (id: number) => void; onDrill: (f: Focus) => void }) {
  const pts = jobs.filter(j => j.est > 0 && j.worked > 0);
  const rs = pts.map(j => j.worked / j.est);
  const med = median(rs);
  const over = pts.filter(j => j.worked > j.est * 1.2), under = pts.filter(j => j.worked < j.est * 0.8);
  const top = Math.max(60, ...pts.map(j => Math.max(j.est, j.worked))) * 1.08;
  const W = 520, H = 360, L = 48, B = 34, T = 10, R = 10;
  const sx = (m: number) => L + (m / top) * (W - L - R), sy = (m: number) => H - B - (m / top) * (H - B - T);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => top * f);
  return <>
    <Lede>
      {!pts.length ? <p className={muted}>Nenhum job entregue com horas registradas no período.</p> : <>
        <p>Em <b>{pts.length}</b> jobs com horas registradas, o realizado ficou em <b>{Math.round((med ?? 1) * 100)}%</b> do estimado (mediana). <b>{over.length}</b> {over.length === 1 ? "levou" : "levaram"} mais de 20% acima do previsto e <b>{under.length}</b> {under.length === 1 ? "ficou" : "ficaram"} mais de 20% abaixo.</p>
        <p className={muted}>Pontos acima da diagonal levaram mais que o estimado; abaixo, sobrou tempo.</p>
      </>}
    </Lede>
    {pts.length > 0 && (
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Widget title="Cada job" sub="Horas estimadas (horizontal) × horas feitas (vertical)">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[560px]" role="img" aria-label="Estimado versus realizado por job">
            {ticks.map(v => <g key={v}>
              <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="stroke-[hsl(var(--border))]" strokeDasharray={v ? "3 4" : undefined} />
              <text x={L - 6} y={sy(v)} textAnchor="end" dominantBaseline="central" className="fill-[hsl(var(--muted-foreground))] text-[11px]">{fmtH(v)}</text>
              <text x={sx(v)} y={H - B + 16} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] text-[11px]">{fmtH(v)}</text>
            </g>)}
            <polygon points={`${sx(0)},${sy(0)} ${sx(top / 1.2)},${sy(top)} ${sx(top)},${sy(top)} ${sx(top)},${sy(top / 1.2)}`} className="fill-[hsl(var(--foreground)/0.04)]" />
            <line x1={sx(0)} y1={sy(0)} x2={sx(top)} y2={sy(top)} className="stroke-[hsl(var(--foreground)/0.45)]" strokeDasharray="6 5" strokeWidth={1.5} />
            <text x={sx(top) - 4} y={sy(top) + 14} textAnchor="end" className="fill-[hsl(var(--muted-foreground))] text-[10.5px]">feito = estimado</text>
            {pts.map(j => {
              const bad = j.worked > j.est * 1.2;
              return (
                <g key={j.id} className="cursor-pointer" onClick={() => onOpen(j.id)}>
                  <title>{`${j.code} · ${j.title}
estimado ${fmtH(j.est)} · feito ${fmtH(j.worked)} · ${name(j.editorId)}`}</title>
                  <circle cx={sx(j.est)} cy={sy(j.worked)} r={5} className={bad ? "fill-rose-500/85 stroke-rose-500" : "fill-[hsl(var(--foreground)/0.35)] stroke-[hsl(var(--foreground)/0.7)]"} strokeWidth={1.5} />
                </g>
              );
            })}
          </svg>
        </Widget>
        <Widget title="Por editor" sub="Mediana do realizado sobre o estimado">
          <RankTable rows={groupBy(pts.filter(j => j.editorId), j => String(j.editorId)).map(([k, js]) => ({ key: k, js, p: people.find(p => p.id === Number(k)), r: median(js.map(j => j.worked / j.est))! }))}
            onDrill={onDrill} label={r => `Jobs de ${r.p?.name ?? "—"} com horas registradas`}
            head={r => <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={r.p?.name ?? "?"} avatarUrl={r.p?.avatarUrl ?? null} size={22} /><b className="truncate font-semibold">{r.p?.name.split(" ")[0] ?? "—"}</b></span>}
            cols={[
              { k: "n", label: "Jobs", v: r => r.js.length },
              { k: "r", label: "Realizado", v: r => Math.round(r.r * 100), fmt: n => `${n}%`, bad: r => r.r > 1.2 },
              { k: "e", label: "Estimado", v: r => r.js.reduce((a, j) => a + j.est, 0), fmt: n => fmtH(n) },
              { k: "w", label: "Feito", v: r => r.js.reduce((a, j) => a + j.worked, 0), fmt: n => fmtH(n) },
            ]} />
        </Widget>
      </div>
    )}
  </>;
}

export default function Reports() {
  usePageTitle("Relatórios");
  const { user } = useAuth();
  const { openTask } = useTaskModal();
  const [data, setData] = useState<RData | null>(null);
  const load = () => apiFetch<RData>("/api/reports/analytics").then(setData).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);
  useRealtime({ onTasksChanged: load });

  const isSup = user?.role === "admin" || user?.role === "supervisor";
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [compare, setCompare] = useState(true);
  const [mine, setMine] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [editors, setEditors] = useState<number[]>([]);
  const [coords, setCoords] = useState<number[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [rep, setRep] = useState<RepK>(() => { try { const v = sessionStorage.getItem("reports:rep") as RepK | null; return v && REPORTS.some(r => r.k === v) ? v : "resumo"; } catch { return "resumo"; } });
  const pick = (k: RepK) => { setRep(k); setFocus(null); try { sessionStorage.setItem("reports:rep", k); } catch { /* ok */ } };
  const tableRef = useRef<HTMLDivElement>(null);

  // filtro mudou: o recorte do drill-down deixa de valer
  useEffect(() => setFocus(null), [preset, custom, mine, clients, editors, coords]);

  const drill = (f: Focus) => { setFocus(f); requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  if (!user) return null;
  if (!["admin", "supervisor", "coordinator"].includes(user.role)) return <p className={cn("py-16 text-center text-sm", muted)}>Relatórios são para gestores e supervisão.</p>;
  if (!data) return <Skeleton />;

  const now = data.now, today = Math.floor(now / DAY);
  const [d0, d1] = range(preset, today, custom);
  const A = d0 * DAY, B = d1 * DAY, len = B - A, PA = A - len;
  const person = (id: number | null) => data.people.find(p => p.id === id);
  const name = (id: number | null) => person(id)?.name ?? "—";

  // recorte (pessoas, clientes, "só os meus")
  const scoped = data.jobs.filter(j => j.status !== "cancelled"
    && (!mine || j.coordId === data.me)
    && (!clients.length || clients.includes(j.client ?? ""))
    && (!editors.length || (j.editorId != null && editors.includes(j.editorId)))
    && (!coords.length || (j.coordId != null && coords.includes(j.coordId))));
  const deliveredIn = (a: number, b: number) => scoped.filter(j => j.firstReview != null && j.firstReview >= a && j.firstReview < b);
  const cur = deliveredIn(A, B), prev = deliveredIn(PA, A);
  const mc = metrics(cur), mp = compare ? metrics(prev) : null;
  const createdIn = scoped.filter(j => j.created >= A && j.created < B);
  const inP = <T extends { at: number }>(xs: T[]) => xs.filter(x => x.at >= A && x.at < B);
  const team: RTeam = { blocks: inP(data.team.blocks), disputes: inP(data.team.disputes), noEditor: inP(data.team.noEditor), requests: inP(data.team.requests), actions: inP(data.team.actions) };

  const opts = {
    clients: count(data.jobs, j => j.client ?? "", j => j.client).map(([v, n]) => ({ value: v, label: String(v), n, color: clientColor(String(v)) })) as Opt[],
    editors: count(data.jobs, j => j.editorId ?? 0, j => j.editorId).map(([v, n]) => ({ value: v, label: name(v as number), n, avatar: person(v as number) ?? undefined })) as Opt[],
    coords: count(data.jobs, j => j.coordId ?? 0, j => j.coordId).map(([v, n]) => ({ value: v, label: name(v as number), n, avatar: person(v as number) ?? undefined })) as Opt[],
  };
  const any = clients.length + editors.length + coords.length > 0 || mine;
  const periodLabel = `${fmtDay(d0)} a ${fmtDay(d1 - 1)}`;
  // uma linha de prévia por relatório no catálogo (o número que mais importa em cada um)
  const teaser: Partial<Record<RepK, string>> = {
    resumo: `${mc.n} entregues`,
    entregas: mc.onTime == null ? "—" : `${mc.onTime}% no prazo`,
    ciclo: mc.lead == null ? "—" : `mediana ${fmtH(mc.lead)}`,
    fases: (() => { const t = STAGES.map(st => ({ st, m: cur.reduce((x, j) => x + j.stage[st.k], 0) })).sort((x, y) => y.m - x.m)[0]; return t?.m ? `${t.st.label.toLowerCase()}` : "—"; })(),
    estimativa: mc.est == null ? "—" : `${mc.est}% do estimado`,
    editores: `${new Set(cur.map(j => j.editorId).filter(Boolean)).size} editores`,
    clientes: `${new Set(cur.map(j => j.client).filter(Boolean)).size} clientes`,
    gestores: (() => { const w = [...data.team.blocks, ...data.team.disputes].filter(x => x.at >= A && x.at < B && (isSup || x.coordId === data.me)).map(x => x.wait); const m = median(w); return m == null ? `${new Set(cur.map(j => j.coordId).filter(Boolean)).size} gestores` : `responde em ${fmtH(m)}`; })(),
    supervisao: (() => { const n = data.team.requests.filter(r => r.open && (r.escalated || r.approverId == null)).length + data.team.noEditor.filter(x => x.open).length; return n ? `${n} esperando agora` : "nada esperando"; })(),
    equipe: `${new Set([...cur.map(j => j.editorId), ...cur.map(j => j.coordId), ...data.team.actions.filter(a => a.at >= A && a.at < B).map(a => a.actorId)].filter(Boolean)).size} pessoas`,
    riscos: `${cur.filter(j => j.revisions + j.reneg + j.blocks + j.estExpired + j.reassign > 0).length} jobs`,
  };

  const apply = (v: View) => { setPreset(v.preset); setCustom(v.custom); setCompare(v.compare); setMine(v.mine); setClients(v.clients); setEditors(v.editors); setCoords(v.coords); };
  const snapshot = (nm: string): View => ({ name: nm, preset, custom, compare, mine, clients, editors, coords });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 pb-10">
      {/* cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[13px]", muted)}>{periodLabel}{compare ? ` · comparado a ${fmtDay(Math.floor(PA / DAY))} a ${fmtDay(d0 - 1)}` : ""}</p>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="mt-0.5 text-[13.5px]"><b>{mc.n}</b> {mc.n === 1 ? "job entregue" : "jobs entregues"} <span className={muted}>(1ª versão para o cliente)</span> · <b>{createdIn.length}</b> criados no período</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Views views={loadViews()} onApply={apply} onSave={nm => { const v = loadViews().filter(x => x.name !== nm); saveViews([...v, snapshot(nm)]); toast.success(`Visão “${nm}” salva`); }}
            onDelete={nm => saveViews(loadViews().filter(x => x.name !== nm))} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]"><Download className="h-4 w-4" />Exportar<ChevronDown className="h-3 w-3" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuItem onSelect={() => exportCsv(cur, name, periodLabel)}><Download className="h-4 w-4" />Planilha (CSV) dos entregues</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDocument(cur, mc, name, periodLabel, user.name)}><FileText className="h-4 w-4" />Documento para imprimir / PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* barra de período e recorte */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-[hsl(var(--card))] p-2 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]">
        <div className="flex max-w-full overflow-x-auto rounded-lg border p-0.5 text-[13px] font-semibold">
          {PRESETS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPreset(k)} aria-pressed={preset === k}
              className={cn("h-8 shrink-0 rounded-md px-2.5", preset === k ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : cn(muted, "hover:text-[hsl(var(--foreground))]"))}>{l}</button>
          ))}
          <CustomRange active={preset === "custom"} value={custom} d0={d0} d1={d1} onChange={v => { setCustom(v); setPreset("custom"); }} />
        </div>
        <button type="button" onClick={() => setCompare(!compare)} aria-pressed={compare}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold", compare ? "border-[hsl(var(--foreground)/0.3)]" : cn("border-dashed", muted))}>
          <span className={cn("grid h-3.5 w-3.5 place-items-center rounded-[4px] border", compare && "border-transparent bg-[hsl(var(--foreground))] text-[hsl(var(--background))]")}>{compare && <Check className="h-2.5 w-2.5" weight="bold" />}</span>
          vs período anterior
        </button>
        <span className="mx-1 hidden h-5 w-px bg-[hsl(var(--border))] sm:block" />
        {isSup && (
          <button type="button" onClick={() => setMine(!mine)} aria-pressed={mine}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold", mine ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]" : cn("border-dashed", muted))}>
            {mine && <Check className="h-3.5 w-3.5" weight="bold" />}Só os meus
          </button>
        )}
        <FilterPop label="Cliente" plural="clientes" options={opts.clients} value={clients} onChange={setClients} />
        <FilterPop label="Editor" plural="editores" options={opts.editors} value={editors} onChange={setEditors} />
        {isSup && <FilterPop label="Gestor" plural="gestores" options={opts.coords} value={coords} onChange={setCoords} />}
        {any && <button type="button" onClick={() => { setMine(false); setClients([]); setEditors([]); setCoords([]); }} className={cn("px-1 text-xs font-semibold hover:text-[hsl(var(--foreground))]", muted)}>Limpar</button>}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Catalog current={visibleReports(isSup).some(r => r.k === rep) ? rep : "resumo"} onPick={pick} isSup={isSup} teaser={teaser} />
        <article className="min-w-0 rounded-2xl border bg-[hsl(var(--card))] px-4 py-5 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] sm:px-8 sm:py-7">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
            <div className="min-w-0 max-w-2xl">
              <p className={cn("text-[11px] font-semibold uppercase tracking-wider", muted)}>{visibleReports(isSup).find(r => r.k === rep)!.group} · {periodLabel}</p>
              <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">{visibleReports(isSup).find(r => r.k === rep)!.label}</h2>
              <p className={cn("mt-1 text-[13.5px]", muted)}>{visibleReports(isSup).find(r => r.k === rep)!.q}</p>
            </div>
            {rep !== "resumo" && <button type="button" onClick={() => exportCsv(cur, name, `${visibleReports(isSup).find(r => r.k === rep)!.label} ${periodLabel}`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold hover:bg-[hsl(var(--accent))]"><Download className="h-3.5 w-3.5" />CSV</button>}
          </header>

          <div className="flex flex-col gap-8">
            {rep === "resumo" && <Summary cur={cur} prev={compare ? prev : null} mc={mc} mp={mp} name={name} periodLabel={periodLabel} onDrill={drill} onGo={pick} isSup={isSup && !mine} />}
            {rep === "entregas" && <>
              <Lede>{ledeEntregas(cur, mc, mp)}</Lede>
              <Throughput jobs={cur} d0={d0} d1={d1} onDrill={drill} />
              <WeekTable jobs={cur} d0={d0} d1={d1} onDrill={drill} />
            </>}
            {rep === "ciclo" && <>
              <Lede>{ledeCiclo(cur, mc, mp)}</Lede>
              <ControlChart jobs={cur} A={A} B={B} name={name} onOpen={openTask} />
              <Histogram jobs={cur} onDrill={drill} />
            </>}
            {rep === "fases" && <>
              <Lede>{ledeFases(cur)}</Lede>
              <TimeInStage jobs={cur} onDrill={drill} />
            </>}
            {rep === "estimativa" && <Estimates jobs={cur} name={name} people={data.people} onOpen={openTask} onDrill={drill} />}
            {rep === "editores" && <><Lede>{ledeGroup(cur, j => j.editorId ? name(j.editorId).split(" ")[0] : null, "editor", "editores")}</Lede><ByEditor jobs={cur} people={data.people} onDrill={drill} /></>}
            {rep === "clientes" && <><Lede>{ledeGroup(cur, j => j.client, "cliente", "clientes")}</Lede><ByClient jobs={cur} onDrill={drill} /></>}
            {rep === "gestores" && <Managers jobs={cur} team={team} people={data.people} isSup={isSup} me={data.me} onDrill={drill} onOpen={openTask} />}
            {rep === "supervisao" && isSup && <Supervision team={team} teamAll={data.team} people={data.people} jobs={data.jobs} onDrill={drill} onOpen={openTask} />}
            {rep === "equipe" && isSup && <Everyone jobs={cur} team={team} people={data.people} onDrill={drill} />}
            {rep === "riscos" && <><Lede>{ledeRiscos(cur)}</Lede><Risks jobs={cur} onDrill={drill} /></>}

            <div ref={tableRef} className="scroll-mt-4 border-t pt-6">
              <JobsTable delivered={cur} created={createdIn} open={scoped.filter(j => !["completed", "cancelled"].includes(j.status))} focus={focus} onClear={() => setFocus(null)} name={name} onOpen={openTask} periodLabel={periodLabel} />
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function count<T>(js: RJob[], key: (j: RJob) => string | number, has: (j: RJob) => unknown): [string | number, number][] {
  const m = new Map<string | number, number>();
  for (const j of js) if (has(j)) m.set(key(j), (m.get(key(j)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/* ── período personalizado ── */
function CustomRange({ active, value, d0, d1, onChange }: { active: boolean; value: { from: string; to: string }; d0: number; d1: number; onChange: (v: { from: string; to: string }) => void }) {
  const [f, setF] = useState(value.from || isoOfDay(d0)), [t, setT] = useState(value.to || isoOfDay(d1 - 1));
  const input = "h-9 w-full rounded-lg border bg-[hsl(var(--background))] px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";
  return (
    <Popover onOpenChange={o => { if (o) { setF(value.from || isoOfDay(d0)); setT(value.to || isoOfDay(d1 - 1)); } }}>
      <PopoverTrigger asChild>
        <button type="button" aria-pressed={active} className={cn("h-8 shrink-0 rounded-md px-2.5", active ? "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]" : cn(muted, "hover:text-[hsl(var(--foreground))]"))}>
          {active ? `${fmtDay(d0).slice(4)} – ${fmtDay(d1 - 1).slice(4)}` : "Personalizado"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2.5 p-3">
        <label className="block text-xs font-semibold">De<input type="date" value={f} max={t} onChange={e => setF(e.target.value)} className={cn(input, "mt-1")} /></label>
        <label className="block text-xs font-semibold">Até<input type="date" value={t} min={f} onChange={e => setT(e.target.value)} className={cn(input, "mt-1")} /></label>
        <button type="button" onClick={() => onChange({ from: f, to: t })} disabled={!f || !t}
          className="h-9 w-full rounded-lg bg-[hsl(var(--primary))] text-[13px] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50">Aplicar</button>
      </PopoverContent>
    </Popover>
  );
}

/* ── visões salvas ── */
function Views({ views, onApply, onSave, onDelete }: { views: View[]; onApply: (v: View) => void; onSave: (name: string) => void; onDelete: (name: string) => void }) {
  const [nm, setNm] = useState(""), [, force] = useState(0);
  return (
    <Popover onOpenChange={() => setNm("")}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold hover:bg-[hsl(var(--accent))]"><Bookmark className="h-4 w-4" />Visões{views.length > 0 && <span className={cn("text-xs", muted)}>{views.length}</span>}</button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(300px,calc(100vw-32px))] p-0">
        <p className={cn("px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider", muted)}>Visões salvas</p>
        <ul className="max-h-64 overflow-y-auto p-1">
          {views.map(v => (
            <li key={v.name} className="group flex items-center rounded-lg hover:bg-[hsl(var(--accent))]">
              <button type="button" onClick={() => onApply(v)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13px]">{v.name}</button>
              <button type="button" aria-label={`Apagar ${v.name}`} onClick={() => { onDelete(v.name); force(x => x + 1); }} className={cn("mr-1 rounded p-1 opacity-0 hover:text-rose-500 group-hover:opacity-100", muted)}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
          {!views.length && <li className={cn("px-2 py-2 text-[12.5px]", muted)}>Salve o período e os filtros atuais para voltar com um clique.</li>}
        </ul>
        <form className="flex gap-1.5 border-t p-2" onSubmit={e => { e.preventDefault(); if (nm.trim()) { onSave(nm.trim()); setNm(""); force(x => x + 1); } }}>
          <input value={nm} onChange={e => setNm(e.target.value)} placeholder="Nome da visão atual" className="h-8 min-w-0 flex-1 rounded-lg bg-[hsl(var(--muted)/0.6)] px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]" />
          <button type="submit" disabled={!nm.trim()} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-semibold disabled:opacity-40"><Save className="h-3.5 w-3.5" />Salvar</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/* ── destaques: frases geradas a partir dos números ── */
type Ins = { icon: typeof Clock; text: React.ReactNode; tone?: "bad" | "good"; focus?: Focus };
function buildInsights(cur: RJob[], prev: RJob[] | null, mc: M, mp: M | null, name: (id: number | null) => string): Ins[] {
  const out: Ins[] = [];
  if (mp && mc.onTime != null && mp.onTime != null && Math.abs(mc.onTime - mp.onTime) >= 5) {
    const up = mc.onTime > mp.onTime;
    out.push({ icon: up ? ArrowUpRight : ArrowDownRight, tone: up ? "good" : "bad", text: <>Entregas no prazo {up ? "subiram" : "caíram"} <b>{Math.abs(mc.onTime - mp.onTime)} p.p.</b> em relação ao período anterior ({mp.onTime}% → {mc.onTime}%).</>,
      focus: up ? undefined : { label: "Entregues fora do prazo", ids: cur.filter(j => onTime(j) === false).map(j => j.id) } });
  }
  // gargalo: fase que mais consome o ciclo
  const tot = STAGES.map(s => ({ s, m: cur.reduce((a, j) => a + j.stage[s.k], 0) }));
  const all = tot.reduce((a, x) => a + x.m, 0);
  const top = [...tot].sort((a, b) => b.m - a.m)[0];
  if (all > 0 && top.m > 0) out.push({ icon: Hourglass, text: <><b>{Math.round((top.m / all) * 100)}%</b> do tempo dos jobs foi <b>{top.s.label.toLowerCase()}</b>{top.s.k === "fila" ? ": a fila está mais longa que a capacidade" : top.s.k === "cliente" ? ": aprovação do cliente é o gargalo" : top.s.k === "travado" ? ": travamentos estão segurando a entrega" : ""}.</>,
    focus: { label: `Jobs em que “${top.s.label}” foi a fase mais longa`, ids: cur.filter(j => biggest(j) === top.s.k).map(j => j.id) } });
  // cliente que mais pede alteração
  const byClient = groupBy(cur, j => j.client ?? "Sem cliente").filter(([, js]) => js.length >= 2)
    .map(([c, js]) => ({ c, js, r: js.reduce((a, j) => a + j.revisions, 0) / js.length })).sort((a, b) => b.r - a.r)[0];
  if (byClient && byClient.r >= 1) out.push({ icon: Briefcase, text: <><b>{byClient.c}</b> pede em média <b>{byClient.r.toFixed(1).replace(".", ",")} alterações</b> por job, o maior entre os clientes.</>,
    focus: { label: `Jobs de ${byClient.c}`, ids: byClient.js.map(j => j.id) } });
  // estimativa por editor mais distante do realizado
  const est = groupBy(cur.filter(j => ratio(j) != null && j.editorId), j => String(j.editorId)).filter(([, js]) => js.length >= 3)
    .map(([e, js]) => ({ e: Number(e), js, r: median(js.map(j => ratio(j)!))! })).sort((a, b) => Math.abs(b.r - 1) - Math.abs(a.r - 1))[0];
  if (est && Math.abs(est.r - 1) >= 0.2) out.push({ icon: Scales, text: <>Jobs de <b>{name(est.e).split(" ")[0]}</b> levam <b>{Math.round(Math.abs(est.r - 1) * 100)}% {est.r > 1 ? "a mais" : "a menos"}</b> que o estimado (mediana de {est.js.length} jobs).</>,
    focus: { label: `Jobs de ${name(est.e)}`, ids: est.js.map(j => j.id) } });
  const blocked = cur.filter(j => j.blocks > 0);
  if (blocked.length) {
    const reasons = groupBy(blocked.flatMap(j => j.blockReasons.map(r => ({ r: r.split(":")[0].trim(), j }))), x => x.r).sort((a, b) => b[1].length - a[1].length);
    out.push({ icon: HandPalm, tone: "bad", text: <><b>{blocked.length}</b> {blocked.length === 1 ? "job travou" : "jobs travaram"} no período{reasons[0] ? <>; motivo mais comum: <b>“{reasons[0][0]}”</b></> : ""}.</>,
      focus: { label: "Jobs que travaram", ids: blocked.map(j => j.id) } });
  }
  return out;
}
const biggest = (j: RJob): StageK => (Object.entries(j.stage) as [StageK, number][]).sort((a, b) => b[1] - a[1])[0][0];
function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m];
}

/* ── vazão: entregas por semana (no prazo × atrasadas) ── */
function Throughput({ jobs, d0, d1, onDrill }: { jobs: RJob[]; d0: number; d1: number; onDrill: (f: Focus) => void }) {
  const span = d1 - d0;
  const step = span <= 14 ? 1 : span <= 120 ? 7 : 30;
  const monday = (d: number) => d - ((dUTC(d).getUTCDay() + 6) % 7);
  const start = step === 7 ? monday(d0) : d0;
  const buckets: { a: number; b: number; js: RJob[] }[] = [];
  for (let a = start; a < d1; a += step) buckets.push({ a: Math.max(a, d0), b: Math.min(a + step, d1), js: [] });
  for (const j of jobs) { const d = Math.floor(j.firstReview! / DAY); const k = buckets.find(x => d >= x.a && d < x.b); k?.js.push(j); }
  const max = Math.max(1, ...buckets.map(x => x.js.length));
  const avg = buckets.length ? jobs.length / buckets.length : 0;
  const unit = step === 1 ? "dia" : step === 7 ? "semana" : "mês";
  const lbl = (x: { a: number; b: number }) => step === 1 ? fmtDay(x.a).slice(0, 3) + " " + fmtDay(x.a).slice(4, 6) : step === 7 ? fmtDay(x.a).slice(4) : dUTC(x.a).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" });
  return (
    <Widget icon={BarChart3} title="Entregas" sub={`Por ${unit} · no prazo e fora do prazo`}
      right={<span className={cn("text-xs", muted)}>média <b className="text-[hsl(var(--foreground))]">{avg.toFixed(1).replace(".", ",")}</b>/{unit}</span>}>
      <div className="mb-2 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--foreground)/0.6)]" />no prazo</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-rose-500/80" />fora do prazo</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--foreground)/0.18)]" />sem prazo</span>
      </div>
      <div className="relative flex h-48 items-end gap-1.5 border-b pb-px">
        {[0.5, 1].map(f => <i key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[hsl(var(--border)/0.7)]" style={{ bottom: `${f * 100}%` }} />)}
        <span className={cn("absolute -top-1 right-0 -translate-y-full text-[10.5px]", muted)}>{max}</span>
        {buckets.map(x => {
          const ok = x.js.filter(j => onTime(j) === true).length, late = x.js.filter(j => onTime(j) === false).length, none = x.js.length - ok - late;
          const h = (n: number) => `${(n / max) * 100}%`;
          return (
            <button key={x.a} type="button" disabled={!x.js.length} onClick={() => onDrill({ label: `Entregues ${step === 1 ? `em ${fmtDay(x.a)}` : `de ${fmtDay(x.a)} a ${fmtDay(x.b - 1)}`}`, ids: x.js.map(j => j.id) })}
              title={`${fmtDay(x.a)}${step > 1 ? ` a ${fmtDay(x.b - 1)}` : ""}: ${x.js.length} entregues · ${ok} no prazo · ${late} fora`}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-md hover:bg-[hsl(var(--accent)/0.5)] disabled:hover:bg-transparent">
              {x.js.length > 0 && <span className="mb-0.5 text-center text-[10.5px] font-semibold tabular-nums opacity-0 group-hover:opacity-100">{x.js.length}</span>}
              <span className="mx-auto flex w-[70%] max-w-9 flex-col-reverse overflow-hidden rounded-t" style={{ height: h(x.js.length) }}>
                <i className="block bg-[hsl(var(--foreground)/0.6)]" style={{ height: `${x.js.length ? (ok / x.js.length) * 100 : 0}%` }} />
                <i className="block bg-rose-500/80" style={{ height: `${x.js.length ? (late / x.js.length) * 100 : 0}%` }} />
                <i className="block bg-[hsl(var(--foreground)/0.18)]" style={{ height: `${x.js.length ? (none / x.js.length) * 100 : 0}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 pt-1.5">
        {buckets.map((x, i) => <span key={x.a} className={cn("min-w-0 flex-1 truncate text-center text-[10.5px]", muted, buckets.length > 16 && i % 2 && "invisible")}>{lbl(x)}</span>)}
      </div>
    </Widget>
  );
}

/* ── onde o tempo vai: tempo médio em cada fase ── */
function TimeInStage({ jobs, onDrill }: { jobs: RJob[]; onDrill: (f: Focus) => void }) {
  const rows = STAGES.map(s => ({ s, avg: jobs.length ? jobs.reduce((a, j) => a + j.stage[s.k], 0) / jobs.length : 0 }));
  const total = rows.reduce((a, r) => a + r.avg, 0);
  return (
    <Widget icon={Hourglass} title="Onde o tempo vai" sub="Média por job entregue, em horas de expediente">
      {!jobs.length ? <Empty /> : <>
        <div className="mb-1 flex items-baseline justify-between">
          <span className={cn("text-xs", muted)}>Ciclo médio</span>
          <b className="text-[22px] font-semibold tabular-nums">{fmtH(total)}</b>
        </div>
        <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
          {rows.map(r => r.avg > 0 && <i key={r.s.k} className={cn("block h-full border-r border-[hsl(var(--card))] last:border-r-0", r.s.tone)} style={{ width: `${(r.avg / total) * 100}%` }} title={`${r.s.label}: ${fmtH(r.avg)}`} />)}
        </div>
        <ul className="flex flex-col">
          {rows.map(r => {
            const ids = jobs.filter(j => biggest(j) === r.s.k && j.stage[r.s.k] > 0).map(j => j.id);
            return (
              <li key={r.s.k}>
                <button type="button" disabled={!ids.length} onClick={() => onDrill({ label: `Jobs em que “${r.s.label}” foi a fase mais longa`, ids })}
                  className="flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.6)] disabled:hover:bg-transparent">
                  <i className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", r.s.tone)} />
                  <span className="flex-1">{r.s.label}</span>
                  <b className="font-semibold tabular-nums">{fmtH(r.avg)}</b>
                  <span className={cn("w-10 text-right text-xs tabular-nums", muted)}>{total ? Math.round((r.avg / total) * 100) : 0}%</span>
                  <span className={cn("w-12 text-right text-[11px]", muted)} title="jobs em que essa foi a fase mais longa">{ids.length} jobs</span>
                </button>
              </li>
            );
          })}
        </ul>
      </>}
    </Widget>
  );
}

/* ── gráfico de controle: tempo até a 1ª versão de cada job ── */
function ControlChart({ jobs, A, B, name, onOpen }: { jobs: RJob[]; A: number; B: number; name: (id: number | null) => string; onOpen: (id: number) => void }) {
  const pts = jobs.filter(j => j.leadFirst != null);
  const ys = pts.map(j => j.leadFirst!);
  const med = median(ys), p85 = pctl(ys, 0.85);
  const top = Math.max(60, (pctl(ys, 0.95) ?? 60) * 1.15);
  const W = 1000, H = 240, L = 44, R = 12, T = 12, Bm = 26;
  const x = (t: number) => L + ((t - A) / (B - A)) * (W - L - R);
  const y = (m: number) => T + (1 - Math.min(m, top) / top) * (H - T - Bm);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => top * f);
  const days = Math.round((B - A) / DAY), stepD = days <= 14 ? 1 : days <= 60 ? 7 : 30;
  const xt: number[] = []; for (let d = A / DAY; d < B / DAY; d += stepD) xt.push(d);
  return (
    <Widget icon={Timer} title="Tempo até a 1ª versão" sub="Cada ponto é um job: quanto expediente levou da criação ao envio para o cliente"
      right={<span className={cn("flex items-center gap-3 text-[11px]", muted)}>
        <span className="inline-flex items-center gap-1.5"><i className="h-px w-4 border-t-2 border-dashed border-[hsl(var(--foreground)/0.6)]" />mediana {med != null ? fmtH(med) : "—"}</span>
        <span className="hidden items-center gap-1.5 sm:inline-flex"><i className="h-px w-4 border-t-2 border-dotted border-amber-500" />85% até {p85 != null ? fmtH(p85) : "—"}</span>
        <span className="hidden items-center gap-1.5 sm:inline-flex"><i className="h-2 w-2 rounded-full bg-rose-500" />fora do prazo</span>
      </span>}>
      {!pts.length ? <Empty /> : (
        <div className="-mx-1 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[560px]" role="img" aria-label="Gráfico de controle do tempo até a primeira versão">
            {ticks.map(v => <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-[hsl(var(--border))]" strokeDasharray={v ? "3 4" : undefined} />
              <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="central" className="fill-[hsl(var(--muted-foreground))] text-[11px]">{fmtH(v)}</text>
            </g>)}
            {xt.map(d => <text key={d} x={x(d * DAY)} y={H - 8} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] text-[11px]">{fmtDay(d).slice(4)}</text>)}
            {p85 != null && <line x1={L} x2={W - R} y1={y(p85)} y2={y(p85)} className="stroke-amber-500" strokeWidth={1.5} strokeDasharray="1 4" strokeLinecap="round" />}
            {med != null && <line x1={L} x2={W - R} y1={y(med)} y2={y(med)} className="stroke-[hsl(var(--foreground)/0.6)]" strokeWidth={1.5} strokeDasharray="6 5" />}
            {pts.map(j => {
              const late = onTime(j) === false, over = j.leadFirst! > top;
              return (
                <g key={j.id} className="cursor-pointer" onClick={() => onOpen(j.id)}>
                  <title>{`${j.code} · ${j.title}\n${fmtH(j.leadFirst!)} até a 1ª versão · ${name(j.editorId)}${late ? " · fora do prazo" : ""}`}</title>
                  <circle cx={x(j.firstReview!)} cy={y(j.leadFirst!)} r={over ? 6 : 5}
                    className={cn("transition-[r] hover:[r:8]", late ? "fill-rose-500/85 stroke-rose-500" : "fill-[hsl(var(--foreground)/0.35)] stroke-[hsl(var(--foreground)/0.7)]")} strokeWidth={1.5} />
                  {over && <text x={x(j.firstReview!)} y={y(j.leadFirst!) - 10} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] text-[10px]">↑{fmtH(j.leadFirst!)}</text>}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </Widget>
  );
}

/* ── tabelas por pessoa / cliente ── */
type Col<T> = { k: string; label: string; v: (r: T) => number | null; fmt?: (n: number | null, r: T) => React.ReactNode; bad?: (r: T) => boolean };
function RankTable<T extends { key: string; js: RJob[] }>({ rows, cols, head, label, onDrill, empty }: {
  rows: T[]; cols: Col<T>[]; head: (r: T) => React.ReactNode; label: (r: T) => string; onDrill: (f: Focus) => void; empty?: string;
}) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: cols[0].k, dir: -1 });
  const col = cols.find(c => c.k === sort.k) ?? cols[0];
  const sorted = [...rows].sort((a, b) => ((col.v(a) ?? -Infinity) - (col.v(b) ?? -Infinity)) * sort.dir);
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className={cn("w-full text-[13px]", cols.length > 4 && "min-w-[520px]")}>
        <thead><tr className={cn("border-b bg-[hsl(var(--muted)/0.35)] text-[11px] uppercase tracking-wider", muted)}>
          <th className="px-4 py-2 text-left font-semibold">&nbsp;</th>
          {cols.map(c => (
            <th key={c.k} className="px-3 py-2 text-right font-semibold">
              <button type="button" onClick={() => setSort(s => ({ k: c.k, dir: s.k === c.k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("inline-flex items-center gap-0.5 uppercase hover:text-[hsl(var(--foreground))]", sort.k === c.k && "text-[hsl(var(--foreground))]")}>
                {c.label}{sort.k === c.k && <ChevronDown className={cn("h-3 w-3", sort.dir === 1 && "rotate-180")} />}
              </button>
            </th>
          ))}
        </tr></thead>
        <tbody>{sorted.map(r => (
          <tr key={r.key} onClick={() => onDrill({ label: label(r), ids: r.js.map(j => j.id) })} className="cursor-pointer border-b last:border-b-0 hover:bg-[hsl(var(--accent)/0.5)]">
            <td className="max-w-[220px] px-4 py-2.5">{head(r)}</td>
            {cols.map(c => <td key={c.k} className={cn("px-3 py-2.5 text-right tabular-nums", c.bad?.(r) && "font-semibold text-rose-500")}>{c.fmt ? c.fmt(c.v(r), r) : c.v(r) ?? "—"}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
const pctFmt = (n: number | null) => (n == null ? "—" : `${n}%`);
const OnTimeBar = ({ n }: { n: number | null }) => n == null ? <span className={muted}>—</span> : (
  <span className="inline-flex items-center justify-end gap-2">
    <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-[hsl(var(--muted))] sm:block"><i className={cn("block h-full", n < 65 ? "bg-rose-500" : "bg-[hsl(var(--foreground)/0.55)]")} style={{ width: `${n}%` }} /></span>
    <span className="w-9">{n}%</span>
  </span>
);

function ByEditor({ jobs, people, onDrill }: { jobs: RJob[]; people: RPerson[]; onDrill: (f: Focus) => void }) {
  const rows = groupBy(jobs.filter(j => j.editorId), j => String(j.editorId)).map(([k, js]) => ({ key: k, js, p: people.find(p => p.id === Number(k)), m: metrics(js), blocks: js.reduce((a, j) => a + j.blocks, 0) }));
  return (
    <Widget icon={Users} title="Editores" sub="Entregas do período por editor · clique para ver os jobs">
      <RankTable rows={rows} onDrill={onDrill} label={r => `Jobs de ${r.p?.name ?? "—"}`}
        head={r => <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={r.p?.name ?? "?"} avatarUrl={r.p?.avatarUrl ?? null} size={24} /><span className="min-w-0"><b className="block truncate font-semibold">{r.p?.name ?? "—"}</b><span className={cn("block truncate text-[11px]", muted)}>{roleName(r.p)}{r.p?.status === "inactive" ? " · inativo" : ""}</span></span></span>}
        cols={[
          { k: "n", label: "Entregues", v: r => r.m.n },
          { k: "h", label: "Horas", v: r => r.m.hours, fmt: n => fmtH(n) },
          { k: "ot", label: "No prazo", v: r => r.m.onTime, fmt: n => <OnTimeBar n={n} /> },
          { k: "lead", label: "Até 1ª versão", v: r => r.m.lead, fmt: n => (n == null ? "—" : fmtH(n)) },
          { k: "est", label: "Estimativa", v: r => r.m.est, fmt: pctFmt, bad: r => r.m.est != null && r.m.est > 130 },
          { k: "b", label: "Travou", v: r => r.blocks },
        ]} />
    </Widget>
  );
}

function ByClient({ jobs, onDrill }: { jobs: RJob[]; onDrill: (f: Focus) => void }) {
  const rows = groupBy(jobs, j => j.client ?? "Sem cliente").map(([k, js]) => {
    const appr = js.filter(j => j.leadClose != null && j.leadFirst != null).map(j => j.leadClose! - j.leadFirst!);
    return { key: k, js, m: metrics(js), appr: median(appr), reneg: js.reduce((a, j) => a + j.reneg, 0) };
  });
  return (
    <Widget icon={Briefcase} title="Clientes" sub="Quem mais demanda, quem mais pede alteração e quem demora para aprovar">
      <RankTable rows={rows} onDrill={onDrill} label={r => `Jobs de ${r.key}`}
        head={r => <span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: clientColor(r.key) }} /><b className="truncate font-semibold">{r.key}</b></span>}
        cols={[
          { k: "n", label: "Entregues", v: r => r.m.n },
          { k: "ot", label: "No prazo", v: r => r.m.onTime, fmt: n => <OnTimeBar n={n} /> },
          { k: "rev", label: "Alter./job", v: r => r.m.revisions, fmt: n => (n == null ? "—" : n.toFixed(1).replace(".", ",")), bad: r => (r.m.revisions ?? 0) >= 2 },
          { k: "ap", label: "Aprovação", v: r => r.appr, fmt: n => (n == null ? "—" : fmtH(n)) },
          { k: "rn", label: "Empurrou", v: r => r.reneg },
        ]} />
    </Widget>
  );
}

/* ── equipe: tempo de resposta ── */
const medW = (xs: Wait[]) => median(xs.map(x => x.wait));
const fmtW = (n: number | null) => (n == null ? "—" : fmtH(n));
/** Barra horizontal de tempo de resposta (mediana) por pessoa; o maior define a escala. */
function ResponseBars({ rows, onPick }: { rows: { key: string; label: React.ReactNode; m: number | null; n: number; open: number }[]; onPick?: (key: string) => void }) {
  const max = Math.max(60, ...rows.map(r => r.m ?? 0));
  const list = rows.filter(r => r.n > 0).sort((a, b) => (a.m ?? 0) - (b.m ?? 0));
  if (!list.length) return <p className={cn("text-[13.5px]", muted)}>Nada dependeu de resposta no período.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {list.map(r => (
        <li key={r.key}>
          <button type="button" onClick={() => onPick?.(r.key)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_minmax(150px,auto)] rounded-lg px-1.5 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.6)]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="col-span-2 h-5 overflow-hidden rounded bg-[hsl(var(--muted)/0.6)] max-sm:order-last sm:col-span-1"><i className={cn("block h-full rounded", (r.m ?? 0) > 480 ? "bg-rose-500/75" : "bg-[hsl(var(--foreground)/0.5)]")} style={{ width: `${((r.m ?? 0) / max) * 100}%` }} /></span>
            <span className="text-right tabular-nums"><b className="font-semibold">{fmtW(r.m)}</b><span className={cn("text-xs", muted)}> · {r.n} {r.n === 1 ? "item" : "itens"}{r.open ? `, ${r.open} aberto${r.open > 1 ? "s" : ""}` : ""}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Gestores (ou "Meu desempenho" para o gestor): resultado dos jobs e tempo para responder ao que depende dele. */
function Managers({ jobs, team, people, isSup, me, onDrill, onOpen }: { jobs: RJob[]; team: RTeam; people: RPerson[]; isSup: boolean; me: number; onDrill: (f: Focus) => void; onOpen: (id: number) => void }) {
  const ids = [...new Set([...jobs.map(j => j.coordId), ...team.blocks.map(b => b.coordId), ...team.disputes.map(b => b.coordId), ...team.requests.map(r => r.approverId)].filter((x): x is number => !!x))]
    .filter(id => isSup || id === me)
    // gestores; supervisão/admin só entram aqui se forem responsáveis por jobs (as decisões deles estão em "Supervisão")
    .filter(id => { const p = people.find(x => x.id === id); return p && (p.role === "coordinator" || (p.role !== "editor" && jobs.some(j => j.coordId === id))); });
  const rows = ids.map(id => {
    const p = people.find(x => x.id === id)!, js = jobs.filter(j => j.coordId === id);
    const bl = team.blocks.filter(b => b.coordId === id), dp = team.disputes.filter(b => b.coordId === id), rq = team.requests.filter(r => r.approverId === id);
    const all = [...bl, ...dp, ...rq];
    return {
      key: String(id), p, js, m: metrics(js), bl, dp, rq, all,
      resp: medW(all), open: all.filter(x => x.open).length,
      escal: rq.filter(r => r.escalated).length,
      client: median(js.filter(j => j.stage.cliente > 0).map(j => j.stage.cliente)),
      reneg: js.reduce((a, j) => a + j.reneg, 0), furou: js.reduce((a, j) => a + j.furou, 0),
    };
  });
  const answered = rows.filter(r => r.all.length);
  const fast = [...answered].sort((a, b) => (a.resp ?? 0) - (b.resp ?? 0))[0], slow = [...answered].sort((a, b) => (b.resp ?? 0) - (a.resp ?? 0))[0];
  const one = rows.length === 1 ? rows[0] : null;
  return <>
    <Lede>
      {!rows.length ? <p className={muted}>Nenhum job ou pedido de gestor no período.</p> : one ? (
        <p>{one.key === String(me) ? "Você teve" : <><b>{one.p.name}</b> teve</>} <b>{one.m.n}</b> {one.m.n === 1 ? "job entregue" : "jobs entregues"}{one.m.onTime != null && <>, <b>{one.m.onTime}%</b> no prazo</>}. {one.all.length ? <>Coisas que dependiam de resposta ({one.bl.length} travados, {one.dp.length} estimativas contestadas, {one.rq.length} pedidos) esperaram em mediana <b>{fmtW(one.resp)}</b> de expediente{one.open ? <>; <b>{one.open}</b> ainda {one.open === 1 ? "espera" : "esperam"}</> : ""}.</> : "Nada dependeu de resposta no período."}</p>
      ) : <>
        <p><b>{rows.length}</b> gestores com jobs ou decisões no período. {answered.length > 1 && fast && slow && fast.key !== slow.key && <>Quem responde mais rápido ao que depende dele é <b>{fast.p.name.split(" ")[0]}</b> ({fmtW(fast.resp)}); quem mais demora, <b>{slow.p.name.split(" ")[0]}</b> ({fmtW(slow.resp)}).</>}</p>
        <p className={muted}>Tempo de resposta = quanto expediente passou entre o editor travar, contestar a estimativa ou alguém pedir prioridade, e o gestor resolver.</p>
      </>}
    </Lede>
    {rows.length > 0 && <>
      <Widget title="Tempo de resposta" sub="Mediana, em horas de expediente · acima de 1 dia fica em vermelho">
        <ResponseBars rows={rows.map(r => ({ key: r.key, label: <span className="inline-flex items-center gap-2"><AvatarDisplay name={r.p.name} avatarUrl={r.p.avatarUrl} size={20} />{r.p.name.split(" ")[0]}</span>, m: r.resp, n: r.all.length, open: r.open }))}
          onPick={k => { const r = rows.find(x => x.key === k)!; onDrill({ label: `Jobs com algo esperando ${r.p.name.split(" ")[0]}`, ids: [...new Set(r.all.map(x => x.taskId).filter((x): x is number => x != null))] }); }} />
      </Widget>
      <Widget title="Resultado dos jobs" sub="Jobs de cada gestor entregues no período · clique para ver">
        <RankTable rows={rows} onDrill={onDrill} label={r => `Jobs de ${r.p.name} (responsável)`}
          head={r => <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={r.p.name} avatarUrl={r.p.avatarUrl} size={24} /><span className="min-w-0"><b className="block truncate font-semibold">{r.p.name}</b><span className={cn("block truncate text-[11px]", muted)}>{roleName(r.p)}</span></span></span>}
          cols={[
            { k: "n", label: "Entregues", v: r => r.m.n },
            { k: "ot", label: "No prazo", v: r => r.m.onTime, fmt: n => <OnTimeBar n={n} /> },
            { k: "rev", label: "Alter./job", v: r => r.m.revisions, fmt: n => (n == null ? "—" : n.toFixed(1).replace(".", ",")) },
            { k: "cl", label: "Com o cliente", v: r => r.client, fmt: fmtW },
            { k: "rn", label: "Empurrou", v: r => r.reneg },
            { k: "f", label: "Furou", v: r => r.furou },
          ]} />
      </Widget>
      <Widget title="O que dependeu de cada um" sub="Quantas vezes e quanto esperou, por tipo">
        <RankTable rows={rows} onDrill={onDrill} label={r => `Jobs com algo esperando ${r.p.name.split(" ")[0]}`}
          head={r => <b className="font-semibold">{r.p.name.split(" ")[0]}</b>}
          cols={[
            { k: "b", label: "Travados", v: r => r.bl.length, fmt: (n, r) => <>{n}<span className={cn("text-xs", muted)}> · {fmtW(medW(r.bl))}</span></> },
            { k: "d", label: "Contestações", v: r => r.dp.length, fmt: (n, r) => <>{n}<span className={cn("text-xs", muted)}> · {fmtW(medW(r.dp))}</span></> },
            { k: "q", label: "Pedidos", v: r => r.rq.length, fmt: (n, r) => <>{n}<span className={cn("text-xs", muted)}> · {fmtW(medW(r.rq))}</span></> },
            { k: "e", label: "Foi à supervisão", v: r => r.escal, bad: r => r.escal > 0 },
            { k: "o", label: "Aberto agora", v: r => r.open, bad: r => r.open > 0 },
          ]} />
      </Widget>
    </>}
    {!isSup && rows.length > 0 && <OpenItems onOpen={onOpen} title="Esperando você agora" jobTitle={id => jobs.find(j => j.id === id)?.title ?? "Job"}
      items={rows.flatMap(r => [...r.bl.map(x => ({ ...x, what: "Travado" })), ...r.dp.map(x => ({ ...x, what: "Estimativa contestada" })), ...r.rq.map(x => ({ ...x, what: "Pedido de prioridade" }))]).filter(x => x.open)} />}
  </>;
}

/** Itens abertos (esperando resposta), do que espera há mais tempo para o mais recente. */
function OpenItems({ items, onOpen, title, jobTitle }: { items: (Wait & { what: string })[]; onOpen: (id: number) => void; title: string; jobTitle: (id: number) => string }) {
  const list = items.filter(x => x.taskId != null).sort((a, b) => b.wait - a.wait);
  return (
    <Widget title={title} sub={list.length ? "Do que espera há mais tempo para o mais recente · clique para abrir o job" : undefined}>
      {!list.length ? <p className={cn("text-[13.5px]", muted)}>Nada esperando.</p> : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {list.slice(0, 12).map((x, i) => (
            <li key={i}>
              <button type="button" onClick={() => onOpen(x.taskId!)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.5)]">
                <span className="min-w-0"><b className="block truncate font-medium">{jobTitle(x.taskId!)}</b><span className={cn("block text-[12px]", muted)}>{x.what}</span></span>
                <span className={cn("tabular-nums", x.wait > 480 ? "font-semibold text-rose-500" : muted)}>há {fmtH(x.wait)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

/** Supervisão: o que chegou até ela, quanto esperou e o que espera agora. */
function Supervision({ team, teamAll, people, jobs, onDrill, onOpen }: { team: RTeam; teamAll: RTeam; people: RPerson[]; jobs: RJob[]; onDrill: (f: Focus) => void; onOpen: (id: number) => void }) {
  const sups = people.filter(p => (p.role === "admin" || p.role === "supervisor"));
  // chegou à supervisão: pedidos escalados ou sem aprovador (troca de editor), jobs sem editor
  const reqs = team.requests.filter(r => r.escalated || r.approverId == null);
  const rows = sups.map(p => {
    const dec = team.requests.filter(r => r.decidedById === p.id && (r.escalated || r.approverId == null));
    const ne = team.noEditor.filter(x => x.resolvedBy === p.id), bl = team.blocks.filter(x => x.resolvedBy === p.id && x.coordId !== p.id);
    const acts = team.actions.filter(a => a.actorId === p.id);
    const all = [...dec, ...ne];
    return { key: String(p.id), p, dec, ne, bl, acts, all, js: jobs.filter(j => all.some(x => x.taskId === j.id) || bl.some(x => x.taskId === j.id)), resp: medW(all) };
  }).filter(r => r.acts.length || r.all.length || r.bl.length);
  const title = (id: number | null) => jobs.find(j => j.id === id)?.title ?? `job #${id}`;
  const openNow = [
    ...teamAll.requests.filter(r => r.open && (r.escalated || r.approverId == null)).map(r => ({ ...r, what: r.kind === "reassign" ? "Troca de editor para aprovar" : "Pedido sem resposta do gestor" })),
    ...teamAll.noEditor.filter(x => x.open).map(x => ({ ...x, what: "Job sem editor" })),
    ...teamAll.blocks.filter(x => x.open && x.wait > 240).map(x => ({ ...x, what: "Travado há mais de 4h" })),
  ].sort((a, b) => b.wait - a.wait);
  const mReq = medW(reqs), mNe = medW(team.noEditor);
  return <>
    <Lede>
      <p>No período, chegaram à supervisão <b>{reqs.length}</b> {reqs.length === 1 ? "pedido" : "pedidos"} (escalados ou de troca de editor){mReq != null && <>, decididos em mediana em <b>{fmtH(mReq)}</b></>}, e <b>{team.noEditor.length}</b> {team.noEditor.length === 1 ? "job sem editor" : "jobs sem editor"}{mNe != null && <>, que esperaram em mediana <b>{fmtH(mNe)}</b> até alguém atribuir</>}. {openNow.length ? <>Agora há <b>{openNow.length}</b> {openNow.length === 1 ? "item esperando" : "itens esperando"} a supervisão.</> : "Nada esperando a supervisão agora."}</p>
    </Lede>
    <Widget title="Esperando a supervisão agora" sub={openNow.length ? "Do mais antigo para o mais recente · clique para abrir o job" : undefined}>
      {!openNow.length ? <p className={cn("text-[13.5px]", muted)}>Nada esperando.</p> : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {openNow.slice(0, 12).map((x, i) => (
            <li key={i}>
              <button type="button" onClick={() => x.taskId && onOpen(x.taskId)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-[hsl(var(--accent)/0.5)]">
                <span className="min-w-0"><b className="block truncate font-medium">{title(x.taskId)}</b><span className={cn("block text-[12px]", muted)}>{x.what}</span></span>
                <span className={cn("tabular-nums", x.wait > 480 ? "font-semibold text-rose-500" : muted)}>há {fmtH(x.wait)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
    {rows.length > 0 && <>
      <Widget title="Tempo de decisão" sub="Mediana entre chegar à supervisão e alguém decidir · acima de 1 dia fica em vermelho">
        <ResponseBars rows={rows.map(r => ({ key: r.key, label: <span className="inline-flex items-center gap-2"><AvatarDisplay name={r.p.name} avatarUrl={r.p.avatarUrl} size={20} />{r.p.name.split(" ")[0]}</span>, m: r.resp, n: r.all.length, open: 0 }))}
          onPick={k => { const r = rows.find(x => x.key === k)!; onDrill({ label: `Decididos por ${r.p.name.split(" ")[0]}`, ids: r.js.map(j => j.id) }); }} />
      </Widget>
      <Widget title="Quem fez o quê" sub="Decisões e ações de cada pessoa da supervisão no período">
        <RankTable rows={rows} onDrill={onDrill} label={r => `Jobs em que ${r.p.name.split(" ")[0]} decidiu`}
          head={r => <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={r.p.name} avatarUrl={r.p.avatarUrl} size={24} /><span className="min-w-0"><b className="block truncate font-semibold">{r.p.name}</b><span className={cn("block truncate text-[11px]", muted)}>{roleName(r.p)}</span></span></span>}
          cols={[
            { k: "d", label: "Pedidos", v: r => r.dec.length },
            { k: "a", label: "Aprovou", v: r => r.dec.filter(x => (x as RReq).status === "aprovado").length },
            { k: "n", label: "Sem editor", v: r => r.ne.length },
            { k: "b", label: "Destravou", v: r => r.bl.length },
            { k: "t", label: "Ações", v: r => r.acts.length },
            { k: "r", label: "Resposta", v: r => r.resp, fmt: fmtW },
          ]} />
      </Widget>
    </>}
  </>;
}

/** Equipe toda: uma linha por pessoa, com o que ela entregou, o que decidiu e quanto esperaram por ela. */
function Everyone({ jobs, team, people, onDrill }: { jobs: RJob[]; team: RTeam; people: RPerson[]; onDrill: (f: Focus) => void }) {
  const ORDER: Record<string, number> = { admin: 0, supervisor: 1, coordinator: 2, editor: 3 };
  const ids = new Set<number>([...jobs.map(j => j.editorId), ...jobs.map(j => j.coordId), ...team.actions.map(a => a.actorId)].filter((x): x is number => !!x));
  const rows = [...ids].map(id => people.find(p => p.id === id)).filter((p): p is RPerson => !!p).map(p => {
    const asEd = jobs.filter(j => j.editorId === p.id), asOwner = jobs.filter(j => j.coordId === p.id);
    const owed: Wait[] = p.role === "editor" ? [] : p.role === "coordinator"
      ? [...team.blocks.filter(b => b.coordId === p.id), ...team.disputes.filter(b => b.coordId === p.id), ...team.requests.filter(r => r.approverId === p.id)]
      : [...team.requests.filter(r => r.decidedById === p.id && (r.escalated || r.approverId == null)), ...team.noEditor.filter(x => x.resolvedBy === p.id)];
    const mine = p.role === "editor" ? asEd : asOwner;
    return { key: String(p.id), p, js: [...new Set([...asEd, ...asOwner])], ed: asEd.length, own: asOwner.length, onTime: metrics(mine).onTime, hours: asEd.reduce((a, j) => a + j.worked, 0),
      acts: team.actions.filter(a => a.actorId === p.id).length, resp: medW(owed), open: owed.filter(x => x.open).length };
  }).sort((a, b) => (ORDER[a.p.role] ?? 9) - (ORDER[b.p.role] ?? 9) || b.js.length - a.js.length);
  const roles = [...new Set(rows.map(r => r.p.role))];
  return <>
    <Lede>
      <p><b>{rows.length}</b> pessoas participaram do período: {roles.map(r => `${rows.filter(x => x.p.role === r).length} ${({ admin: "admin", supervisor: "da supervisão", coordinator: "gestores", editor: "editores" } as Record<string, string>)[r] ?? r}`).join(", ")}. Editores contam pelo que entregaram; gestores e supervisão, pelo resultado dos jobs e pelo tempo que as coisas esperaram por eles.</p>
    </Lede>
    <Widget title="Todas as pessoas" sub="Clique numa linha para ver os jobs dela">
      <RankTable rows={rows} onDrill={onDrill} label={r => `Jobs de ${r.p.name}`}
        head={r => <span className="flex min-w-0 items-center gap-2"><AvatarDisplay name={r.p.name} avatarUrl={r.p.avatarUrl} size={24} /><span className="min-w-0"><b className="block truncate font-semibold">{r.p.name}</b><span className={cn("block truncate text-[11px]", muted)}>{roleName(r.p)}{r.p.status === "inactive" ? " · inativo" : ""}</span></span></span>}
        cols={[
          { k: "ed", label: "Editou", v: r => r.ed || null, fmt: n => n ?? "—" },
          { k: "own", label: "Responsável", v: r => r.own || null, fmt: n => n ?? "—" },
          { k: "ot", label: "No prazo", v: r => r.onTime, fmt: n => <OnTimeBar n={n} /> },
          { k: "h", label: "Horas", v: r => r.hours || null, fmt: n => (n ? fmtH(n) : "—") },
          { k: "a", label: "Ações", v: r => r.acts || null, fmt: n => n ?? "—" },
          { k: "r", label: "Resposta", v: r => r.resp, fmt: fmtW, bad: r => (r.resp ?? 0) > 480 },
          { k: "o", label: "Esperando", v: r => r.open || null, fmt: n => n ?? "—", bad: r => r.open > 0 },
        ]} />
    </Widget>
  </>;
}

/* ── riscos e retrabalho ── */
function Risks({ jobs, onDrill }: { jobs: RJob[]; onDrill: (f: Focus) => void }) {
  const items = [
    { k: "rev", label: "Alterações do cliente", sub: "rodadas extras de edição", f: (j: RJob) => j.revisions },
    { k: "rn", label: "Prazo empurrado", sub: "renegociado com o cliente", f: (j: RJob) => j.reneg },
    { k: "b", label: "Travamentos", sub: "job parado esperando algo", f: (j: RJob) => j.blocks },
    { k: "ex", label: "Estimativa estourou", sub: "horas acabaram antes da entrega", f: (j: RJob) => j.estExpired },
    { k: "ct", label: "Estimativa contestada", sub: "editor discordou das horas", f: (j: RJob) => j.estContest },
    { k: "ra", label: "Troca de editor", sub: "passou para outra fila", f: (j: RJob) => j.reassign },
    { k: "fu", label: "Furou a fila", sub: "entrou na frente de outro gestor", f: (j: RJob) => j.furou },
  ].map(x => ({ ...x, n: jobs.reduce((a, j) => a + x.f(j), 0), js: jobs.filter(j => x.f(j) > 0) }));
  const max = Math.max(1, ...items.map(x => x.n));
  const affected = new Set(items.flatMap(x => x.js.map(j => j.id))).size;
  return (
    <Widget icon={AlertTriangle} title="Riscos e retrabalho" sub={jobs.length ? `${affected} de ${jobs.length} jobs tiveram algum desses eventos` : "Eventos que atrasam ou encarecem a entrega"}>
      {!jobs.length ? <Empty /> : (
        <ul className="flex flex-col">
          {items.map(x => (
            <li key={x.k}>
              <button type="button" disabled={!x.js.length} onClick={() => onDrill({ label: x.label, ids: x.js.map(j => j.id) })}
                className="grid w-full grid-cols-[minmax(0,1fr)_88px_28px] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-[hsl(var(--accent)/0.6)] disabled:opacity-55 disabled:hover:bg-transparent">
                <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{x.label}</span><span className={cn("block truncate text-[11px]", muted)}>{x.sub}</span></span>
                <span className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><i className={cn("block h-full rounded-full", x.n ? "bg-[hsl(var(--foreground)/0.55)]" : "")} style={{ width: `${(x.n / max) * 100}%` }} /></span>
                <b className="text-right text-[13px] font-semibold tabular-nums">{x.n}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

/* ── tabela de jobs (destino do drill-down) ── */
type TabK = "delivered" | "created" | "open";
function JobsTable({ delivered, created, open, focus, onClear, name, onOpen, periodLabel }: {
  delivered: RJob[]; created: RJob[]; open: RJob[]; focus: Focus | null; onClear: () => void; name: (id: number | null) => string; onOpen: (id: number) => void; periodLabel: string;
}) {
  const [tab, setTab] = useState<TabK>("delivered");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "when", dir: -1 });
  const [n, setN] = useState(25);
  useEffect(() => { if (focus) setTab("delivered"); setN(25); }, [focus]);
  const base = tab === "delivered" ? delivered : tab === "created" ? created : open;
  const rows = focus ? base.filter(j => focus.ids.includes(j.id)) : base;
  const cols: { k: string; label: string; v: (j: RJob) => number | string | null; cls?: string }[] = [
    { k: "job", label: "Job", v: j => j.title },
    { k: "client", label: "Cliente", v: j => j.client ?? "" },
    { k: "ed", label: "Editor", v: j => name(j.editorId) },
    { k: "when", label: tab === "created" ? "Criado" : tab === "open" ? "Prazo" : "1ª versão", v: j => tab === "created" ? j.created : tab === "open" ? j.due : j.firstReview, cls: "text-right" },
    { k: "lead", label: "Levou", v: j => j.leadFirst, cls: "text-right" },
    { k: "h", label: "Horas", v: j => j.worked, cls: "text-right" },
    { k: "rev", label: "Alter.", v: j => j.revisions, cls: "text-right" },
    { k: "st", label: "Situação", v: j => j.status },
  ];
  const col = cols.find(c => c.k === sort.k) ?? cols[3];
  const sorted = [...rows].sort((a, b) => {
    const x = col.v(a), y = col.v(b);
    return (typeof x === "string" || typeof y === "string" ? String(x ?? "").localeCompare(String(y ?? "")) : (x ?? -Infinity) - (y ?? -Infinity)) * sort.dir;
  });
  const tabs: [TabK, string, number][] = [["delivered", "Entregues", delivered.length], ["created", "Criados", created.length], ["open", "Em aberto agora", open.length]];
  return (
    <Widget icon={FileText} title="Jobs" sub={focus ? undefined : `${periodLabel} · clique num gráfico, linha ou destaque para filtrar aqui`}
      right={<button type="button" onClick={() => exportCsv(sorted, name, focus?.label ?? periodLabel)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold hover:bg-[hsl(var(--accent))]"><Download className="h-3.5 w-3.5" />CSV</button>}>
      <div className="mb-2 flex flex-wrap items-center gap-2 border-b">
        {tabs.map(([k, l, c]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-2 py-2.5 text-[13px] font-semibold",
            tab === k ? "border-[hsl(var(--primary))]" : cn("border-transparent", muted, "hover:text-[hsl(var(--foreground))]"))}>
            {l}<span className="rounded-full bg-[hsl(var(--muted))] px-1.5 text-[11px] leading-5">{c}</span>
          </button>
        ))}
        {focus && (
          <span className="ml-auto inline-flex max-w-full items-center gap-1.5 rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] py-1 pl-3 pr-1 text-[12.5px] font-semibold text-[hsl(var(--primary))]">
            <span className="truncate">{focus.label} · {rows.length}</span>
            <button type="button" aria-label="Tirar filtro" onClick={onClear} className="rounded-full p-0.5 hover:bg-[hsl(var(--primary)/0.2)]"><X className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </div>
      {!rows.length ? <Empty text={focus ? "Nenhum job desse recorte nesta aba." : "Nenhum job."} /> : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className={cn("border-b bg-[hsl(var(--muted)/0.35)] text-[11px] uppercase tracking-wider", muted)}>
              {cols.map(c => (
                <th key={c.k} className={cn("px-3 py-2 font-semibold first:pl-4", c.cls ?? "text-left")}>
                  <button type="button" onClick={() => setSort(s => ({ k: c.k, dir: s.k === c.k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("inline-flex items-center gap-0.5 uppercase hover:text-[hsl(var(--foreground))]", sort.k === c.k && "text-[hsl(var(--foreground))]")}>
                    {c.label}{sort.k === c.k && <ChevronDown className={cn("h-3 w-3", sort.dir === 1 && "rotate-180")} />}
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>{sorted.slice(0, n).map(j => {
              const late = onTime(j) === false;
              const when = col.k === "when" ? col.v(j) : tab === "created" ? j.created : tab === "open" ? j.due : j.firstReview;
              return (
                <tr key={j.id} onClick={() => onOpen(j.id)} className="cursor-pointer border-b last:border-b-0 hover:bg-[hsl(var(--accent)/0.5)]">
                  <td className="max-w-[280px] py-2 pl-4 pr-3"><span className={cn("mr-2 font-mono text-[11.5px]", muted)}>{j.code}</span><b className="font-medium">{j.title}</b></td>
                  <td className="max-w-[160px] truncate px-3 py-2"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: clientColor(j.client) }} />{j.client ?? "—"}</span></td>
                  <td className={cn("px-3 py-2", muted)}>{name(j.editorId).split(" ")[0]}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{when == null ? "—" : fmt(when as number).slice(4)}{tab === "delivered" && late && <span className="ml-1.5 text-[11px] font-semibold text-rose-500">fora</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{j.leadFirst == null ? "—" : fmtH(j.leadFirst)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtH(j.worked)}<span className={muted}> / {fmtH(j.est)}</span></td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", j.revisions >= 2 && "font-semibold text-amber-600 dark:text-amber-400")}>{j.revisions || "—"}</td>
                  <td className={cn("px-3 py-2", muted)}>{STATUS[j.status] ?? j.status}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {sorted.length > n && <div className="border-t px-4 py-2.5"><button type="button" onClick={() => setN(x => x + 50)} className="text-xs font-semibold text-[hsl(var(--primary))] hover:underline">Mostrar mais {Math.min(50, sorted.length - n)} de {sorted.length - n}</button></div>}
        </div>
      )}
    </Widget>
  );
}

/* ── apoio ── */
function Empty({ text = "Nenhuma entrega no período." }: { text?: string }) {
  return <p className={cn("grid flex-1 place-items-center py-10 text-center text-[13px]", muted)}>{text}</p>;
}
function Skeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="h-16 w-64 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
      <div className="h-24 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-72 animate-pulse rounded-2xl bg-[hsl(var(--muted))] lg:col-span-7" />
        <div className="h-72 animate-pulse rounded-2xl bg-[hsl(var(--muted))] lg:col-span-5" />
      </div>
    </div>
  );
}

/* ── exportação ── */
const fmtDate = (lm: number | null) => (lm == null ? "" : fmt(lm).slice(4));
function exportCsv(js: RJob[], name: (id: number | null) => string, label: string) {
  const head = ["Código", "Job", "Cliente", "Editor", "Gestor", "Criado", "1ª versão", "Prazo original", "No prazo", "Até 1ª versão (h)", "Horas feitas", "Horas estimadas", "Alterações", "Prazo empurrado", "Travamentos", "Situação"];
  const h = (m: number | null) => (m == null ? "" : (m / 60).toFixed(1).replace(".", ","));
  const rows = js.map(j => [j.code, j.title, j.client ?? "", name(j.editorId), name(j.coordId), fmtDate(j.created), fmtDate(j.firstReview), fmtDate(j.dueOriginal),
    onTime(j) == null ? "" : onTime(j) ? "sim" : "não", h(j.leadFirst), h(j.worked), h(j.est), j.revisions, j.reneg, j.blocks, STATUS[j.status] ?? j.status]);
  const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = `relatorio-${label.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`; a.click();
  URL.revokeObjectURL(url);
}
function openDocument(js: RJob[], m: M, name: (id: number | null) => string, period: string, who: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = js.map(j => `<tr><td class="c">${j.code}</td><td>${esc(j.title)}</td><td>${esc(j.client ?? "—")}</td><td>${esc(name(j.editorId))}</td><td>${fmtDate(j.firstReview)}</td><td>${fmtDate(j.dueOriginal)}</td><td class="${onTime(j) === false ? "bad" : ""}">${onTime(j) == null ? "—" : onTime(j) ? "sim" : "não"}</td><td class="r">${j.leadFirst == null ? "—" : fmtH(j.leadFirst)}</td><td class="r">${fmtH(j.worked)} / ${fmtH(j.est)}</td><td class="r">${j.revisions || "—"}</td></tr>`).join("");
  const stat = (l: string, v: string) => `<div class="s"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório · ${esc(period)}</title><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font:11px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;padding:28px 32px}
    h1{font-size:20px;letter-spacing:-.2px}.sub{color:#666;margin:2px 0 16px}.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:18px}
    .s{border:1px solid #e5e5e5;border-radius:8px;padding:9px 11px}.l{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#888}.v{font-size:19px;font-weight:700}
    table{width:100%;border-collapse:collapse}th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#666;text-align:left;padding:6px;border-bottom:1px solid #ddd}
    td{padding:5px 6px;border-bottom:1px solid #f0f0f0}.c{font-family:monospace;color:#666}.r{text-align:right}.bad{color:#e11d48;font-weight:600}
    @media print{@page{size:A4 landscape;margin:1.2cm}body{padding:0}tr{page-break-inside:avoid}}</style></head><body>
    <h1>Relatório de entregas</h1><p class="sub">${esc(period)} · ${js.length} jobs entregues · gerado por ${esc(who)} em ${new Date().toLocaleDateString("pt-BR")}</p>
    <div class="g">${stat("Entregues", String(m.n))}${stat("No prazo", m.onTime == null ? "—" : m.onTime + "%")}${stat("Até a 1ª versão", m.lead == null ? "—" : fmtH(m.lead))}${stat("Horas editadas", fmtH(m.hours))}${stat("Estimativa", m.est == null ? "—" : m.est + "%")}${stat("Alterações/job", m.revisions == null ? "—" : m.revisions.toFixed(1).replace(".", ","))}</div>
    <table><thead><tr><th>#</th><th>Job</th><th>Cliente</th><th>Editor</th><th>1ª versão</th><th>Prazo</th><th>No prazo</th><th class="r">Levou</th><th class="r">Horas</th><th class="r">Alter.</th></tr></thead><tbody>${rows}</tbody></table>
    <script>setTimeout(()=>print(),300)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { toast.error("O navegador bloqueou a nova aba. Permita pop-ups para este site."); return; }
  w.document.write(html); w.document.close();
}
