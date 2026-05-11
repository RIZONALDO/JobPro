import { createContext, useContext, useEffect, useCallback, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { apiPut } from "@/lib/api";

type Theme = "light" | "dark";
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

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

function applyScale(s: Scale) {
  document.documentElement.classList.remove("scale-sm", "scale-lg");
  if (s !== "md") document.documentElement.classList.add(`scale-${s}`);
  try { localStorage.setItem(SCALE_KEY, s); } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const theme: Theme = ((user as any)?.theme as Theme) ?? (localStorage.getItem(THEME_KEY) as Theme) ?? "light";
  const [scale, setScaleState] = useState<Scale>(
    () => (localStorage.getItem(SCALE_KEY) as Scale) ?? "md"
  );

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyScale(scale); }, [scale]);

  const toggleTheme = useCallback(async () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      await apiPut("/api/auth/theme", { theme: next });
      await refresh();
    } catch {
      applyTheme(theme);
    }
  }, [theme, refresh]);

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
