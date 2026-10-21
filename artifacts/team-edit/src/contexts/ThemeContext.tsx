import { createContext, useContext, useEffect, useCallback, useState, type ReactNode } from "react";

type Theme = "dark";
export type Scale = "sm" | "md" | "lg";

interface ThemeContextValue {
  theme: Theme;
  scale: Scale;
  toggleTheme: () => void;
  setScale: (s: Scale) => void;
}

const THEME_KEY = "te_theme";
const SCALE_KEY = "te_scale";
const ThemeContext = createContext<ThemeContextValue | null>(null);

/** O app é sempre escuro (decisão de produto): não há mais opção de aparência. */
function applyDark() {
  document.documentElement.classList.add("dark");
  try { localStorage.removeItem(THEME_KEY); } catch {}
}

function applyScale(s: Scale) {
  document.documentElement.classList.remove("scale-sm", "scale-lg");
  if (s !== "md") document.documentElement.classList.add(`scale-${s}`);
  try { localStorage.setItem(SCALE_KEY, s); } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme: Theme = "dark";
  const [scale, setScaleState] = useState<Scale>(
    () => (localStorage.getItem(SCALE_KEY) as Scale) ?? "md"
  );

  useEffect(() => { applyDark(); }, []);
  useEffect(() => { applyScale(scale); }, [scale]);

  // mantido para quem ainda chama; não troca mais o tema
  const toggleTheme = useCallback(() => {}, []);

  const setScale = useCallback((s: Scale) => {
    setScaleState(s);
    applyScale(s);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, scale, toggleTheme, setScale }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}
