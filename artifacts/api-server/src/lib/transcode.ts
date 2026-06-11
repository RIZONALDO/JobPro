import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { db, taskFilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcastTaskChange } from "./broadcast.js";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: "pipe" });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`)));
  });
}

function dur(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { stdio: "pipe" });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(parseFloat(out) || 0));
  });
}

// ── Thumbnail rápido — chamado inline no upload, antes de retornar a resposta ─

export async function generateThumbnail(
  fileId: number,
  uploadsDir: string,
  storagePath: string,
): Promise<string | null> {
  const inputPath = path.join(uploadsDir, storagePath);
  if (!fs.existsSync(inputPath)) return null;

  const taskDir   = path.dirname(inputPath);
  const base      = path.basename(storagePath, path.extname(storagePath));
  const thumbPath = path.join(taskDir, `thumb-${base}.jpg`);

  try {
    const totalSec = await dur(inputPath);
    const thumbSec = Math.max(1, Math.floor(totalSec * 0.1));
    await run([
      "-y", "-ss", String(thumbSec), "-i", inputPath,
      "-vframes", "1", "-q:v", "3", "-vf", "scale=640:-2",
      thumbPath,
    ]);
    const rel = path.relative(uploadsDir, thumbPath);
    await db.update(taskFilesTable)
      .set({ thumbnailPath: rel })
      .where(eq(taskFilesTable.id, fileId));
    return rel;
  } catch {
    return null;
  }
}

// ── Pipeline principal (background) ──────────────────────────────────────────

export async function transcodeFile(fileId: number, uploadsDir: string, storagePath: string): Promise<void> {
  const inputPath = path.join(uploadsDir, storagePath);
  if (!fs.existsSync(inputPath)) return;

  const taskDir = path.dirname(inputPath);
  const base    = path.basename(storagePath, path.extname(storagePath));
  const hlsDir  = path.join(taskDir, `hls-${base}`);
  fs.mkdirSync(hlsDir, { recursive: true });

  await db.update(taskFilesTable)
    .set({ processingStatus: "processing" })
    .where(eq(taskFilesTable.id, fileId));

  broadcastTaskChange();

  try {
    // 1 — faststart: move moov atom para o início
    const faststartTmp = inputPath + ".fast.mp4";
    await run(["-y", "-i", inputPath, "-movflags", "faststart", "-c", "copy", faststartTmp]);
    fs.renameSync(faststartTmp, inputPath);

    // 2 — thumbnail (só se ainda não foi gerado inline no upload)
    const taskDir2  = path.dirname(inputPath);
    const base2     = path.basename(storagePath, path.extname(storagePath));
    const thumbPath = path.join(taskDir2, `thumb-${base2}.jpg`);
    const rel       = (p: string) => path.relative(uploadsDir, p);

    if (!fs.existsSync(thumbPath)) {
      const totalSec = await dur(inputPath);
      const thumbSec = Math.max(1, Math.floor(totalSec * 0.1));
      await run([
        "-y", "-ss", String(thumbSec), "-i", inputPath,
        "-vframes", "1", "-q:v", "3", "-vf", "scale=640:-2",
        thumbPath,
      ]);
      await db.update(taskFilesTable)
        .set({ thumbnailPath: rel(thumbPath) })
        .where(eq(taskFilesTable.id, fileId));
      broadcastTaskChange();
    }

    // 3 — proxy 360p (mp4, para card hover — arquivo pequeno)
    const proxyPath = path.join(taskDir, `proxy-${base}.mp4`);
    await run([
      "-y", "-i", inputPath,
      "-vf", "scale=640:-2",
      "-c:v", "libx264", "-crf", "28", "-preset", "fast", "-tune", "fastdecode",
      "-movflags", "faststart",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      proxyPath,
    ]);

    // 4 — HLS: 360p + 720p + playlist master
    const hls360  = path.join(hlsDir, "360p.m3u8");
    const hls720  = path.join(hlsDir, "720p.m3u8");
    const master  = path.join(hlsDir, "master.m3u8");

    await run([
      "-y", "-i", inputPath,
      "-vf", "scale=640:-2",
      "-c:v", "libx264", "-crf", "26", "-preset", "fast",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2",
      "-hls_time", "6", "-hls_list_size", "0",
      "-hls_segment_filename", path.join(hlsDir, "360p_%04d.ts"),
      hls360,
    ]);

    await run([
      "-y", "-i", inputPath,
      "-vf", "scale=1280:-2",
      "-c:v", "libx264", "-crf", "23", "-preset", "fast",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2",
      "-hls_time", "6", "-hls_list_size", "0",
      "-hls_segment_filename", path.join(hlsDir, "720p_%04d.ts"),
      hls720,
    ]);

    fs.writeFileSync(master, [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"',
      "360p.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,NAME="720p"',
      "720p.m3u8",
    ].join("\n") + "\n");

    // Publica proxy + HLS — card fica totalmente pronto
    await db.update(taskFilesTable).set({
      proxyPath:        rel(proxyPath),
      hlsPath:          rel(master),
      processingStatus: "ready",
    }).where(eq(taskFilesTable.id, fileId));

  } catch (err) {
    console.error(`[transcode] fileId=${fileId}`, err);
    await db.update(taskFilesTable)
      .set({ processingStatus: "error" })
      .where(eq(taskFilesTable.id, fileId));
  }

  broadcastTaskChange();
}
