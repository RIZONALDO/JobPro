import nodemailer from "nodemailer";
import cron from "node-cron";
import { db, appSettingsTable, dutySchedulesTable, usersTable, emailLogsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";

// ── Settings keys stored in te_app_settings ─────────────────────────────────
const KEY_ENABLED    = "duty_email_enabled";
const KEY_RECIPIENTS = "duty_email_recipients";
const KEY_SMTP_HOST  = "duty_email_smtp_host";
const KEY_SMTP_PORT  = "duty_email_smtp_port";
const KEY_SMTP_USER  = "duty_email_smtp_user";
const KEY_SMTP_PASS  = "duty_email_smtp_pass";
const KEY_CRON_DAY    = "duty_email_cron_day";
const KEY_CRON_HOUR   = "duty_email_cron_hour";
const KEY_CRON_MINUTE = "duty_email_cron_minute";

export interface EmailConfig {
  enabled: boolean;
  recipients: string[];
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  cronDay: number;
  cronHour: number;
  cronMinute: number;
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const all = await db.select().from(appSettingsTable);
  const m = Object.fromEntries(all.map(r => [r.key, r.value ?? ""]));
  return {
    enabled:    m[KEY_ENABLED]    === "true",
    recipients: m[KEY_RECIPIENTS] ? JSON.parse(m[KEY_RECIPIENTS]) : [],
    smtpHost:   m[KEY_SMTP_HOST]  || "mail.nagibcomunicacao.com.br",
    smtpPort:   m[KEY_SMTP_PORT]  ? parseInt(m[KEY_SMTP_PORT], 10) : 465,
    smtpUser:   m[KEY_SMTP_USER]  ?? "",
    smtpPass:   m[KEY_SMTP_PASS]  ?? "",
    cronDay:    m[KEY_CRON_DAY]    ? parseInt(m[KEY_CRON_DAY], 10)    : 1,
    cronHour:   m[KEY_CRON_HOUR]   ? parseInt(m[KEY_CRON_HOUR], 10)   : 8,
    cronMinute: m[KEY_CRON_MINUTE] ? parseInt(m[KEY_CRON_MINUTE], 10) : 0,
  };
}

export async function saveEmailConfig(cfg: Partial<EmailConfig>): Promise<void> {
  const upsert = async (key: string, value: string) => {
    await db.insert(appSettingsTable).values({ key, value })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value } });
  };
  if (cfg.enabled    !== undefined) await upsert(KEY_ENABLED,    String(cfg.enabled));
  if (cfg.recipients !== undefined) await upsert(KEY_RECIPIENTS, JSON.stringify(cfg.recipients));
  if (cfg.smtpHost   !== undefined) await upsert(KEY_SMTP_HOST,  cfg.smtpHost);
  if (cfg.smtpPort   !== undefined) await upsert(KEY_SMTP_PORT,  String(cfg.smtpPort));
  if (cfg.smtpUser   !== undefined) await upsert(KEY_SMTP_USER,  cfg.smtpUser);
  if (cfg.smtpPass   !== undefined) await upsert(KEY_SMTP_PASS,  cfg.smtpPass);
  if (cfg.cronDay    !== undefined) await upsert(KEY_CRON_DAY,    String(cfg.cronDay));
  if (cfg.cronHour   !== undefined) await upsert(KEY_CRON_HOUR,   String(cfg.cronHour));
  if (cfg.cronMinute !== undefined) await upsert(KEY_CRON_MINUTE, String(cfg.cronMinute));
}

async function getAppName(): Promise<string> {
  const rows = await db.select().from(appSettingsTable);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
  return m["company_name"] || "EditorPro";
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function lastWeekRange(): { start: string; end: string } {
  const t = new Date();
  const dow = t.getDay();
  const mon = new Date(t);
  mon.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { start: fmt(mon), end: fmt(sun) };
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getDay()]}, ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ── Report HTML ──────────────────────────────────────────────────────────────
function buildEditorRows(entries: { name: string; days: { date: string; notes: string | null }[] }[]): string {
  if (entries.length === 0) {
    return `<tr><td colspan="3" style="padding:12px 0;color:#bbb;font-size:12px;font-style:italic">Nenhum editor escalado</td></tr>`;
  }
  const badge = (label: string) =>
    `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:5px;vertical-align:middle">${label}</span>`;
  return entries.map(({ name, days }) =>
    `<tr>
      <td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #f0f0f0;font-size:14px">${name}</td>
      <td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #f0f0f0;color:#666;font-size:12px;line-height:1.9">${days.map(({ date, notes }) =>
        fmtDate(date) + (notes ? badge(notes) : "")
      ).join("<br>")}</td>
      <td style="padding:10px 0;text-align:right;vertical-align:top;border-bottom:1px solid #f0f0f0;font-size:20px;font-weight:900;color:#111">${days.length}</td>
    </tr>`
  ).join("");
}

