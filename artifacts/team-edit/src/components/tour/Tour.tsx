/**
 * Tour guiado dentro do app: escurece a tela, ilumina o elemento real do passo (marcado com `data-tour="…"`) e mostra
 * o painel de controle fixo embaixo, no centro (não pula de lugar): texto do passo, mapa dos passos clicável e
 * Voltar / Avançar / Pular. A página rola para o elemento ficar acima do painel. Abre sozinho na primeira visita (lembrado no navegador) e pelo botão
 * "?" do topo (evento `tour:start`). Se o elemento do passo não estiver na tela, o cartão aparece no centro.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "@/lib/icons";

export interface TourStep { target: string; title: string; text: string }
const PAD = 6;

/** abre o tour da página atual (o botão "?" do topo chama isto) */
export const startTour = () => window.dispatchEvent(new Event("tour:start"));

const seenKey = (id: string) => `tour.${id}.visto`;
const wasSeen = (id: string) => { try { return localStorage.getItem(seenKey(id)) === "1"; } catch { return true; } };
const markSeen = (id: string) => { try { localStorage.setItem(seenKey(id), "1"); } catch { /* sem armazenamento */ } };

export function Tour({ id, steps, auto = true }: { id: string; steps: TourStep[]; auto?: boolean }) {
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // primeira visita: abre sozinho (depois que a página desenhou); "?" do topo: abre de novo
  useEffect(() => {
    const open = () => setI(0);
    window.addEventListener("tour:start", open);
    const t = auto && !wasSeen(id) ? setTimeout(open, 900) : null;
    return () => { window.removeEventListener("tour:start", open); if (t) clearTimeout(t); };
  }, [id, auto]);

  const step = i != null ? steps[i] : null;
  const el = useCallback(() => (step ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null), [step]);

  // leva o elemento para a tela e mede
  useEffect(() => {
    if (!step) return;
    const e = el();
    if (e) {
      // deixa o elemento na parte de cima da tela, longe do painel fixo de baixo
      const r = e.getBoundingClientRect(), room = window.innerHeight - 230;
      if (r.top < 80 || r.bottom > room) {
        const root = e.closest("[data-scroll-root]") ?? document.querySelector("[data-scroll-root]");
        const dy = r.top - Math.max(80, (room - r.height) / 2);
        if (root) root.scrollBy({ top: dy, behavior: "smooth" }); else window.scrollBy({ top: dy, behavior: "smooth" });
      }
    }
    const t = setTimeout(() => setRect(e?.getBoundingClientRect() ?? null), 350);
    return () => clearTimeout(t);
  }, [step, el]);
  useEffect(() => {
    if (!step) return;
    const upd = () => setRect(el()?.getBoundingClientRect() ?? null);
    window.addEventListener("resize", upd); window.addEventListener("scroll", upd, true);
    return () => { window.removeEventListener("resize", upd); window.removeEventListener("scroll", upd, true); };
  }, [step, el]);

  const close = useCallback(() => { setI(null); setRect(null); markSeen(id); }, [id]);
  const go = useCallback((n: number) => { if (n >= steps.length) close(); else setI(Math.max(0, n)); }, [steps.length, close]);
  useEffect(() => {
    if (i == null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [i, go, close]);

  if (i == null || !step) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* trava a página durante o tour; sem elemento, escurece tudo */}
      <div className={cn("absolute inset-0", !rect && "bg-black/60")} />
      {rect && (
        <div className="pointer-events-none absolute rounded-xl ring-2 ring-[hsl(var(--primary))] transition-all duration-300 ease-out"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)" }} />
      )}
      {/* painel de controle fixo */}
      <div className="absolute inset-x-0 bottom-5 flex justify-center px-3">
        <div className="relative w-full max-w-[640px] rounded-2xl border bg-[hsl(var(--card))] px-5 pb-4 pt-4 shadow-2xl shadow-black/60">
          <button type="button" aria-label="Fechar o tour" onClick={close}
            className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.08)] hover:text-[hsl(var(--foreground))]">
            <X className="h-4 w-4" />
          </button>
          <p className="text-[11.5px] font-medium tabular-nums text-[hsl(var(--muted-foreground))]">Passo {i + 1} de {steps.length}</p>
          <h2 className="mt-1 pr-8 text-[16px] font-semibold leading-snug">{step.title}</h2>
          <p className="mt-1 min-h-[42px] text-[13.5px] leading-relaxed text-[hsl(var(--muted-foreground))]">{step.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* mapa dos passos: clique para ir direto */}
            <nav aria-label="Passos do tour" className="mr-auto flex items-center gap-1">
              {steps.map((s, k) => (
                <button key={k} type="button" title={`${k + 1}. ${s.title}`} aria-label={`Passo ${k + 1}: ${s.title}`} aria-current={k === i ? "step" : undefined}
                  onClick={() => go(k)} className="grid h-5 place-items-center px-0.5">
                  <i className={cn("block h-1.5 rounded-full transition-all", k === i ? "w-6 bg-[hsl(var(--primary))]" : k < i ? "w-1.5 bg-[hsl(var(--primary)/0.55)] hover:bg-[hsl(var(--primary))]" : "w-1.5 bg-[hsl(var(--foreground)/0.2)] hover:bg-[hsl(var(--foreground)/0.5)]")} />
                </button>
              ))}
            </nav>
            <button type="button" onClick={close} className="text-[12.5px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline">Pular tour</button>
            <button type="button" disabled={i === 0} onClick={() => go(i - 1)} className="h-8 rounded-lg border px-3 text-[13px] font-medium hover:bg-[hsl(var(--foreground)/0.06)] disabled:pointer-events-none disabled:opacity-35">Voltar</button>
            <button type="button" autoFocus onClick={() => go(i + 1)} className="h-8 min-w-[92px] rounded-lg bg-[hsl(var(--primary))] px-3.5 text-[13px] font-semibold text-[hsl(var(--primary-foreground))] hover:brightness-110">
              {i === steps.length - 1 ? "Concluir" : "Avançar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
