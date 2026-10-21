import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { IconContext } from "@/lib/icons";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";
import { TaskModalProvider } from "@/contexts/TaskModalContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Shell } from "@/components/layout/Shell";
import { Toaster as SonnerToaster } from "sonner";
import LoginPage from "@/pages/login";
import ChangePasswordPage from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";

import Team from "@/pages/team";
import TeamAbsences from "@/pages/team-absences";
import SettingsPage from "@/pages/settings";
import Profile from "@/pages/profile";
import Reports from "@/pages/reports";
import FeedPage from "@/pages/feed";
import JobsPage      from "@/pages/jobs";
import JobPage       from "@/pages/job";
import DutyPage      from "@/pages/duty";
import FaviconDebugPage from "@/pages/favicon-debug";
import MinhaFila from "@/pages/fila/minha-fila";
import Filas from "@/pages/fila/filas";
import Supervisao from "@/pages/fila/supervisao";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

// Observes the `dark` class on <html> so the Toaster always matches the active theme.
function ThemedSonner() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return (
    <SonnerToaster
      theme={isDark ? "dark" : "light"}
      position="top-center"
      offset={72}
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        style: { fontFamily: "inherit", fontSize: "13px", borderRadius: "10px" },
      }}
    />
  );
}

function Router() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
        <div className="text-[hsl(var(--muted-foreground))] text-sm">Carregando...</div>
      </div>
    );
  }

  if (window.location.pathname === "/debug-favicon") return <FaviconDebugPage />;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage />;

  return (
    <ThemeProvider>
    <ChatProvider>
    <TaskModalProvider>
    <Shell>
      <Switch>
        {/* ao entrar, todo mundo cai na Fila (admin, que não tem fila, em Membros) */}
        <Route path="/">{user.role === "admin" ? <Redirect to="/team" /> : <Redirect to="/fila" />}</Route>
        <Route path="/dashboard">{["supervisor", "coordinator"].includes(user.role) ? <Dashboard /> : <Redirect to="/fila" />}</Route>
        <Route path="/fila/supervisao">{["admin", "supervisor"].includes(user.role) ? <Supervisao /> : <Redirect to="/fila" />}</Route>
        <Route path="/fila">{user.role === "editor" ? <MinhaFila /> : <Filas />}</Route>
        
        <Route path="/my-tasks"><Redirect to="/fila" /></Route>
        <Route path="/calendar"><Redirect to="/tasks?group=prazo" /></Route>
        <Route path="/team/ausencias" component={TeamAbsences} />
        <Route path="/team" component={Team} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/profile" component={Profile} />
        <Route path="/timeline"><Redirect to="/fila" /></Route>
        <Route path="/pipeline"><Redirect to="/fila" /></Route>
        <Route path="/reports" component={Reports} />
        <Route path="/feed" component={FeedPage} />
        <Route path="/tasks" component={JobsPage} />
        <Route path="/jobs/:id" component={JobPage} />
        <Route path="/duty" component={DutyPage} />
        <Route path="/agenda/classica"><Redirect to="/fila" /></Route>
        <Route path="/agenda"><Redirect to="/fila" /></Route>
        <Route>
          <div className="text-center py-20">
            <h2 className="text-2xl font-bold">404</h2>
            <p className="text-[hsl(var(--muted-foreground))] mt-2">Página não encontrada</p>
          </div>
        </Route>
      </Switch>
    </Shell>
    </TaskModalProvider>
    </ChatProvider>
    </ThemeProvider>
  );
}

function SettingsGate({ children }: { children: React.ReactNode }) {
  const { ready } = useSettings();
  if (!ready) return <div className="min-h-screen bg-[hsl(var(--background))]" />;
  return <>{children}</>;
}

// Ícones (Phosphor): traço "light" no app inteiro; 24px quando a tela não define tamanho (h-4 w-4 etc. vencem).
const ICONS = { weight: "light" as const, size: 24, mirrored: false };

function App() {
  return (
    <IconContext.Provider value={ICONS}>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <SettingsGate>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <ThemedSonner />
          </AuthProvider>
        </SettingsGate>
      </SettingsProvider>
    </QueryClientProvider>
    </IconContext.Provider>
  );
}

export default App;
