import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { db, taskFilesTable, tasksTable, taskEventsTable, usersTable, reviewCommentsTable, taskEditorsTable, taskCoordinatorsTable } from "@workspace/db";
import { notify } from "../lib/notify.js";
import { eq, and, inArray, sql } from "drizzle-orm";

async function notifyAllTaskCoords(
  task: { id: number; createdById: number | null },
  excludeUserId: number | null,
  type: string, title: string, message: string,
) {
  const coIds = await db
    .select({ userId: taskCoordinatorsTable.userId })
    .from(taskCoordinatorsTable)
    .where(eq(taskCoordinatorsTable.taskId, task.id));
  const targets = [...new Set([
    ...(task.createdById ? [task.createdById] : []),
    ...coIds.map(r => r.userId),
  ])].filter(id => id !== excludeUserId);
  await Promise.all(targets.map(uid => notify(uid, type, title, message, { taskId: task.id })));
}
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, requireCoordinator } from "../lib/auth.js";
import { broadcastTaskChange } from "../lib/broadcast.js";
import { generateThumbnail, transcodeFile } from "../lib/transcode.js";

const router = Router();

// ── Storage ───────────────────────────────────────────────────────────────────
const uploadsDir = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");

// Garante que o diretório base existe ao iniciar
fs.mkdirSync(uploadsDir, { recursive: true });

function taskFilesDir(taskId: number) {
  const dir = path.join(uploadsDir, "task-files", String(taskId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) { cb(null, uploadsDir); },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter(_req, file, cb) {
    const ok = file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/");
    ok ? cb(null, true) : cb(new Error("Apenas arquivos de vídeo ou áudio são permitidos"));
  },
});

// ── POST /api/tasks/:id/files ─────────────────────────────────────────────────
router.post("/tasks/:id/files", requireAuth, (req, res, next) => {
  upload.single("file")(req, res, err => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Arquivo muito grande (máx 500 MB)" }); return;
    }
    if (err) { res.status(400).json({ error: err.message }); return; }
    next();
  });
}, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }
  if (!req.file) { res.status(400).json({ error: "Arquivo não enviado" }); return; }

  const [task] = await db.select({ id: tasksTable.id, status: tasksTable.status, revisionCount: tasksTable.revisionCount, createdById: tasksTable.createdById, title: tasksTable.title })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { fs.unlinkSync(req.file.path); res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  // Move from tmp to task-specific folder
  const dir = taskFilesDir(taskId);
  const ext = path.extname(req.file.originalname).toLowerCase();
  const finalName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  const finalPath = path.join(dir, finalName);
  fs.renameSync(req.file.path, finalPath);

  const storagePath = `task-files/${taskId}/${finalName}`;

  const originalName = (req.body as { originalName?: string }).originalName?.trim() || req.file.originalname;

  const [file] = await db.insert(taskFilesTable).values({
    taskId,
    fileName:       req.file.originalname,
    originalName,
    fileSize:       req.file.size,
    mimeType:       req.file.mimetype,
    storagePath,
    uploadedById:   req.session.userId,
    revisionNumber: task.revisionCount ?? 0,
  }).returning();

  // Gera thumbnail imediatamente (bloqueia ~1-2s mas o card não fica preto)
  const thumbRel = await generateThumbnail(file.id, uploadsDir, storagePath);
  if (thumbRel) (file as any).thumbnailPath = thumbRel;

  // Dispara o resto do pipeline em background (faststart + proxy + HLS)
  transcodeFile(file.id, uploadsDir, storagePath).catch(err =>
    console.error("[transcode] background error", err)
  );

  const uploaderId = req.session.userId!;
  const [uploader] = await db.select({ name: usersTable.name, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, uploaderId));

  // in_progress → review: primeira entrega do editor
  if (task.status === "in_progress" && uploader?.role === "editor") {
    await db.update(tasksTable)
      .set({ status: "review", updatedAt: new Date() })
      .where(eq(tasksTable.id, taskId));
    await db.insert(taskEventsTable).values({
      taskId,
      fromStatus:  "in_progress",
      toStatus:    "review",
      changedById: uploaderId,
    });
    if (task.createdById) {
      const uploaderName = uploader.name?.split(" ")[0] ?? "Editor";
      await notifyAllTaskCoords(task, uploaderId,
        "review_new_version",
        "Entrega enviada para revisão",
        `${uploaderName} enviou a entrega de "${task.title}"`,
      );
    }
    broadcastTaskChange();
  }

  // review + nova versão: registra no lifecycle e notifica coordenador
  if (task.status === "review") {
    await db.insert(taskEventsTable).values({
      taskId,
      fromStatus:  "review",
      toStatus:    "file_uploaded",
      changedById: uploaderId,
      meta: JSON.stringify({
        fileName:       originalName || req.file!.originalname,
        mimeType:       req.file!.mimetype,
        revisionNumber: task.revisionCount ?? 0,
      }),
    });

    if (uploader?.role === "editor" && task.createdById) {
      const uploaderName = uploader.name?.split(" ")[0] ?? "Editor";
      await notifyAllTaskCoords(task, uploaderId,
        "review_new_version",
        "Nova versão enviada",
        `${uploaderName} enviou uma nova versão de "${task.title}"`,
      );
    }
    broadcastTaskChange();
  }

  res.status(201).json(formatFile(file));
});

