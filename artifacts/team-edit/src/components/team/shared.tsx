import { cn } from "@/lib/utils";
import { AvatarDisplay } from "@/components/ui/avatar-display";
import { ROLE_LABEL } from "@/lib/roles";
import { absenceShort, isActiveUser, type Absence } from "@/lib/availability";

export interface Member {
  id: number;
  name: string;
  login: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  createdAt?: string;
  absence?: Absence | null;
  online?: boolean;
  // Só vêm para quem gerencia a equipe
  email?: string | null;
  phone?: string | null;
  mustChangePassword?: boolean;
  lastSeenAt?: string | null;
}

export const MEMBER_GROUPS = [
  { id: "admin",       label: "Administração e supervisão", roles: ["admin", "supervisor"] },
  { id: "coordinator", label: "Gestores",                   roles: ["coordinator"] },
  { id: "editor",      label: "Operacional",                roles: ["editor"] },
];

export const ROLE_DESCRIPTION: Record<string, string> = {
  admin:       "Acesso total, inclusive configurações do sistema.",
  supervisor:  "Gerencia membros, ausências e plantões.",
  coordinator: "Cria e acompanha tarefas da equipe.",
  editor:      "Executa as tarefas atribuídas a ele.",
};

export function groupOf(role: string): string {
  return MEMBER_GROUPS.find(g => g.roles.includes(role))?.id ?? "editor";
}

export function isAway(m: Member): boolean {
  return isActiveUser(m) && !!m.absence;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function fmtJoined(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Online agora", "Há 20 min", "Há 3 dias", "Nunca acessou" */
export function fmtLastSeen(m: Member): string {
  if (m.online) return "Online agora";
  if (!m.lastSeenAt) return m.mustChangePassword ? "Nunca acessou" : "Sem registro";
  const diff = Date.now() - new Date(m.lastSeenAt).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Agora há pouco";
  if (min < 60) return `Há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Há ${d} ${d === 1 ? "dia" : "dias"}`;
  const mo = Math.floor(d / 30);
  return `Há ${mo} ${mo === 1 ? "mês" : "meses"}`;
}

/** Avatar com anel: verde = online, âmbar = ausente; cinza/esmaecido = inativo. */
export function MemberAvatar({ member, size = 48, className }: { member: Member; size?: number; className?: string }) {
  const inactive = !isActiveUser(member);
  const ring = inactive ? "" : isAway(member)
    ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-[hsl(var(--card))]"
    : member.online ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-[hsl(var(--card))]" : "";
  return (
    <AvatarDisplay
      name={member.name}
      avatarUrl={member.avatarUrl}
      size={size}
      className={cn("shrink-0 rounded-full", ring, inactive && "grayscale opacity-60", className)}
    />
  );
}

const CHIP = "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";

export function RoleChip({ role, me }: { role: string; me?: boolean }) {
  const admin = role === "admin" || role === "supervisor";
  return (
    <span className={cn(CHIP, admin
      ? "bg-violet-500/10 border-violet-500/30 text-violet-600 dark:text-violet-300"
      : role === "coordinator"
        ? "bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300"
        : "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-300")}>
      {ROLE_LABEL[role] ?? role}{me ? " · você" : ""}
    </span>
  );
}

export function StatusChip({ member }: { member: Member }) {
  if (!isActiveUser(member)) {
    return <span className={cn(CHIP, "bg-slate-500/10 border-slate-500/30 text-slate-500 dark:text-slate-400")}>Inativo</span>;
  }
  if (member.absence) {
    return <span className={cn(CHIP, "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300")}>{absenceShort(member.absence)}</span>;
  }
  return <span className={cn(CHIP, "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300")}>Ativo</span>;
}

export function FirstAccessChip() {
  return <span className={cn(CHIP, "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300")}>1º acesso pendente</span>;
}
