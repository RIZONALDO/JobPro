import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

interface AppSettings {
  company_name: string;
  system_name: string;
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  sound_notif: string;
  sound_chat: string;
  sound_poke: string;
  agenda_access: string; // "all" = admin+coord | "admin" = só admin/supervisor
}

interface SettingsContextValue {
  settings: AppSettings;
  ready: boolean;
  refreshSettings: () => Promise<void>;
}

const DEFAULTS: AppSettings = {
  company_name: "",
  system_name: "",
  logo_url: "",
  favicon_url: "",
  primary_color: "#6366f1",
  sound_notif: "ping",
  sound_chat: "ping",
  sound_poke: "boop",
  agenda_access: "all",
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULTS,
  ready: false,
  refreshSettings: async () => {},
});

function hexToHsl(hex: string): string | null {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  const applySettings = useCallback((next: AppSettings) => {
    setSettings(next);
    const p = hexToHsl(next.primary_color);
    if (p) {
      document.documentElement.style.setProperty("--primary", p);
      document.documentElement.style.setProperty("--ring", p);
    }
    // Safari ignores href changes on existing <link> elements — must remove + re-add
    document.querySelectorAll('link[rel*="icon"]').forEach(el => el.remove());
    const v = Date.now();
    [
      { rel: "icon", type: "image/png", sizes: "32x32", id: "favicon-main" },
      { rel: "apple-touch-icon", sizes: "180x180" },
    ].forEach(attrs => {
      const l = document.createElement("link");
      Object.assign(l, attrs);
      l.href = `/api/favicon?v=${v}`;
      document.head.appendChild(l);
    });
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { credentials: "include" });
      if (!res.ok) return;
      const data: Record<string, string> = await res.json();
      const next: AppSettings = {
        company_name: data["company_name"] || "",
        system_name: data["system_name"] || "",
        logo_url: data["logo_url"] || "",
        favicon_url: data["favicon_url"] || "",
        primary_color: data["primary_color"] || DEFAULTS.primary_color,
        sound_notif:   data["sound_notif"]   || DEFAULTS.sound_notif,
        sound_chat:    data["sound_chat"]    || DEFAULTS.sound_chat,
        sound_poke:    data["sound_poke"]    || DEFAULTS.sound_poke,
        agenda_access: data["agenda_access"] || DEFAULTS.agenda_access,
      };
      applySettings(next);
    } catch { /* ignore */ } finally {
      setReady(true);
    }
  }, [applySettings]);

  useEffect(() => { void refreshSettings(); }, [refreshSettings]);

  return (
    <SettingsContext.Provider value={{ settings, ready, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() { return useContext(SettingsContext); }