// ── GET /api/tasks/:id/files ──────────────────────────────────────────────────
router.get("/tasks/:id/files", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const approverTable = alias(usersTable, "approver");

  const files = await db
    .select({
      id:             taskFilesTable.id,
      taskId:         taskFilesTable.taskId,
      fileName:       taskFilesTable.fileName,
      fileSize:       taskFilesTable.fileSize,
      mimeType:       taskFilesTable.mimeType,
      storagePath:    taskFilesTable.storagePath,
      publicToken:    taskFilesTable.publicToken,
      revisionNumber:   taskFilesTable.revisionNumber,
      fileOrder:        taskFilesTable.fileOrder,
      originalName:     taskFilesTable.originalName,
      thumbnailPath:    taskFilesTable.thumbnailPath,
      proxyPath:        taskFilesTable.proxyPath,
      hlsPath:          taskFilesTable.hlsPath,
      processingStatus: taskFilesTable.processingStatus,
      createdAt:        taskFilesTable.createdAt,
      uploadedById:   taskFilesTable.uploadedById,
      uploaderName:   usersTable.name,
      approvedAt:     taskFilesTable.approvedAt,
      approvedById:   taskFilesTable.approvedById,
      approvedByName: approverTable.name,
    })
    .from(taskFilesTable)
    .leftJoin(usersTable,     eq(taskFilesTable.uploadedById, usersTable.id))
    .leftJoin(approverTable,  eq(taskFilesTable.approvedById, approverTable.id))
    .where(eq(taskFilesTable.taskId, taskId))
    .orderBy(
      sql`${taskFilesTable.fileOrder} NULLS LAST`,
      taskFilesTable.revisionNumber,
      taskFilesTable.createdAt,
    );

  res.json(files.map(f => ({
    ...formatFile(f),
    uploaderName:   f.uploaderName   ?? null,
    approvedAt:     f.approvedAt?.toISOString() ?? null,
    approvedByName: f.approvedByName ?? null,
  })));
});

// ── PATCH /api/tasks/:id/files/approve ───────────────────────────────────────
router.patch("/tasks/:id/files/approve", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { fileIds } = req.body as { fileIds: number[] };
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    res.status(400).json({ error: "Selecione ao menos um arquivo" }); return;
  }

  const userId = req.session.userId!;
  const now    = new Date();

  // Remove aprovação de versões anteriores do mesmo ativo antes de aprovar a atual
  const [target] = await db.select({ fileName: taskFilesTable.fileName })
    .from(taskFilesTable).where(inArray(taskFilesTable.id, fileIds)).limit(1);
  if (target?.fileName) {
    await db.update(taskFilesTable)
      .set({ approvedAt: null, approvedById: null })
      .where(and(eq(taskFilesTable.taskId, taskId), eq(taskFilesTable.fileName, target.fileName)));
  }

  await db.update(taskFilesTable)
    .set({ approvedAt: now, approvedById: userId })
    .where(and(eq(taskFilesTable.taskId, taskId), inArray(taskFilesTable.id, fileIds)));

  res.json({ ok: true });
});

