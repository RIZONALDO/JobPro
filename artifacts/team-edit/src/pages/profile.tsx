import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiPut } from "@/lib/api";
import { compressAvatar } from "@/lib/compress-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, User, Mail, Phone, Lock, Eye, EyeOff, Save } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";

import { ROLE_LABEL } from "@/lib/roles";

export default function Profile() {
  usePageTitle("Perfil");
  const { user, refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name,         setName]         = useState(user?.name         ?? "");
  const [email,        setEmail]        = useState(user?.email        ?? "");
  const [phone,        setPhone]        = useState(user?.phone        ?? "");
  const [avatar,       setAvatar]       = useState(user?.avatarUrl    ?? "");
  const [profileColor, setProfileColor] = useState((user as any)?.profileColor ?? "");

  const [curPwd,   setCurPwd]   = useState("");
  const [newPwd,   setNewPwd]   = useState("");
  const [confPwd,  setConfPwd]  = useState("");
  const [showCur,  setShowCur]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [showConf, setShowConf] = useState(false);

  const [saving,         setSaving]         = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email ?? "");
      setPhone(user.phone ?? "");
      setAvatar(user.avatarUrl ?? "");
      setProfileColor((user as any).profileColor ?? "");
    }
  }, [user]);

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const dataUrl = await compressAvatar(file);
      setAvatar(dataUrl);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar imagem");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    if (newPwd && newPwd !== confPwd) {
      toast.error("As senhas não coincidem"); return;
    }
    setSaving(true);
    try {
      await apiPut("/api/auth/profile", {
        name:      name.trim() || undefined,
        email:        email || null,
        phone:        phone || null,
        avatarUrl:    avatar || null,
        profileColor: profileColor || null,
        ...(newPwd ? { currentPassword: curPwd, newPassword: newPwd } : {}),
      });
      await refresh();
      setCurPwd(""); setNewPwd(""); setConfPwd("");
      toast.success("Perfil atualizado com sucesso");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "?";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Meu perfil</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">Gerencie suas informações pessoais e segurança</p>
      </div>

      {/* Avatar + info básica */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="px-6 py-4 border-b bg-[hsl(var(--muted))]/30 flex items-center gap-2">
          <User className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="font-semibold text-sm">Informações pessoais</span>
        </div>

        <div className="p-6 space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              {avatar ? (
                <img src={avatar} alt={name} className="h-20 w-20 rounded-full object-cover border border-gray-300" />
              ) : (
                <div className="h-20 w-20 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center text-xl font-bold border border-gray-300">
                  {initials}
                </div>
              )}
              <button
                type="button"
                onClick={() => !uploadingAvatar && fileRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-[hsl(var(--primary))] text-white flex items-center justify-center shadow hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {uploadingAvatar
                  ? <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
            </div>
            <div>
              <p className="font-semibold text-sm">{user?.name}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">@{user?.login}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                  {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
                </span>
                {user?.jobTitle && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">{user.jobTitle}</span>
                )}
              </div>
            </div>
            {avatar && !uploadingAvatar && (
              <button
                type="button"
                onClick={async () => {
                  setAvatar("");
                  await apiPut("/api/auth/profile", { avatarUrl: null });
                  await refresh();
                }}
                className="ml-auto text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] transition-colors"
              >
                Remover foto
              </button>
            )}
          </div>

          {/* Campos */}
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome completo" />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /> E-mail
                </Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /> Telefone
                </Label>
                <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
              </div>

              {/* Minha cor */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 rounded-full border border-[hsl(var(--border))] shrink-0"
                    style={{ background: profileColor || "hsl(var(--muted-foreground)/0.3)" }} />
                  Minha cor
                </Label>
                <div className="flex items-center gap-3">
                  <div className="flex flex-wrap gap-2">
                    {["#6366f1","#8b5cf6","#ec4899","#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6","#64748b"].map(c => (
                      <button key={c} type="button" onClick={() => setProfileColor(c)}
                        className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          background: c,
                          borderColor: profileColor === c ? "hsl(var(--foreground))" : "transparent",
                          boxShadow: profileColor === c ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${c}` : "none",
                        }} />
                    ))}
                    <button type="button" onClick={() => setProfileColor("")}
                      className="h-7 w-7 rounded-full border-2 border-dashed border-[hsl(var(--border))] transition-opacity hover:opacity-60 flex items-center justify-center text-[10px] text-[hsl(var(--muted-foreground))]"
                      title="Sem cor">
                      ×
                    </button>
                  </div>
                  {profileColor && (
                    <div className="h-7 w-7 rounded-full shrink-0 border border-[hsl(var(--border))]"
                      style={{ background: profileColor }} />
                  )}
                </div>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]/60">
                  Usada para identificar suas tarefas na agenda individual.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alterar senha */}
      <div className="rounded-xl border bg-[hsl(var(--card))] card-float overflow-hidden">
        <div className="px-6 py-4 border-b bg-[hsl(var(--muted))]/30 flex items-center gap-2">
          <Lock className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="font-semibold text-sm">Alterar senha</span>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Deixe em branco para manter a senha atual.</p>

          <div className="space-y-1.5">
            <Label>Senha atual</Label>
            <div className="relative">
              <Input
                type={showCur ? "text" : "password"}
                value={curPwd}
                onChange={e => setCurPwd(e.target.value)}
                placeholder="••••••••"
                className="pr-10"
              />
              <button type="button" onClick={() => setShowCur(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                {showCur ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar nova senha</Label>
              <div className="relative">
                <Input
                  type={showConf ? "text" : "password"}
                  value={confPwd}
                  onChange={e => setConfPwd(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowConf(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                  {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {newPwd && confPwd && newPwd !== confPwd && (
            <p className="text-xs text-[hsl(var(--destructive))]">As senhas não coincidem.</p>
          )}
        </div>
      </div>

      {/* Salvar */}
      <div className="flex justify-end">
        <Button onClick={saveProfile} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>
    </div>
  );
}
