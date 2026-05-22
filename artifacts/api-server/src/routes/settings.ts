import { Router } from "express";
import { db, appSettingsTable, usersTable, tasksTable, taskEditorsTable, taskRevisionsTable, taskEventsTable } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth.js";
import { pool } from "@workspace/db";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { execFile } from "node:child_process";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const STATIC_DIR = "/var/www/jobpro-public";

const router = Router();

// 32x32 indigo square — default favicon when no custom one is configured
const DEFAULT_FAVICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGNITvtIU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAMgi6FsP9QbPAAAAAElFTkSuQmCC",
  "base64"
);

async function resizeTo32(input: Buffer, bgColor = "#6366f1"): Promise<Buffer> {
  const id  = randomBytes(8).toString("hex");
  const inP = join(tmpdir(), `fav_in_${id}.png`);
  const outP = join(tmpdir(), `fav_out_${id}.png`);
  try {
    await writeFile(inP, input);
    await new Promise<void>((resolve, reject) =>
      execFile("convert", [inP, "-background", bgColor, "-flatten", "-resize", "32x32!", outP], (err) =>
        err ? reject(err) : resolve()
      )
    );
    return await readFile(outP);
  } finally {
    await unlink(inP).catch(() => {});
    await unlink(outP).catch(() => {});
  }
}

// Writes favicon.png to the static public directory so browsers get a real file (not a proxied API)
export async function updateStaticFavicon(faviconDataUrl: string, primaryColor: string): Promise<void> {
  try {
    const commaIdx = faviconDataUrl.indexOf(",");
    const raw = Buffer.from(faviconDataUrl.slice(commaIdx + 1), "base64");
    const resized = await resizeTo32(raw, primaryColor);
    await writeFile(join(STATIC_DIR, "favicon.png"), resized);
  } catch { /* non-fatal */ }
}

// Called once at startup to hydrate favicon.png from DB
export async function initStaticFavicon(): Promise<void> {
  try {
    const rows = await db.select().from(appSettingsTable)
      .where(or(eq(appSettingsTable.key, "favicon_url"), eq(appSettingsTable.key, "primary_color")));
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
    const faviconUrl  = byKey["favicon_url"]  ?? "";
    const primaryColor = byKey["primary_color"] ?? "#6366f1";
    if (faviconUrl.startsWith("data:")) {
      await updateStaticFavicon(faviconUrl, primaryColor);
    } else {
      await writeFile(join(STATIC_DIR, "favicon.png"), DEFAULT_FAVICON);
    }
  } catch { /* non-fatal */ }
}

// GET /api/favicon — kept for compatibility (SettingsContext cache-bust still calls this)
router.get("/favicon", async (_req, res): Promise<void> => {
  try {
    const png = await readFile(join(STATIC_DIR, "favicon.png"));
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.send(png);
  } catch {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.send(DEFAULT_FAVICON);
  }
});

router.get("/settings", async (_req, res): Promise<void> => {
  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) settings[row.key] = row.value ?? null;
  res.json(settings);
});

router.put("/settings", requireAdmin, async (req, res): Promise<void> => {
  const updates = req.body as Record<string, string>;
  if (!updates || typeof updates !== "object") { res.status(400).json({ error: "Body inválido" }); return; }

  for (const [key, value] of Object.entries(updates)) {
    await db.insert(appSettingsTable).values({ key, value: String(value) })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: String(value) } });
  }

  const rows = await db.select().from(appSettingsTable);
  const settings: Record<string, string | null> = {};
  for (const row of rows) settings[row.key] = row.value ?? null;

  // Regenerate static favicon.png whenever favicon or primary color changes
  const faviconUrl  = settings["favicon_url"]  ?? "";
  const primaryColor = settings["primary_color"] ?? "#6366f1";
  if (faviconUrl.startsWith("data:")) {
    void updateStaticFavicon(faviconUrl, primaryColor);
  }

  res.json(settings);
});