// ── PATCH /api/tasks/:id/files/reorder ───────────────────────────────────────
router.patch("/tasks/:id/files/reorder", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  if (isNaN(taskId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const { order } = req.body as { order: number[] };
  if (!Array.isArray(order) || order.length === 0) {
    res.status(400).json({ error: "order deve ser um array de IDs" }); return;
  }

  // Atualiza fileOrder de cada arquivo na posição correspondente
  await Promise.all(order.map((fileId, idx) =>
    db.update(taskFilesTable)
      .set({ fileOrder: idx })
      .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)))
  ));

  res.json({ ok: true });
});

// ── DELETE /api/tasks/:id/files/:fileId ───────────────────────────────────────
router.delete("/tasks/:id/files/:fileId", requireAuth, async (req, res): Promise<void> => {
  const taskId  = parseInt(req.params.id, 10);
  const fileId  = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [file] = await db.select().from(taskFilesTable)
    .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file) { res.status(404).json({ error: "Arquivo não encontrado" }); return; }

  const userId = req.session.userId!;
  const role   = req.session.userRole!;
  const isCoord = ["admin","supervisor","coordinator"].includes(role);

  if (!isCoord) {
    // Editor só pode deletar se for o uploader ou estiver atribuído à tarefa
    const isOwner = file.uploadedById === userId;
    if (!isOwner) {
      const [task] = await db.select({ assignedToId: tasksTable.assignedToId })
        .from(tasksTable).where(eq(tasksTable.id, taskId));
      const [extra] = await db.select({ userId: taskEditorsTable.userId })
        .from(taskEditorsTable)
        .where(and(eq(taskEditorsTable.taskId, taskId), eq(taskEditorsTable.userId, userId)));
      const isAssigned = task?.assignedToId === userId || !!extra;
      if (!isAssigned) { res.status(403).json({ error: "Sem permissão" }); return; }
    }
  }

  // Remove comentários e anotações vinculados ao arquivo
  await db.delete(reviewCommentsTable)
    .where(eq(reviewCommentsTable.taskFileId, fileId));

  // Remove physical file
  const fullPath = path.join(uploadsDir, file.storagePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  await db.delete(taskFilesTable)
    .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));

  // Se era o último arquivo da tarefa e ela estava em review → voltar para in_progress
  // Silenciosamente: sem evento de histórico, sem notificação push
  const remaining = await db.select({ id: taskFilesTable.id })
    .from(taskFilesTable).where(eq(taskFilesTable.taskId, taskId));

  if (remaining.length === 0) {
    const [task] = await db.select({ status: tasksTable.status })
      .from(tasksTable).where(eq(tasksTable.id, taskId));
    if (task?.status === "review") {
      await db.update(tasksTable)
        .set({ status: "in_progress" })
        .where(eq(tasksTable.id, taskId));
      broadcastTaskChange();
    }
  }

  res.json({ ok: true });
});

// ── POST /api/tasks/:id/files/:fileId/share ───────────────────────────────────
router.post("/tasks/:id/files/:fileId/share", requireCoordinator, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [file] = await db.select().from(taskFilesTable)
    .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file) { res.status(404).json({ error: "Arquivo não encontrado" }); return; }

  const token = file.publicToken ?? crypto.randomUUID();
  const [updated] = await db.update(taskFilesTable)
    .set({ publicToken: token })
    .where(eq(taskFilesTable.id, fileId))
    .returning();

  res.json({ token: updated.publicToken });
});

// ── DELETE /api/tasks/:id/files/:fileId/share — revoga link ──────────────────
router.delete("/tasks/:id/files/:fileId/share", requireCoordinator, async (req, res): Promise<void> => {
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(fileId)) { res.status(400).json({ error: "ID inválido" }); return; }

  await db.update(taskFilesTable).set({ publicToken: null }).where(eq(taskFilesTable.id, fileId));
  res.json({ ok: true });
});

