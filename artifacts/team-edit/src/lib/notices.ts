/**
 * Notificações em dois lugares, sem repetir:
 *  - **Avisos** (painel na Fila e em Minha fila): só o que pede atenção ou uma ação — job pronto para o cliente,
 *    prazo vencido, job em risco, lembrete de começar, travado, alteração do cliente, devolvido, job novo para o editor…
 *  - **Sininho** (barra do topo): o resto, informativo do sistema — prazo recalculado, job movido, começou,
 *    aprovado, troca de editor, menções no mural…
 * A API guarda tudo em `te_notifications`; a separação é só pelo `type`.
 */
export interface AppNotification {
  id: number; type: string; title: string; message: string; read: boolean;
  taskId: number | null; jobId?: number | null; taskCode?: string | null; createdAt: string;
}

export type NoticeTone = "bad" | "warn" | "info";
/** tipos que vão para Avisos, com o tom (vermelho = urgente, âmbar = ação, azul = novidade sua) */
export const IMPORTANT: Record<string, NoticeTone> = {
  due_passed: "bad",        // prazo de entrega vencido
  queue_blocked: "bad",     // job travado
  queue_escalated: "bad",   // travado com prazo em risco, foi para a supervisão
  due_risk: "warn",         // pela conta de agora, o job não cabe no prazo (gestor)
  queue_idle: "warn",       // editor sem job em edição há 30 min: lembrete para começar
  task_review: "warn",      // pronto: mandar para o cliente
  task_revision: "warn",    // cliente pediu alteração
  task_reopened: "warn",    // job reaberto
  task_returned: "warn",    // devolvido
  task_paused: "warn",      // pausado/travado
  task_cancelled: "warn",   // cancelado
  task_assigned: "info",    // job novo para você
};
export const isImportant = (n: Pick<AppNotification, "type">) => n.type in IMPORTANT;
