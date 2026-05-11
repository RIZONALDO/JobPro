import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { apiFetch, apiPost } from "@/lib/api";

export type UserRole = "admin" | "supervisor" | "coordinator" | "editor";

export interface AuthUser {
  id: number;
  name: string;
  login: string;
  role: UserRole;
  jobTitle: string | null;
  mustChangePassword: boolean;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  theme: "light" | "dark";
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await apiFetch<AuthUser>("/api/auth/me");
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = async (login: string, password: string) => {
    const u = await apiPost<AuthUser>("/api/auth/login", { login, password });
    setUser(u);
  };

  const logout = async () => {
    await apiPost("/api/auth/logout", {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