// ── GET /api/public/:token — info pública (sem auth) ─────────────────────────
router.get("/public/:token", async (req, res): Promise<void> => {
  const [file] = await db
    .select({
      id: taskFilesTable.id,
      fileName: taskFilesTable.fileName,
      fileSize: taskFilesTable.fileSize,
      mimeType: taskFilesTable.mimeType,
      storagePath: taskFilesTable.storagePath,
      taskId: taskFilesTable.taskId,
      taskTitle: tasksTable.title,
      taskCode: tasksTable.taskNumber,
      taskYear: tasksTable.taskYear,
      client: tasksTable.client,
    })
    .from(taskFilesTable)
    .leftJoin(tasksTable, eq(taskFilesTable.taskId, tasksTable.id))
    .where(eq(taskFilesTable.publicToken, req.params.token));

  if (!file) { res.status(404).json({ error: "Link inválido ou expirado" }); return; }

  const code = file.taskCode && file.taskYear
    ? `${String(file.taskCode).padStart(3,"0")}.${String(file.taskYear).padStart(2,"0")}`
    : null;

  res.json({
    id: file.id,
    fileName: file.fileName,
    fileSize: file.fileSize,
    mimeType: file.mimeType,
    taskTitle: file.taskTitle,
    taskCode: code,
    client: file.client,
    streamUrl: `/api/public/${req.params.token}/stream`,
  });
});

