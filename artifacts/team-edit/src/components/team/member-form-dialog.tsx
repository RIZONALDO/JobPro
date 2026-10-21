import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { compressAvatar } from "@/lib/compress-image";
import { ROLE_OPTIONS } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Copy, KeyRound } from "@/lib/icons";
import { ROLE_DESCRIPTION, type Member } from "./shared";

const EMPTY = { name: "", login: "", jobTitle: "", email: "", phone: "", role: "editor", password: "", avatarUrl: "", active: true, mustChange: true };

/** Senha temporária legível (sem 0/O, 1/l/I). */
function generatePassword(len = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => chars[n % chars.length]).join("");
}

export function MemberFormDialog({ open, onOpenChange, editing, canManageAdmins, onSaved, onRequestInactivate }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Member | null;
  canManageAdmins: boolean;
  onSaved: () => void;
  /** Chamado quando o usuário desligou "Membro ativo" — o fluxo de inativação continua fora daqui. */
  onRequestInactivate: (m: Member) => void;
}) {
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const roles = canManageAdmins ? ROLE_OPTIONS : ROLE_OPTIONS.filter(o => ["coordinator", "editor"].includes(o.value));

  useEffect(() => {
    if (!open) return;
    setGenerated("");
    setF(editing ? {
      name: editing.name, login: editing.login, jobTitle: editing.jobTitle ?? "", email: editing.email ?? "",
      phone: editing.phone ?? "", role: editing.role, password: "", avatarUrl: editing.avatarUrl ?? "",
      active: editing.status === "active", mustChange: true,
    } : EMPTY);
  }, [open, editing]);

  const set = (patch: Partial<typeof EMPTY>) => setF(p => ({ ...p, ...patch }));

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    try { set({ avatarUrl: await compressAvatar(file) }); }
    catch { toast.error("Não foi possível ler a imagem"); }
  };

  const genPassword = () => {
    const pw = generatePassword();
    setGenerated(pw);
    set({ password: pw, mustChange: true });
  };

  const save = async () => {
    if (!f.name.trim()) { toast.error("Informe o nome"); return; }
    if (!editing && (!f.login.trim() || !f.password)) { toast.error("Login e senha são obrigatórios"); return; }
    if (f.password && f.password.length < 6) { toast.error("Senha muito curta (mínimo 6 caracteres)"); return; }
    setSaving(true);
    try {
      const common = {
        name: f.name.trim(), role: f.role, jobTitle: f.jobTitle || null,
        email: f.email || null, phone: f.phone || null, avatarUrl: f.avatarUrl || null,
      };
      if (editing) {
        await apiPut(`/api/users/${editing.id}`, {
          ...common,
          // reativação vai junto; inativação segue pelo diálogo de confirmação
          ...(editing.status !== "active" && f.active ? { status: "active" } : {}),
          ...(f.password ? { password: f.password, mustChangePassword: f.mustChange } : {}),
        });
        toast.success(editing.status !== "active" && f.active ? `${f.name} reativado` : "Membro atualizado");
      } else {
        await apiPost("/api/users", { ...common, login: f.login, password: f.password, mustChangePassword: f.mustChange });
        toast.success("Membro criado");
      }
      onOpenChange(false);
      onSaved();
      if (editing && editing.status === "active" && !f.active) onRequestInactivate(editing);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "Editar membro" : "Novo membro"}</DialogTitle></DialogHeader>

        <div className="space-y-5 py-1">
          {/* Foto */}
          <div className="flex items-center gap-4">
            <AvatarDisplay name={f.name || "?"} avatarUrl={f.avatarUrl || null} size={72} className="shrink-0" />
            <div className="space-y-2">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Foto do perfil</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Enviar foto</Button>
                {f.avatarUrl && <Button type="button" variant="ghost" size="sm" onClick={() => set({ avatarUrl: "" })}>Remover</Button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
          </div>

          {/* Dados */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mf-name">Nome completo *</Label>
              <Input id="mf-name" value={f.name} onChange={e => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-login">Login *</Label>
              <Input id="mf-login" value={f.login} disabled={!!editing} className="font-mono"
                onChange={e => set({ login: e.target.value.toLowerCase().replace(/\s/g, "") })} placeholder="login.usuario" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-title">Cargo / função</Label>
              <Input id="mf-title" value={f.jobTitle} onChange={e => set({ jobTitle: e.target.value })} placeholder="Ex: Motion designer" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-email">E-mail</Label>
              <Input id="mf-email" type="email" value={f.email} onChange={e => set({ email: e.target.value })} placeholder="nome@agencia.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mf-phone">Telefone</Label>
              <Input id="mf-phone" value={f.phone} onChange={e => set({ phone: e.target.value })} placeholder="(00) 00000-0000" />
            </div>
          </div>

          {/* Perfil de acesso */}
          <div className="space-y-2">
            <Label>Perfil de acesso</Label>
            <div role="radiogroup" aria-label="Perfil de acesso" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {roles.map(o => {
                const on = f.role === o.value;
                return (
                  <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => set({ role: o.value })}
                    className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      on ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40")}>
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
                      style={{ borderColor: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.5)" }}>
                      {on && <span className="h-2 w-2 rounded-full" style={{ background: "hsl(var(--primary))" }} />}
                    </span>
                    <span className="space-y-0.5">
                      <span className="block text-sm font-semibold">{o.label}</span>
                      <span className="block text-xs text-[hsl(var(--muted-foreground))]">{ROLE_DESCRIPTION[o.value]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Senha */}
          <div className="space-y-2">
            <Label>{editing ? "Senha" : "Senha *"}</Label>
            <div className="rounded-xl bg-[hsl(var(--muted))]/40 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input type={generated ? "text" : "password"} value={f.password} className="flex-1 min-w-[180px] font-mono"
                  onChange={e => { setGenerated(""); set({ password: e.target.value }); }}
                  placeholder={editing ? "Deixe em branco para manter" : "Mínimo 6 caracteres"} />
                <Button type="button" variant="outline" size="sm" onClick={genPassword}>
                  <KeyRound className="h-3.5 w-3.5 mr-1.5" />Gerar senha temporária
                </Button>
              </div>
              {generated && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
                  <span>Copie e envie para a pessoa — a senha não será mostrada de novo.</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7"
                    onClick={() => navigator.clipboard.writeText(generated).then(() => toast.success("Senha copiada"))}>
                    <Copy className="h-3.5 w-3.5 mr-1" />Copiar
                  </Button>
                </div>
              )}
              {(f.password || !editing) && (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 rounded accent-[hsl(var(--primary))]" checked={f.mustChange}
                    onChange={e => set({ mustChange: e.target.checked })} />
                  Exigir troca no próximo acesso
                </label>
              )}
            </div>
          </div>

          {/* Status */}
          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">Membro ativo</span>
                <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                  Desligar remove da equipe e encerra o acesso. O histórico é mantido.
                </span>
              </span>
              <button type="button" role="switch" aria-checked={f.active} aria-label="Membro ativo"
                onClick={() => set({ active: !f.active })}
                className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors",
                  f.active ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted-foreground))]/30")}>
                <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white transition-all", f.active ? "left-6" : "left-1")} />
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
