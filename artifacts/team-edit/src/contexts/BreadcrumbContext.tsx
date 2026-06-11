import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface BreadcrumbItem {
  label: string;
  href?: string;
  mono?: boolean;
  muted?: boolean;
}

interface BreadcrumbCtx {
  items: BreadcrumbItem[];
  suffix?: ReactNode;
  backHref?: string;
  actions?: ReactNode;
  set: (items: BreadcrumbItem[], suffix?: ReactNode, backHref?: string, actions?: ReactNode) => void;
  clear: () => void;
}

const Ctx = createContext<BreadcrumbCtx>({
  items: [], suffix: undefined, backHref: undefined, actions: undefined,
  set: () => {}, clear: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems]       = useState<BreadcrumbItem[]>([]);
  const [suffix, setSuffix]     = useState<ReactNode>(undefined);
  const [backHref, setBackHref] = useState<string | undefined>(undefined);
  const [actions, setActions]   = useState<ReactNode>(undefined);

  const set = useCallback((i: BreadcrumbItem[], s?: ReactNode, back?: string, act?: ReactNode) => {
    setItems(i);
    setSuffix(s);
    setBackHref(back);
    setActions(act);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setSuffix(undefined);
    setBackHref(undefined);
    setActions(undefined);
  }, []);

  return <Ctx.Provider value={{ items, suffix, backHref, actions, set, clear }}>{children}</Ctx.Provider>;
}

export function useBreadcrumb() {
  return useContext(Ctx);
}
