export const ROLE_LABEL: Record<string, string> = {
  admin:       "Admin",
  supervisor:  "Supervisor",
  coordinator: "Gestor",
  editor:      "Operacional",
};

export const ROLE_OPTIONS = [
  { value: "admin",       label: "Admin"       },
  { value: "supervisor",  label: "Supervisor"  },
  { value: "coordinator", label: "Gestor"      },
  { value: "editor",      label: "Operacional" },
];

// Roles that have coordinator-level access or above
export const COORD_ROLES = ["admin", "supervisor", "coordinator"];

/**
 * Nome funcional da pessoa: o "Cargo / função" do cadastro (Atendimento, Editor, Supervisor…).
 * Sem cargo preenchido, cai no nome do perfil de acesso. Filtrar continua sendo pelo `role`.
 */
export function roleName(u: { role?: string | null; jobTitle?: string | null } | null | undefined): string {
  if (!u) return "";
  return u.jobTitle?.trim() || ROLE_LABEL[u.role ?? ""] || u.role || "";
}
