import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { useSettings } from "@/contexts/SettingsContext";
import { Input } from "@/components/ui/input";
import { ListTodo, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  usePageTitle("Login");
  const { login }     = useAuth();
  const { settings }  = useSettings();
  const [loginVal, setLoginVal] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const appName = settings.company_name || settings.system_name || "JobPro";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(loginVal, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-[hsl(var(--background))]">

      {/* ── Gradient mesh background ─────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-30 dark:opacity-20"
          style={{ background: "radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-48 -right-32 w-[500px] h-[500px] rounded-full opacity-20 dark:opacity-15"
          style={{ background: "radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] opacity-10 dark:opacity-5"
          style={{ background: "radial-gradient(ellipse, hsl(var(--primary)) 0%, transparent 65%)" }}
        />
      </div>

      {/* ── Card ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-[400px]">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/90 backdrop-blur-xl shadow-2xl shadow-black/10 dark:shadow-black/40 overflow-hidden">

          {/* top accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-[hsl(var(--primary))] via-[hsl(var(--primary))]/60 to-transparent" />

          <div className="px-8 pt-8 pb-9 sm:px-10 sm:pt-10 sm:pb-11">

            {/* brand */}
            <div className="flex flex-col items-center mb-8 text-center">
              {settings.logo_url ? (
                <img src={settings.logo_url} alt={appName} className="h-14 object-contain mb-4" />
              ) : (
                <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--primary))] flex items-center justify-center mb-4 shadow-lg shadow-[hsl(var(--primary))]/30">
                  <ListTodo className="h-7 w-7 text-white" />
                </div>
              )}
              <h1 className="text-2xl font-black tracking-tight text-[hsl(var(--foreground))]">
                {appName}
              </h1>
              <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">
                Faça login para continuar
              </p>
            </div>

            {/* form */}
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* login field */}
              <div className="space-y-1.5">
                <label htmlFor="login" className="block text-[13px] font-semibold text-[hsl(var(--foreground))]">
                  Login
                </label>
                <Input
                  id="login"
                  value={loginVal}
                  onChange={e => { setLoginVal(e.target.value); setError(""); }}
                  placeholder="seu.login"
                  autoComplete="username"
                  autoFocus
                  className="h-11 bg-[hsl(var(--background))]/60 focus:bg-[hsl(var(--background))] transition-colors"
                />
              </div>

              {/* password field with show/hide toggle */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-[13px] font-semibold text-[hsl(var(--foreground))]">
                  Senha
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-11 pr-10 bg-[hsl(var(--background))]/60 focus:bg-[hsl(var(--background))] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* error */}
              {error && (
                <p className="text-[13px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/8 border border-[hsl(var(--destructive))]/15 rounded-xl px-3.5 py-2.5">
                  {error}
                </p>
              )}

              {/* submit */}
              <button
                type="submit"
                disabled={loading || !loginVal || !password}
                className="w-full h-11 mt-1 rounded-xl text-sm font-semibold text-white transition-all
                  bg-[hsl(var(--primary))] hover:opacity-90 active:scale-[.98]
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100
                  shadow-md shadow-[hsl(var(--primary))]/25 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Entrando…
                  </>
                ) : "Entrar"}
              </button>
            </form>
          </div>
        </div>

        {/* footer below card */}
        <p className="mt-5 text-center text-[11px] text-[hsl(var(--muted-foreground))]/50">
          © {new Date().getFullYear()} {appName}
        </p>
      </div>
    </div>
  );
}