router.post("/admin/reset", requireAdmin, async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(`
      TRUNCATE
        te_task_events,
        te_task_revisions,
        te_task_editors,
        te_notifications,
        te_direct_messages,
        te_chat_messages,
        te_feed_reactions,
        te_feed_comments,
        te_feed_items,
        te_tasks
      CASCADE;
    `);
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

router.post("/admin/seed", requireAdmin, async (_req, res): Promise<void> => {
  // Fetch active editors and coordinators
  const editors = await db.select().from(usersTable)
    .where(eq(usersTable.role, "editor"));
  const coordinators = await db.select().from(usersTable)
    .where(or(eq(usersTable.role, "coordinator"), eq(usersTable.role, "admin")));

  if (editors.length === 0 || coordinators.length === 0) {
    res.status(400).json({ error: "Cadastre ao menos um editor e um coordenador antes de gerar amostras." });
    return;
  }

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const daysFrom = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const year = new Date().getFullYear() % 100;

  const nextSeq = async () => {
    const r = await db.execute<{ nextval: string }>(sql`SELECT nextval('te_task_number_seq') AS nextval`);
    return Number((r.rows ?? r)[0].nextval);
  };

  const COLORS = ["#6366f1","#3b82f6","#f97316","#22c55e","#e11d48","#a855f7","#f59e0b","#14b8a6","#ec4899","#64748b"];

  // Template: { title, client, description, priority, complexity, status, dueDays, revisions?, folderUrl? }
  const templates = [
    // ── pendentes ──
    { title: "Identidade Visual Completa", client: "Governo do Amapá", description: "Criar manual de identidade visual incluindo logotipo, paleta de cores, tipografia e aplicações.", priority: "high", complexity: "high", status: "pending", dueDays: 12 },
    { title: "Peças para Redes Sociais", client: "Clécio Luís", description: "Pack com 15 artes para Instagram e Facebook sobre campanha eleitoral 2026.", priority: "medium", complexity: "medium", status: "pending", dueDays: 5 },
    { title: "Motion Logo", client: "Compuway", description: "Animação de entrada do logotipo em After Effects. Versão escura e clara.", priority: "low", complexity: "medium", status: "pending", dueDays: 8 },

    // ── em edição ──
    { title: "Vídeo Institucional 2 min", client: "Mina Tucano", description: "Edição e finalização do vídeo institucional com narração e trilha.", priority: "high", complexity: "high", status: "in_progress", dueDays: 3, folderUrl: "\\\\servidor\\projetos\\mina-tucano\\video-institucional" },
    { title: "Banner Outdoor 9x3m", client: "Waldez Góes", description: "Arte para outdoor campanha governamental. Formato 9x3m, 300dpi.", priority: "high", complexity: "low", status: "in_progress", dueDays: 1 },
    { title: "Apresentação PowerPoint", client: "Você Telecom", description: "Template de apresentação institucional com 20 slides editáveis.", priority: "medium", complexity: "medium", status: "in_progress", dueDays: 6 },
    { title: "Cardápio Digital Interativo", client: "Alinny Serrão", description: "Cardápio em PDF interativo com links internos e ícones personalizados.", priority: "low", complexity: "low", status: "in_progress", dueDays: 10 },

    // ── em alteração ──
    { title: "Logotipo e Variações", client: "Davi Alcolumbre", description: "Redesign de logotipo com 3 propostas. Aprovado proposta 2, ajustar cores.", priority: "high", complexity: "medium", status: "in_revision", dueDays: 2, revisions: ["Mudar o azul do fundo para o pantone 286 C. O cliente não gostou do degradê."] },
    { title: "Folder Institucional A4", client: "Governo Federal", description: "Folder recto-verso para evento de inauguração.", priority: "medium", complexity: "low", status: "in_revision", dueDays: 4, revisions: ["Aumentar o logo no verso. Centralizar o texto da página 2. Remover a foto da direita."] },

    // ── em aprovação ──
    { title: "Campanha Mídia Exterior", client: "Clécio Luís", description: "Arte final para busdoor, backbus e empena.", priority: "high", complexity: "medium", status: "review", dueDays: 0 },
    { title: "Capa e Edição Revista", client: "Governo do Amapá", description: "Editoração completa revista de 32 páginas. Diagramação finalizada.", priority: "medium", complexity: "high", status: "review", dueDays: 2, folderUrl: "\\\\servidor\\projetos\\governo-ap\\revista-32pag" },
    { title: "Spot de Rádio 30s", client: "Waldez Góes", description: "Edição de áudio com locução, trilha e efeitos.", priority: "low", complexity: "low", status: "review", dueDays: 1 },

    // ── reaberta ──
    { title: "Vinheta TV 15s", client: "Você Telecom", description: "Vinheta animada para intervalo comercial. Revisão após exibição de teste.", priority: "high", complexity: "high", status: "reopened", dueDays: 3, revisions: ["Versão aprovada. Cliente pediu reabertura: adicionar versão em inglês.", "Adicionar legenda em inglês e adaptar o slogan para o mercado externo."] },

    // ── pausada ──
    { title: "Site Institucional WordPress", client: "Compuway", description: "Desenvolvimento e design de site com 8 páginas. Pausado aguardando conteúdo do cliente.", priority: "medium", complexity: "high", status: "paused", dueDays: 20 },

    // ── concluídas ──
    { title: "Posts Semana do Meio Ambiente", client: "Mina Tucano", description: "12 posts para semana de conscientização ambiental.", priority: "medium", complexity: "low", status: "completed", dueDays: -5 },
    { title: "Convite Digital Formatura", client: "Alinny Serrão", description: "Convite digital animado para formatura de medicina.", priority: "high", complexity: "medium", status: "completed", dueDays: -10 },
    { title: "Manual do Colaborador", client: "Governo Federal", description: "Diagramação de manual interno com 60 páginas.", priority: "low", complexity: "high", status: "completed", dueDays: -3, folderUrl: "\\\\servidor\\projetos\\gov-federal\\manual-colaborador" },

    // ── concluídas extras ──
    { title: "Thumbnail YouTube Pack", client: "Clécio Luís", description: "20 thumbnails para canal de YouTube da campanha.", priority: "medium", complexity: "low", status: "completed", dueDays: -7 },
    { title: "Reels Instagram × 5", client: "Mina Tucano", description: "Edição de 5 reels curtos de 30s com trilha e legenda.", priority: "high", complexity: "medium", status: "completed", dueDays: -14 },
    { title: "Crachás e Brindes Evento", client: "Governo do Amapá", description: "Layout de crachás, sacolas, canetas e banner de fundo para evento.", priority: "low", complexity: "low", status: "completed", dueDays: -20 },
    { title: "E-mail Marketing Corporativo", client: "Você Telecom", description: "Template HTML de e-mail marketing responsivo com 6 blocos editáveis.", priority: "medium", complexity: "medium", status: "completed", dueDays: -4 },
    { title: "Infográfico Relatório Anual", client: "Governo Federal", description: "6 infográficos de dados para relatório de gestão 2024.", priority: "high", complexity: "high", status: "completed", dueDays: -30, folderUrl: "\\\\servidor\\projetos\\gov-federal\\relatorio-anual" },

    // ── em aprovação extras ──
    { title: "Cartão de Visita Executivo", client: "Waldez Góes", description: "Frente e verso, papel 300g, hot stamping dourado.", priority: "high", complexity: "low", status: "review", dueDays: 0 },
    { title: "Proposta Comercial PDF", client: "Compuway", description: "Documento de proposta comercial com template da marca.", priority: "medium", complexity: "medium", status: "review", dueDays: 1 },
    { title: "Mapa de Empatia — Workshop", client: "Alinny Serrão", description: "Ilustrações para workshop de design thinking.", priority: "low", complexity: "medium", status: "review", dueDays: 3 },

    // ── atrasadas ──
    { title: "Flyer Evento Cultural", client: "Davi Alcolumbre", description: "Arte para flyer digital e impresso de evento cultural.", priority: "high", complexity: "low", status: "in_progress", dueDays: -3 },
    { title: "Roteiro e Storyboard Vídeo", client: "Mina Tucano", description: "Storyboard frame a frame de vídeo de 3 minutos.", priority: "high", complexity: "high", status: "in_progress", dueDays: -5 },
    { title: "Capa Relatório de Impacto", client: "Governo Federal", description: "Capa e contracapa para relatório de impacto social 2025.", priority: "medium", complexity: "medium", status: "in_revision", dueDays: -2, revisions: ["A foto da capa não foi aprovada pela assessoria. Substituir por imagem do banco interno."] },
    { title: "Adesivo Frota de Veículos", client: "Governo do Amapá", description: "Arte para envelopamento lateral de 12 veículos da frota.", priority: "high", complexity: "medium", status: "in_progress", dueDays: -7 },
    { title: "Animação Story 9×16", client: "Clécio Luís", description: "Pack de 8 stories animados para campanha de lançamento.", priority: "medium", complexity: "medium", status: "pending", dueDays: -1 },

    // ── rascunho ──
    { title: "Campanha Natal 2025", client: "Você Telecom", description: "Briefing recebido. Proposta de cronograma e peças a definir.", priority: "medium", complexity: "medium", status: "rascunho", dueDays: 30 },

    // ── cancelada ──
    { title: "Documentário 5 min", client: "Davi Alcolumbre", description: "Projeto cancelado pelo cliente por corte de verba.", priority: "high", complexity: "high", status: "cancelled", dueDays: -2 },
  ];

  const created: number[] = [];

  for (const tpl of templates) {
    const coord = pick(coordinators);
    const editor = pick(editors);
    const num = await nextSeq();
    const color = pick(COLORS);

    const isDraft = tpl.status === "rascunho";
    const isTerminal = ["completed", "cancelled"].includes(tpl.status);

    const [task] = await db.insert(tasksTable).values({
      taskNumber: num,
      taskYear: year,
      title: tpl.title,
      description: tpl.description ?? null,
      client: tpl.client ?? null,
      color,
      priority: tpl.priority as any,
      complexity: tpl.complexity as any,
      status: tpl.status,
      assignedToId: !isDraft ? editor.id : null,
      createdById: coord.id,
      dueDate: daysFrom(tpl.dueDays),
      folderUrl: (tpl as any).folderUrl ?? null,
      revisionCount: ((tpl as any).revisions?.length ?? 0),
    }).returning();

    // Task editors junction
    if (!isDraft) {
      await db.insert(taskEditorsTable).values({ taskId: task.id, userId: editor.id, assignedById: coord.id }).onConflictDoNothing();
    }

    // Revisions
    const revTexts: string[] = (tpl as any).revisions ?? [];
    for (let i = 0; i < revTexts.length; i++) {
      await db.insert(taskRevisionsTable).values({
        taskId: task.id,
        revisionNumber: i + 1,
        comment: revTexts[i],
        createdById: coord.id,
      });
    }

    // Task events (simulate status transitions)
    const STATUS_PATH: Record<string, string[]> = {
      pending:     ["pending"],
      in_progress: ["pending", "in_progress"],
      in_revision: ["pending", "in_progress", "in_revision"],
      review:      ["pending", "in_progress", "review"],
      reopened:    ["pending", "in_progress", "review", "completed", "reopened"],
      paused:      ["pending", "in_progress", "paused"],
      completed:   ["pending", "in_progress", "review", "completed"],
      cancelled:   ["pending", "cancelled"],
      rascunho:    [],
    };

    const path = STATUS_PATH[tpl.status] ?? [];
    for (let i = 1; i < path.length; i++) {
      const when = new Date();
      when.setDate(when.getDate() - (path.length - 1 - i) * 2);
      await db.insert(taskEventsTable).values({
        taskId: task.id,
        fromStatus: path[i - 1],
        toStatus: path[i],
        changedById: i % 2 === 0 ? coord.id : editor.id,
        createdAt: when,
      });
    }

    created.push(task.id);
  }

  broadcastTaskChange();
  res.json({ ok: true, created: created.length });
});

export default router;
