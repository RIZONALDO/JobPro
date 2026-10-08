import { db, usersTable, userAbsencesTable } from "@workspace/db";
import { and, eq, gte, lte, inArray, asc } from "drizzle-orm";

/**
 * Disponibilidade da equipe.
 *
 * Dois conceitos distintos:
 *  - status "inactive" em te_users  → saiu da equipe. Some de seletores, carga, agenda,
 *    plantões novos e notificações. O histórico (tarefas antigas, relatórios) continua
 *    mostrando o nome normalmente.
 *  - ausência em te_user_absences   → férias / afastamento temporário. A pessoa continua
 *    ativa; o sistema só sinaliza e avisa (nunca bloqueia) quando alguém tenta atribuir.
 */

export const ABSENCE_TYPES = ["vacation", "leave", "medical", "day_off", "other"] as const;
export type AbsenceType = typeof ABSENCE_TYPES[number];

export const ABSENCE_LABEL: Record<string, string> = {
  vacation: "Férias",
  leave:    "Afastamento",
  medical:  "Licença médica",
  day_off:  "Folga",
  other:    "Ausência",
};

export interface AbsenceInfo {
  id: number;
  userId: number;
  type: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  notes: string | null;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function toInfo(r: typeof userAbsencesTable.$inferSelect): AbsenceInfo {
  return {
    id: r.id, userId: r.userId, type: r.type, label: ABSENCE_LABEL[r.type] ?? "Ausência",
    startDate: r.startDate, endDate: r.endDate, notes: r.notes ?? null,
  };
}

/** Ausências que se sobrepõem ao intervalo [from, to] (datas YYYY-MM-DD, inclusivas). */
export async function getAbsencesInRange(from: string, to: string, userIds?: number[]): Promise<AbsenceInfo[]> {
  if (userIds && userIds.length === 0) return [];
  const conds = [lte(userAbsencesTable.startDate, to), gte(userAbsencesTable.endDate, from)];
  if (userIds) conds.push(inArray(userAbsencesTable.userId, userIds));
  const rows = await db.select().from(userAbsencesTable).where(and(...conds)).orderBy(asc(userAbsencesTable.startDate));
  return rows.map(toInfo);
}

/** Mapa userId → ausência que cobre a data informada (uma por usuário). */
export async function getAbsenceMapOn(dateStr: string, userIds?: number[]): Promise<Map<number, AbsenceInfo>> {
  const list = await getAbsencesInRange(dateStr, dateStr, userIds);
  const map = new Map<number, AbsenceInfo>();
  for (const a of list) if (!map.has(a.userId)) map.set(a.userId, a);
  return map;
}

/** Retorna true se o usuário existe e está ativo. */
export async function isUserActive(userId: number): Promise<boolean> {
  const [u] = await db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.id, userId));
  return !!u && u.status === "active";
}

/** Dos ids informados, retorna os que pertencem a usuários inativos. */
export async function findInactive(userIds: number[]): Promise<{ id: number; name: string }[]> {
  const ids = [...new Set(userIds.filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  const rows = await db.select({ id: usersTable.id, name: usersTable.name, status: usersTable.status })
    .from(usersTable).where(inArray(usersTable.id, ids));
  return rows.filter(r => r.status !== "active").map(r => ({ id: r.id, name: r.name }));
}

/** Mensagem de aviso (não bloqueante) para atribuição durante uma ausência. */
export function absenceWarning(name: string, a: AbsenceInfo): string {
  const fmt = (s: string) => s.split("-").reverse().slice(0, 2).join("/");
  return `${name} está em ${a.label.toLowerCase()} de ${fmt(a.startDate)} a ${fmt(a.endDate)}`;
}
