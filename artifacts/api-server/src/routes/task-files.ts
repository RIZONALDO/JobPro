import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { db, taskFilesTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, requireCoordinator } from "../lib/auth.js";

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

  const [task] = await db.select({ id: tasksTable.id, revisionCount: tasksTable.revisionCount })
    .from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { fs.unlinkSync(req.file.path); res.status(404).json({ error: "Tarefa não encontrada" }); return; }

  // Move from tmp to task-specific folder
  const dir = taskFilesDir(taskId);
  const ext = path.extname(req.file.originalname).toLowerCase();
  const finalName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  const finalPath = path.join(dir, finalName);
  fs.renameSync(req.file.path, finalPath);

  const storagePath = `task-files/${taskId}/${finalName}`;

  const [file] = await db.insert(taskFilesTable).values({
    taskId,
    fileName:       req.file.originalname,
    fileSize:       req.file.size,
    mimeType:       req.file.mimetype,
    storagePath,
    uploadedById:   req.session.userId,
    revisionNumber: task.revisionCount ?? 0,
  }).returning();

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
      revisionNumber: taskFilesTable.revisionNumber,
      createdAt:      taskFilesTable.createdAt,
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
    .orderBy(taskFilesTable.createdAt);

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

  await db.update(taskFilesTable)
    .set({ approvedAt: now, approvedById: userId })
    .where(and(eq(taskFilesTable.taskId, taskId), inArray(taskFilesTable.id, fileIds)));

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
  const isOwner = file.uploadedById === userId;
  const isCoord = ["admin","supervisor","coordinator"].includes(role);
  if (!isOwner && !isCoord) { res.status(403).json({ error: "Sem permissão" }); return; }

  // Remove physical file
  const fullPath = path.join(uploadsDir, file.storagePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  await db.delete(taskFilesTable)
    .where(and(eq(taskFilesTable.id, fileId), eq(taskFilesTable.taskId, taskId)));

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

// ── Helper ────────────────────────────────────────────────────────────────────
function formatFile(f: typeof taskFilesTable.$inferSelect & { uploaderName?: string | null }) {
  return {
    id:             f.id,
    taskId:         f.taskId,
    fileName:       f.fileName,
    fileSize:       f.fileSize,
    mimeType:       f.mimeType,
    publicToken:    f.publicToken ?? null,
    revisionNumber: f.revisionNumber,
    createdAt:      f.createdAt,
    uploadedById:   f.uploadedById,
    uploaderName:   f.uploaderName ?? null,
    approvedAt:     (f as any).approvedAt ?? null,
    approvedByName: (f as any).approvedByName ?? null,
  };
}

export default router;
