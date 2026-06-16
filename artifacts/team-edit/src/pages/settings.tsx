import { useEffect, useState } from "react";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { useSettings } from "@/contexts/SettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { ImagePlus, X, TriangleAlert, Settings as SettingsIcon, FlaskConical, CheckCircle2, Volume2, Play, LayoutGrid } from "lucide-react";
import { SOUND_OPTIONS, playSound, type SoundPreset } from "@/lib/sounds";
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
  const [sounds, setSounds] = useState({ sound_notif: "ping", sound_chat: "ping", sound_poke: "boop" });
  const [logoDrag, setLogoDrag] = useState(false);
  const [faviconDrag, setFaviconDrag] = useState(false);
  const [agendaAccess, setAgendaAccess] = useState("all");
  const [coordinators, setCoordinators] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<Record<string, string>>("/api/settings").then(d => {
      setForm({
        company_name: d["company_name"] ?? "",
        system_name: d["system_name"] ?? "",
        logo_url: d["logo_url"] ?? "",
        favicon_url: d["favicon_url"] ?? "",
        primary_color: d["primary_color"] ?? "#6366f1",
      });
      setSounds({
        sound_notif: d["sound_notif"] ?? "ping",
        sound_chat:  d["sound_chat"]  ?? "ping",
        sound_poke:  d["sound_poke"]  ?? "boop",
      });
      setAgendaAccess(d["agenda_access"] ?? "all");
    });
    apiFetch<{ id: number; name: string; role: string }[]>("/api/users").then(u =>
      setCoordinators(u.filter(x => x.role === "coordinator" || x.role === "supervisor"))
    );
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

  const doSeed = async () => {
    setSeeding(true);
    setSeedDone(null);
    try {
      const r = await apiPost<{ ok: boolean; created: number }>("/api/admin/seed", {});
      setSeedDone(r.created);
      toast.success(`${r.created} tarefas de exemplo criadas com sucesso.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar amostras");
    } finally {
      setSeeding(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await apiPost("/api/admin/reset", {});
      toast.success("Dados limpos com sucesso.");
      setResetOpen(false);
    } catch {
      toast.error("Erro ao limpar os dados");
    } finally {
      setResetting(false);
      setResetConfirm("");
    }
  };

  const save = async () => {
    setSaving(true);
    const prevFavicon = (await apiFetch<Record<string, string>>("/api/settings"))["favicon_url"] ?? "";
    const faviconChanged = form.favicon_url !== prevFavicon;
    try {
      await apiPut("/api/settings", { ...form, ...sounds, agenda_access: agendaAccess });
      await refreshSettings();
      if (faviconChanged) {
        toast.success("Configurações salvas — recarregando para aplicar o favicon…");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.success("Configurações salvas");
      }
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

      {/* Dados de Demonstração */}
      <Card className="border-blue-200 dark:border-blue-900">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-blue-500" />
            Dados de Demonstração
          </CardTitle>
          <CardDescription>
            Popula o sistema com tarefas de exemplo cobrindo todos os status, prioridades e recursos dos cards do dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-blue-100 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/20 p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              {[
                { label: "Concluídas", n: 8 }, { label: "Em aprovação", n: 6 }, { label: "Atrasadas", n: 5 },
                { label: "Em edição", n: 4 }, { label: "Pendentes", n: 3 }, { label: "Em alteração", n: 3 },
                { label: "Pausada / Reaberta / Cancelada / Rascunho", n: 4 },
              ].map(g => (
                <div key={g.label} className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0" />
                  <span>{g.n}× {g.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]/70">
              As tarefas são distribuídas entre os usuários existentes. Inclui histórico de revisões, eventos de status e prazos variados (atrasados, hoje, futuros).
            </p>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={doSeed}
                disabled={seeding}
              >
                <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
                {seeding ? "Gerando amostras…" : "Gerar tarefas de exemplo"}
              </Button>
              {seedDone !== null && (
                <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />{seedDone} tarefas criadas
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sons da Plataforma */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-[hsl(var(--primary))]" />
            Sons da Plataforma
          </CardTitle>
          <CardDescription>
            Escolha o som para cada tipo de notificação. Clique em ▶ para ouvir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {(
            [
              { key: "sound_notif", label: "Notificações gerais (sininho)", icon: "🔔" },
              { key: "sound_chat",  label: "Mensagens de chat",             icon: "💬" },
              { key: "sound_poke",  label: "Cutucar",                       icon: "👈" },
            ] as { key: keyof typeof sounds; label: string; icon: string }[]
          ).map(({ key, label, icon }) => (
            <div key={key} className="space-y-2">
              <Label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest">
                {icon} {label}
              </Label>
              <div className="flex flex-wrap gap-2">
                {SOUND_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSounds(s => ({ ...s, [key]: opt.value }))}
                    className={[
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                      sounds[key] === opt.value
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground))]/20",
                    ].join(" ")}
                  >
                    {opt.label}
                    {opt.value !== "none" && (
                      <span
                        role="button"
                        title="Ouvir"
                        onClick={e => { e.stopPropagation(); playSound(opt.value as SoundPreset); }}
                        className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                      >
                        <Play className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Acesso — Agenda Geral */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-[hsl(var(--primary))]" />
            Controle de Acesso
          </CardTitle>
          <CardDescription>Selecione quais coordenadores podem ver a Agenda Geral. Admin e supervisor sempre têm acesso.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Atalhos */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAgendaAccess("all")}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${agendaAccess === "all" ? "bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/50"}`}>
              Todos
            </button>
            <button type="button" onClick={() => setAgendaAccess("")}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${agendaAccess === "" ? "bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))]/50"}`}>
              Nenhum
            </button>
          </div>

          {/* Lista de coordenadores */}
          <div className="border rounded-xl divide-y max-h-60 overflow-y-auto">
            {coordinators.length === 0 && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] px-4 py-3">Nenhum coordenador cadastrado.</p>
            )}
            {coordinators.map(c => {
              const selectedIds = agendaAccess === "all"
                ? coordinators.map(x => String(x.id))
                : (agendaAccess ? agendaAccess.split(",").map(s => s.trim()) : []);
              const checked = selectedIds.includes(String(c.id));
              const toggle = () => {
                const current = agendaAccess === "all"
                  ? coordinators.map(x => String(x.id))
                  : (agendaAccess ? agendaAccess.split(",").map(s => s.trim()).filter(Boolean) : []);
                const next = checked
                  ? current.filter(id => id !== String(c.id))
                  : [...current, String(c.id)];
                setAgendaAccess(next.length === coordinators.length ? "all" : next.join(","));
              };
              return (
                <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[hsl(var(--muted))]/30 transition-colors">
                  <input type="checkbox" checked={checked} onChange={toggle}
                    className="h-4 w-4 rounded accent-[hsl(var(--primary))]" />
                  <span className="text-sm">{c.name}</span>
                </label>
              );
            })}
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
              <p className="text-sm font-medium">Limpar dados operacionais</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                Remove tarefas, mensagens, notificações e feed. Usuários e clientes são preservados.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => { setResetConfirm(""); setResetOpen(true); }}>
              Limpar dados
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de confirmação */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <TriangleAlert className="h-5 w-5" /> Limpar dados operacionais?
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">Esta ação é <strong>permanente e irreversível</strong>. Serão apagados:</span>
              <ul className="list-disc list-inside text-sm space-y-0.5 text-[hsl(var(--foreground))]">
                <li>Todas as tarefas e histórico de alterações</li>
                <li>Todo o feed, comentários e reações</li>
                <li>Todas as mensagens de chat e DMs</li>
                <li>Todas as notificações</li>
              </ul>
              <span className="block mt-2 text-green-700 dark:text-green-400 font-medium text-sm">✓ Usuários e clientes serão mantidos.</span>
              <span className="block mt-2">Para confirmar, digite <strong>LIMPAR</strong> abaixo:</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={resetConfirm}
            onChange={e => setResetConfirm(e.target.value)}
            placeholder="LIMPAR"
            className="font-mono"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={resetConfirm !== "LIMPAR" || resetting}
              onClick={doReset}
            >
              {resetting ? "Limpando..." : "Confirmar limpeza"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
