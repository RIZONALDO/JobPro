import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { sessionMiddleware } from "./lib/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.set("trust proxy", 1);

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(sessionMiddleware);
app.use("/api", router);

// Serve uploaded files (avatars, etc.) — survives deploys
// Use process.cwd() so this works regardless of __dirname nesting in the build
const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsDir, { maxAge: "7d" }));

if (process.env.NODE_ENV === "production") {
  const frontendDir = path.resolve(__dirname, "../../team-edit/dist/public");
  app.use(express.static(frontendDir));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(frontendDir, "index.html")));
}

export default app;
