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
