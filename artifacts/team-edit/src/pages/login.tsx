import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/lib/use-page-title";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListTodo } from "lucide-react";
import { BrandName } from "@/components/brand-name";

export default function LoginPage() {
  usePageTitle("Login");
  const { login } = useAuth();
  const { settings } = useSettings();
  const [loginVal, setLoginVal] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          {settings.logo_url ? (
            <img src={settings.logo_url} alt={settings.company_name} className="h-16 mx-auto object-contain" />
          ) : (
            <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--primary))] flex items-center justify-center mx-auto">
              <ListTodo className="h-8 w-8 text-white" />
            </div>
          )}
          <h1 className="text-2xl font-bold"><BrandName name={settings.company_name} /></h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Faça login para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login">Login</Label>
            <Input id="login" value={loginVal} onChange={e => setLoginVal(e.target.value)} placeholder="seu.login" autoComplete="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