// ── GET /api/public/:token/stream — streaming com suporte a Range ─────────────
router.get("/public/:token/stream", async (req, res): Promise<void> => {
  const [file] = await db.select({ storagePath: taskFilesTable.storagePath, mimeType: taskFilesTable.mimeType, fileName: taskFilesTable.fileName })
    .from(taskFilesTable).where(eq(taskFilesTable.publicToken, req.params.token));

  if (!file) { res.status(404).end(); return; }

  const filePath = path.join(uploadsDir, file.storagePath);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado no servidor" }); return; }

  const stat    = fs.statSync(filePath);
  const total   = stat.size;
  const range   = req.headers.range;
  const mime    = file.mimeType ?? "application/octet-stream";

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : total - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range":  `bytes ${start}-${end}/${total}`,
      "Accept-Ranges":  "bytes",
      "Content-Length": chunkSize,
      "Content-Type":   mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": total,
      "Content-Type":   mime,
      "Accept-Ranges":  "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── GET /api/public/:token/download ──────────────────────────────────────────
router.get("/public/:token/download", async (req, res): Promise<void> => {
  const [file] = await db.select({ storagePath: taskFilesTable.storagePath, mimeType: taskFilesTable.mimeType, fileName: taskFilesTable.fileName })
    .from(taskFilesTable).where(eq(taskFilesTable.publicToken, req.params.token));

  if (!file) { res.status(404).end(); return; }

  const filePath = path.join(uploadsDir, file.storagePath);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado" }); return; }

  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
  res.setHeader("Content-Type", file.mimeType ?? "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

// ── GET /api/tasks/:id/files/:fileId/stream — streaming autenticado com Range ─
router.get("/tasks/:id/files/:fileId/stream", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [file] = await db.select().from(taskFilesTable)
    .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file) { res.status(404).json({ error: "Arquivo não encontrado" }); return; }

  const filePath = path.join(uploadsDir, file.storagePath);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado no servidor" }); return; }

  const stat  = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  const mime  = file.mimeType ?? "application/octet-stream";

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : total - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range":  `bytes ${start}-${end}/${total}`,
      "Accept-Ranges":  "bytes",
      "Content-Length": chunkSize,
      "Content-Type":   mime,
      "Cache-Control":  "private, max-age=3600",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": total,
      "Content-Type":   mime,
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "private, max-age=3600",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── GET /api/tasks/:id/files/:fileId/download — autenticado ──────────────────
router.get("/tasks/:id/files/:fileId/download", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [file] = await db.select().from(taskFilesTable)
    .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file) { res.status(404).json({ error: "Arquivo não encontrado" }); return; }

  const filePath = path.join(uploadsDir, file.storagePath);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Arquivo não encontrado no servidor" }); return; }

  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
  res.setHeader("Content-Type", file.mimeType ?? "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

// ── GET /api/tasks/:id/files/:fileId/thumbnail ───────────────────────────────
router.get("/tasks/:id/files/:fileId/thumbnail", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).end(); return; }

  const [file] = await db.select({ thumbnailPath: taskFilesTable.thumbnailPath })
    .from(taskFilesTable).where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file?.thumbnailPath) { res.status(404).end(); return; }

  const p = path.join(uploadsDir, file.thumbnailPath);
  if (!fs.existsSync(p)) { res.status(404).end(); return; }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=86400");
  fs.createReadStream(p).pipe(res);
});

// ── GET /api/tasks/:id/files/:fileId/proxy/stream ────────────────────────────
router.get("/tasks/:id/files/:fileId/proxy/stream", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).end(); return; }

  const [file] = await db.select({ proxyPath: taskFilesTable.proxyPath, storagePath: taskFilesTable.storagePath, mimeType: taskFilesTable.mimeType })
    .from(taskFilesTable).where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file) { res.status(404).end(); return; }

  // Serve proxy se disponível, senão cai no stream original
  const filePath = path.join(uploadsDir, file.proxyPath ?? file.storagePath);
  if (!fs.existsSync(filePath)) { res.status(404).end(); return; }

  const stat  = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  const mime  = file.proxyPath ? "video/mp4" : (file.mimeType ?? "video/mp4");

  if (range) {
    const [s, e] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(s, 10), end = e ? parseInt(e, 10) : total - 1;
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${total}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Type": mime, "Cache-Control": "private, max-age=3600" });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": total, "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── GET /api/tasks/:id/files/:fileId/hls/:segment — manifesto e segmentos HLS ─
router.get("/tasks/:id/files/:fileId/hls/*segment", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.id, 10);
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(taskId) || isNaN(fileId)) { res.status(400).end(); return; }

  const [file] = await db.select({ hlsPath: taskFilesTable.hlsPath })
    .from(taskFilesTable).where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));
  if (!file?.hlsPath) { res.status(404).end(); return; }

  const hlsDir  = path.dirname(path.join(uploadsDir, file.hlsPath));
  const raw = (req.params as any).segment;
  const segment = Array.isArray(raw) ? raw.join("/") : (raw as string);
  const filePath = path.join(hlsDir, segment);

  // Segurança: não deixar sair do diretório HLS
  if (!filePath.startsWith(hlsDir)) { res.status(403).end(); return; }
  if (!fs.existsSync(filePath))     { res.status(404).end(); return; }

  const ext  = path.extname(filePath);
  const mime = ext === ".m3u8" ? "application/vnd.apple.mpegurl" : "video/MP2T";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", ext === ".ts" ? "private, max-age=86400" : "no-cache");
  fs.createReadStream(filePath).pipe(res);
});

// ── Helper ────────────────────────────────────────────────────────────────────
function formatFile(f: typeof taskFilesTable.$inferSelect & { uploaderName?: string | null }) {
  return {
    id:               f.id,
    taskId:           f.taskId,
    fileName:         f.fileName,
    fileSize:         f.fileSize,
    mimeType:         f.mimeType,
    publicToken:      f.publicToken ?? null,
    revisionNumber:   f.revisionNumber,
    fileOrder:        f.fileOrder ?? null,
    originalName:     f.originalName ?? null,
    thumbnailPath:    f.thumbnailPath ?? null,
    proxyPath:        f.proxyPath ?? null,
    hlsPath:          f.hlsPath ?? null,
    processingStatus: f.processingStatus ?? "ready",
    createdAt:        f.createdAt,
    uploadedById:     f.uploadedById,
    uploaderName:     f.uploaderName ?? null,
    approvedAt:       (f as any).approvedAt ?? null,
    approvedByName:   (f as any).approvedByName ?? null,
  };
}

export default router;
