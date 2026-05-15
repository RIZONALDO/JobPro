import { useEffect, useState } from "react";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { useSettings } from "@/contexts/SettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ImagePlus, X, TriangleAlert, Settings as SettingsIcon } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const PROJECT_COLORS_PRIMARY = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#06b6d4"];

export default function SettingsPage() {
  usePageTitle("Configurações");
  const { refreshSettings } = useSettings();
  const { logout } = useAuth();
  const [form, setForm] = useState({ company_name: "", system_name: "", logo_url: "", favicon_url: "", primary_color: "#6366f1" });
  const [logoDrag, setLogoDrag] = useState(false);
  const [faviconDrag, setFaviconDrag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    apiFetch<Record<string, string>>("/api/settings").then(d => {
      setForm({
        company_name: d["company_name"] ?? "",
        system_name: d["system_name"] ?? "",
        logo_url: d["logo_url"] ?? "",
        favicon_url: d["favicon_url"] ?? "",
        primary_color: d["primary_color"] ?? "#6366f1",
      });
    });
  }, []);

  const readBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) { reject(new Error("Imagem muito grande (máx 2MB)")); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFile = async (field: "logo_url" | "favicon_url", file: File | undefined) => {
    if (!file) return;
    try {
      const b64 = await readBase64(file);
      setForm(f => ({ ...f, [field]: b64 }));
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Erro"); }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await apiPost("/api/admin/reset", {});
      toast.success("Sistema resetado com sucesso. Faça login novamente.");
      setResetOpen(false);
      await logout();
    } catch {
      toast.error("Erro ao resetar o sistema");
    } finally {
      setResetting(false);
      setResetConfirm("");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiPut("/api/settings", form);
      await refreshSettings();
      toast.success("Configurações salvas");
    } catch { toast.error("Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const ImageField = ({ field, label, hint }: { field: "logo_url" | "favicon_url"; label: string; hint: string }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <label
        onDragOver={e => { e.preventDefault(); field === "logo_url" ? setLogoDrag(true) : setFaviconDrag(true); }}
        onDragLeave={() => field === "logo_url" ? setLogoDrag(false) : setFaviconDrag(false)}
        onDrop={async e => { e.preventDefault(); field === "logo_url" ? setLogoDrag(false) : setFaviconDrag(false); await handleFile(field, e.dataTransfer.files?.[0]); }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors h-24 ${(field === "logo_url" ? logoDrag : faviconDrag) ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 hover:bg-[hsl(var(--muted))]/40"}`}
      >
        {form[field] ? (
          <img src={form[field]} alt={label} className="max-h-16 max-w-full object-contain rounded" />
        ) : (
          <>
            <ImagePlus className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Clique ou arraste uma imagem</span>
          </>
        )}
        <input type="file" accept="image/*" className="hidden" onChange={e => handleFile(field, e.target.files?.[0])} />
      </label>
      {form[field] && (
        <button type="button" className="text-xs text-[hsl(var(--destructive))] hover:underline flex items-center gap-1" onClick={() => setForm(f => ({ ...f, [field]: "" }))}>
          <X className="h-3 w-3" /> Remover
        </button>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-[hsl(var(--border))]" />
        <span className="text-xs text-[hsl(var(--muted-foreground))]">ou cole uma URL</span>
        <div className="flex-1 h-px bg-[hsl(var(--border))]" />
      </div>
      <Input value={form[field].startsWith("data:") ? "" : form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} placeholder="https://..." className="text-sm" />
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[hsl(var(--primary))]/10 flex items-center justify-center shrink-0">
          <SettingsIcon className="h-5 w-5 text-[hsl(var(--primary))]" />
        </div>
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Configurações</h1>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Identidade visual e preferências do sistema</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Identidade</CardTitle><CardDescription>Nome e visual exibidos em todo o sistema</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nome da empresa</Label>
              <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Ex: Minha Empresa" />
            </div>
            <div className="space-y-1.5">
              <Label>Nome do sistema</Label>
              <Input value={form.system_name} onChange={e => setForm(f => ({ ...f, system_name: e.target.value }))} placeholder="Ex: JobPro" />
            </div>
          </div>
          <ImageField field="logo_url" label="Logo" hint="Exibida na sidebar. Recomendado: 200×60px, fundo transparente." />
          <ImageField field="favicon_url" label="Favicon" hint="Ícone da aba do navegador. Recomendado: PNG 32×32px." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Cor principal</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {PROJECT_COLORS_PRIMARY.map(c => (
              <button key={c} type="button" onClick={() => setForm(f => ({ ...f, primary_color: c }))}
                className={`h-8 w-8 rounded-full border-2 transition-all ${form.primary_color === c ? "border-[hsl(var(--foreground))] scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="color" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
              className="h-9 w-12 rounded-md border border-[hsl(var(--input))] cursor-pointer p-0.5" />
            <Input value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} className="font-mono text-sm w-32" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Revise as informações antes de salvar.</p>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar configurações"}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Zona de Perigo */}
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-red-600 dark:text-red-400">
            <TriangleAlert className="h-4 w-4" />
            Zona de Perigo
          </CardTitle>
          <CardDescription>
            Ações irreversíveis. Não há como desfazer após a confirmação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4">
            <div>
              <p className="text-sm font-medium">Resetar sistema para o estado de fábrica</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                Remove todos os projetos, jobs, tarefas, feed, mensagens e usuários não-admin. Você será desconectado.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => { setResetConfirm(""); setResetOpen(true); }}>
              Resetar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de confirmação */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <TriangleAlert className="h-5 w-5" /> Resetar sistema?
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">Esta ação é <strong>permanente e irreversível</strong>. Serão apagados:</span>
              <ul className="list-disc list-inside text-sm space-y-0.5 text-[hsl(var(--foreground))]">
                <li>Todos os projetos, jobs e tarefas</li>
                <li>Todo o feed, comentários e reações</li>
                <li>Todas as mensagens de chat e DMs</li>
                <li>Todos os usuários (exceto o administrador)</li>
                <li>Todas as sessões ativas</li>
              </ul>
              <span className="block mt-3">Para confirmar, digite <strong>RESETAR</strong> abaixo:</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={resetConfirm}
            onChange={e => setResetConfirm(e.target.value)}
            placeholder="RESETAR"
            className="font-mono"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={resetConfirm !== "RESETAR" || resetting}
              onClick={doReset}
            >
              {resetting ? "Resetando..." : "Confirmar reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
