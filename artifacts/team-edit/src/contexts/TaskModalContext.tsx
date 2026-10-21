import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";

/**
 * Abrir um job = ir para a página dele (`/jobs/:id`).
 * Guarda de onde veio (para o "← Voltar" e a posição da rolagem) e, quando a origem passa,
 * a lista em que o job estava (para ‹ › / J K irem ao anterior e ao próximo sem voltar).
 */

export interface JobNav { from: string; ids: number[]; label?: string }
interface Ctx { openTask: (taskId: number, list?: { ids: number[]; label?: string }) => void }

const KEY = "job-nav";
const SCROLL = "scroll:";
export const scrollRoot = () => document.querySelector<HTMLElement>("[data-scroll-root]");
export function readJobNav(): JobNav | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; }
}

const TaskModalContext = createContext<Ctx>({ openTask: () => {} });
export const useTaskModal = () => useContext(TaskModalContext);

export function TaskModalProvider({ children }: { children: ReactNode }) {
  const [loc, navigate] = useLocation();

  const openTask = useCallback((id: number, list?: { ids: number[]; label?: string }) => {
    const here = window.location.pathname + window.location.search;
    if (!here.startsWith("/jobs/")) {
      const nav: JobNav = { from: here, ids: list?.ids ?? [], label: list?.label };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(nav));
        sessionStorage.setItem(SCROLL + window.location.pathname, String(scrollRoot()?.scrollTop ?? 0));
      } catch { /* sem storage: só não lembra a posição */ }
    }
    navigate(`/jobs/${id}`);
  }, [navigate]);

  // voltando para a página de origem: devolve a rolagem (tenta algumas vezes, a lista carrega depois)
  const prev = useRef(loc);
  useEffect(() => {
    const was = prev.current; prev.current = loc;
    if (!was.startsWith("/jobs/") || loc.startsWith("/jobs/")) return;
    let y = 0;
    try { y = Number(sessionStorage.getItem(SCROLL + loc) ?? 0); } catch { return; }
    if (!y) return;
    const timers = [60, 250, 600, 1200].map(ms => setTimeout(() => { const el = scrollRoot(); if (el && el.scrollHeight > y) el.scrollTop = y; }, ms));
    return () => timers.forEach(clearTimeout);
  }, [loc]);

  return <TaskModalContext.Provider value={{ openTask }}>{children}</TaskModalContext.Provider>;
}
