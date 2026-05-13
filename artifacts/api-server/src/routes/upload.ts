import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    cb(null, file.mimetype.startsWith("image/"));
  },
});

const uploadsDir = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");

router.post("/upload/avatar", requireAuth, upload.single("avatar"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "Arquivo não enviado" }); return; }

  const userId = req.session.userId!;
  const avatarDir = path.join(uploadsDir, "avatars");
  fs.mkdirSync(avatarDir, { recursive: true });

  const ext = req.file.mimetype === "image/webp" ? "webp"
    : req.file.mimetype === "image/png" ? "png" : "jpg";
  const filename = `user-${userId}.${ext}`;
  const filepath = path.join(avatarDir, filename);
  fs.writeFileSync(filepath, req.file.buffer);

  const url = `/uploads/avatars/${filename}`;
  await db.update(usersTable).set({ avatarUrl: url }).where(eq(usersTable.id, userId));

  res.json({ url });
});

export default router;
