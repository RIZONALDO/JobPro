import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiPut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Camera, User, Mail, Phone, Lock, Eye, EyeOff, Save } from "lucide-react";
import { usePageTitle } from "@/lib/use-page-title";

import { ROLE_LABEL } from "@/lib/roles";

export default function Profile() {
  usePageTitle("Perfil");
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name,     setName]     = useState(user?.name     ?? "");
  const [email,    setEmail]    = useState(user?.email    ?? "");
  const [phone,    setPhone]    = useState(user?.phone    ?? "");
  const [avatar,   setAvatar]   = useState(user?.avatarUrl ?? "");

  const [curPwd,   setCurPwd]   = useState("");
  const [newPwd,   setNewPwd]   = useState("");
  const [confPwd,  setConfPwd]  = useState("");
  const [showCur,  setShowCur]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [showConf, setShowConf] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email ?? "");
      setPhone(user.phone ?? "");
      setAvatar(user.avatarUrl ?? "");
    }
  }, [user]);

  const handleAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Imagem muito grande (máx 2MB)", variant: "destructive" }); return;
    }
    const reader = new FileReader();
    reader.onload = ev => setAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (newPwd && newPwd !== confPwd) {
      toast({ title: "As senhas não coincidem", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await apiPut("/api/auth/profile", {
        name:      name.trim() || undefined,
        email:     email || null,
        phone:     phone || null,
        avatarUrl: avatar || null,
        ...(newPwd ? { currentPassword: curPwd, newPassword: newPwd } : {}),
      });
      await refresh();
      setCurPwd(""); setNewPwd(""); setConfPwd("");
      toast({ title: "Perfil atualizado com sucesso" });
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : "Erro ao salvar", variant: "destructive" });
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
                <img src={avatar} alt={name} className="h-20 w-20 rounded-full object-cover border-2 border-[hsl(var(--border))]" />
              ) : (
                <div className="h-20 w-20 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center text-xl font-bold border-2 border-[hsl(var(--border))]">
                  {initials}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-[hsl(var(--primary))] text-white flex items-center justify-center shadow hover:opacity-90 transition-opacity"
              >
                <Camera className="h-3.5 w-3.5" />
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
            {avatar && (
              <button
                type="button"
                onClick={() => setAvatar("")}
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
