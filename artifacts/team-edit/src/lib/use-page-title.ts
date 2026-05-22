import { useEffect } from "react";
import { useSettings } from "@/contexts/SettingsContext";

export function usePageTitle(title: string) {
  const { settings } = useSettings();
  const appName = settings.company_name || settings.system_name || "JobPro";

  useEffect(() => {
    document.title = title ? `${title} – ${appName}` : appName;
    return () => { document.title = appName; };
  }, [title, appName]);
}
