/**
 * Avisos rápidos (toast.success/error/… do sonner) no estilo das "flags" do Jira e dos toasts do Asana (versão escura):
 * cartões sólidos e elevados no canto inferior direito, acima do botão do chat (sem tapar o meio da página), empilhados até 3,
 * o mais novo embaixo. Ícone colorido, a 1ª frase em negrito e o resto como detalhe; ação em texto quando o toast tem
 * `action` (ex.: "Desfazer"). Cada um some sozinho (5 s; erro 8 s); mouse em cima pausa; X fecha.
 * Usa `useSonner()` para ouvir os toasts, então o resto do app continua chamando `toast.*` normalmente.
 */
import { useEffect, useRef, useState } from "react";
import { useSonner } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, X } from "@/lib/icons";

type T = ReturnType<typeof useSonner>["toasts"][number];
const ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 weight="fill" className="h-5 w-5 text-emerald-400" />,
  error: <AlertOctagon weight="fill" className="h-5 w-5 text-rose-400" />,
  warning: <AlertTriangle weight="fill" className="h-5 w-5 text-amber-400" />,
  info: <Info weight="fill" className="h-5 w-5 text-violet-400" />,
};
const MAX = 3;
const text = (v: unknown) => (typeof v === "function" ? (v as () => React.ReactNode)() : v) as React.ReactNode;
/** "Movido de 3º para 2º. Prazo: ter 14:48." → título "Movido de 3º para 2º." e detalhe "Prazo: ter 14:48." */
function split(t: T): { title: React.ReactNode; detail: React.ReactNode } {
  const title = text(t.title), desc = t.description != null ? text(t.description) : null;
  if (desc != null || typeof title !== "string") return { title, detail: desc };
  const m = title.match(/^(.+?[.!?])\s+(.+)$/s);
  return m ? { title: m[1], detail: m[2] } : { title, detail: null };
}

function Flag({ t, onClose }: { t: T; onClose: () => void }) {
  const [hold, setHold] = useState(false);
  const left = useRef(t.type === "error" ? 8000 : 5000), since = useRef(Date.now());
  useEffect(() => {
    if (hold) { left.current -= Date.now() - since.current; return; }
    since.current = Date.now();
    const id = setTimeout(onClose, Math.max(0, left.current));
    return () => clearTimeout(id);
  }, [hold]); // eslint-disable-line react-hooks/exhaustive-deps
  const { title, detail } = split(t);
  const action = t.action && typeof t.action === "object" && "label" in t.action ? t.action as { label: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void } : null;
  return (
    <motion.div layout onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }} transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border border-white/10 bg-[#22272b] py-3 pl-3.5 pr-10 text-zinc-100 shadow-[0_12px_32px_rgb(0_0_0/0.6)]">
      <span className="mt-px shrink-0">{ICON[t.type ?? ""] ?? ICON.info}</span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14px] font-semibold leading-5">{title}</b>
        {detail != null && <span className="mt-0.5 block text-[13px] leading-5 text-zinc-400">{detail}</span>}
        {action && (
          <button type="button" onClick={e => { action.onClick(e); onClose(); }} className="mt-1.5 text-[13px] font-semibold text-violet-300 hover:underline">{action.label}</button>
        )}
      </span>
      <button type="button" aria-label="Fechar" onClick={onClose}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100">
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

export function StatusLine() {
  const { toasts } = useSonner();
  const [list, setList] = useState<T[]>([]);
  // cada toast novo entra embaixo; passa de 3, o mais antigo sai
  useEffect(() => {
    const last = toasts[0];
    if (!last) return;
    setList(l => l.some(x => x.id === last.id) ? l.map(x => (x.id === last.id ? last : x)) : [...l, last].slice(-MAX));
  }, [toasts[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = (id: T["id"]) => setList(l => l.filter(x => x.id !== id));
  return (
    <div className="pointer-events-none fixed bottom-[84px] right-5 z-[60] flex w-[min(calc(100vw-48px),400px)] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.map(t => <Flag key={t.id} t={t} onClose={() => close(t.id)} />)}
      </AnimatePresence>
    </div>
  );
}