export async function buildReportHtml(weekStart: string, weekEnd: string, senderName?: string, senderTitle?: string): Promise<string> {
  const [appName, rows] = await Promise.all([
    getAppName(),
    db
    .select({
      weekendStart: dutySchedulesTable.weekendStart,
      slotType:     dutySchedulesTable.slotType,
      notes:        dutySchedulesTable.notes,
      editorId:     dutySchedulesTable.editorId,
      editorName:   usersTable.name,
    })
    .from(dutySchedulesTable)
    .leftJoin(usersTable, eq(dutySchedulesTable.editorId, usersTable.id))
    .where(and(
      gte(dutySchedulesTable.weekendStart, weekStart),
      lte(dutySchedulesTable.weekendStart, weekEnd),
    ))
    .orderBy(dutySchedulesTable.weekendStart),
  ]);

  // Grupo 1: Plantões Especiais (Sáb + Dom) | Grupo 2: Outros Plantões (Seg–Sex)
  type EditorEntry = { name: string; days: { date: string; notes: string | null }[] };
  const weekendMap = new Map<number, EditorEntry>();
  const weekdayMap = new Map<number, EditorEntry>();

  for (const row of rows) {
    if (!row.editorId || !row.editorName) continue;
    const dow = new Date(row.weekendStart + "T12:00:00").getDay();
    const map = (dow === 0 || dow === 6) ? weekendMap : weekdayMap;
    if (!map.has(row.editorId)) map.set(row.editorId, { name: row.editorName, days: [] });
    map.get(row.editorId)!.days.push({ date: row.weekendStart, notes: row.notes?.trim() || null });
  }

  const sortMap = (m: Map<number, EditorEntry>) =>
    Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const weekendEntries = sortMap(weekendMap);
  const weekdayEntries = sortMap(weekdayMap);
  const totalWeekend   = weekendEntries.reduce((s, e) => s + e.days.length, 0);
  const totalWeekday   = weekdayEntries.reduce((s, e) => s + e.days.length, 0);
  const grandTotal     = totalWeekend + totalWeekday;

  const geradoEm  = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const assinante = senderName || appName;
  const cargo     = senderTitle || "";

  const colHeader = (label: string, align = "left") =>
    `<th style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;padding:0 0 10px;text-align:${align};border-bottom:1px solid #e5e5e5">${label}</th>`;

  const secHeader = (label: string) =>
    `<tr><td colspan="3" style="padding:18px 0 6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#111">${label}</td></tr>`;

  const secSubtotal = (val: number) =>
    `<tr><td colspan="2" style="padding:8px 0 6px;font-size:12px;font-weight:600;color:#555">Subtotal</td>
     <td style="padding:8px 0 6px;text-align:right;font-size:18px;font-weight:900;color:#555">${val}</td></tr>`;

  const tableBody = grandTotal === 0
    ? `<tr><td colspan="3" style="padding:20px;text-align:center;color:#999;font-style:italic">Nenhum plantão registrado neste período</td></tr>`
    : [
        weekendEntries.length > 0 ? secHeader("Plantões Especiais") + buildEditorRows(weekendEntries) + secSubtotal(totalWeekend) : "",
        weekdayEntries.length > 0 ? secHeader("Outros Plantões")    + buildEditorRows(weekdayEntries) + secSubtotal(totalWeekday)  : "",
      ].join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Faturamento de Plantões da Edição — ${appName}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;color:#111">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

    <!-- Cabeçalho -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#111">
      <tr>
        <td style="padding:22px 36px;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#fff">${appName}</td>
        <td style="padding:22px 36px;font-size:11px;color:#888;letter-spacing:.04em;text-transform:uppercase;text-align:right">Faturamento</td>
      </tr>
    </table>

    <!-- Corpo -->
    <div style="padding:36px 36px 0">

      <h1 style="font-size:20px;font-weight:900;letter-spacing:-.02em;margin:0 0 4px;color:#111">Faturamento de Plantões da Edição</h1>
      <p style="font-size:13px;color:#888;margin:0 0 24px;font-weight:500">
        Período: ${fmtDate(weekStart)} &nbsp;→&nbsp; ${fmtDate(weekEnd)}
      </p>

      <!-- Saudação -->
      <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 24px">
        Prezado(a), segue o relatório de plantões realizados no período acima para processamento do faturamento.
      </p>

      <!-- Divisor -->
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 24px">

      <!-- Tabela -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <thead>
          <tr>
            ${colHeader("Editor")}
            ${colHeader("Datas")}
            ${colHeader("Dias", "right")}
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>

      <!-- Total geral -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:2px solid #111">
        <tr>
          <td style="padding-top:14px;font-size:13px;font-weight:600;color:#111">Total geral de plantões</td>
          <td style="padding-top:14px;font-size:30px;font-weight:900;color:#111;text-align:right">${grandTotal}</td>
        </tr>
      </table>

      <!-- Assinatura -->
      <div style="margin-top:36px;padding-top:24px;border-top:1px solid #f0f0f0">
        <p style="font-size:14px;color:#555;margin:0 0 6px">Atenciosamente,</p>
        <p style="font-size:15px;font-weight:700;color:#111;margin:0 0 2px">${assinante}</p>
        ${cargo ? `<p style="font-size:12px;color:#666;margin:0 0 2px">${cargo}</p>` : ""}
        <p style="font-size:12px;color:#aaa;margin:0">${appName}</p>
      </div>

    </div>

    <!-- Rodapé -->
    <div style="padding:20px 36px;margin-top:36px;background:#f9f9f9;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:11px;color:#bbb;margin:0">
        Gerado em ${geradoEm} &nbsp;·&nbsp; ${appName} Faturamento de Plantões da Edição
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ── Send email ────────────────────────────────────────────────────────────────
export async function sendReport(
  weekStart: string, weekEnd: string, cfg: EmailConfig,
  senderName?: string, senderTitle?: string,
  trigger: "manual" | "auto" = "manual",
): Promise<void> {
  if (!cfg.smtpUser || !cfg.smtpPass) throw new Error("SMTP não configurado");
  if (!cfg.recipients.length) throw new Error("Nenhum destinatário cadastrado");

  const [appName, html] = await Promise.all([getAppName(), buildReportHtml(weekStart, weekEnd, senderName, senderTitle)]);

  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
  });

  const period = `${fmtDate(weekStart).slice(4)} a ${fmtDate(weekEnd).slice(4)}`;

  try {
    const info = await transporter.sendMail({
      from: `"Faturamento · ${appName}" <${cfg.smtpUser}>`,
      to:   cfg.recipients.join(", "),
      subject: `${appName} — Faturamento de Plantões da Edição — ${period}`,
      html,
    });
    await db.insert(emailLogsTable).values({
      weekStart, weekEnd,
      recipients:    cfg.recipients,
      status:        "sent",
      trigger,
      senderName:    senderName ?? null,
      smtpMessageId: info.messageId ?? null,
    });
  } catch (err) {
    await db.insert(emailLogsTable).values({
      weekStart, weekEnd,
      recipients:   cfg.recipients,
      status:       "failed",
      trigger,
      senderName:   senderName ?? null,
      errorMessage: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}

// ── Cron: fires every minute, checks configured day/hour/minute from DB ──────
export function startDutyCron(): void {
  cron.schedule("* * * * *", async () => {
    const cfg = await getEmailConfig().catch(() => null);
    if (!cfg?.enabled || !cfg.recipients.length) return;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    if (now.getDay() !== cfg.cronDay || now.getHours() !== cfg.cronHour || now.getMinutes() !== cfg.cronMinute) return;
    const { start, end } = lastWeekRange();
    // Deduplicação: ignora se já existe envio automático bem-sucedido para esta semana
    const already = await db
      .select({ id: emailLogsTable.id })
      .from(emailLogsTable)
      .where(and(
        eq(emailLogsTable.weekStart, start),
        eq(emailLogsTable.weekEnd,   end),
        eq(emailLogsTable.trigger,   "auto"),
        eq(emailLogsTable.status,    "sent"),
      ))
      .limit(1)
      .catch(() => null);
    if (already && already.length > 0) return;
    await sendReport(start, end, cfg, undefined, undefined, "auto").catch(() => {});
  }, { timezone: "America/Sao_Paulo" });
}
