import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { sessionMiddleware } from "./lib/session.js";
import { setIo } from "./lib/io.js";
import { db, userPresenceTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcastPresence } from "./lib/broadcast.js";

const port = parseInt(process.env.PORT ?? "8089", 10);
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
});

setIo(io);

// Compartilhar sessão Express com Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request as any, {} as any, next);
});

// Autenticar socket pela sessão existente
io.use((socket, next) => {
  const req = socket.request as any;
  const userId = req.session?.userId;
  if (!userId) { next(new Error("Unauthorized")); return; }
  socket.data.userId = userId;
  socket.data.role = req.session.userRole;
  next();
});

io.on("connection", (socket) => {
  const userId: number = socket.data.userId;
  socket.join(`user:${userId}`);
  logger.debug({ userId, socketId: socket.id }, "socket connected");

  socket.on("disconnect", async () => {
    try {
      // Check if user has other active sockets before marking offline
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      if (sockets.length === 0) {
        await db
          .insert(userPresenceTable)
          .values({ userId, lastSeenAt: new Date(), isOnline: false })
          .onConflictDoUpdate({
            target: userPresenceTable.userId,
            set: { isOnline: false },
          });
        const [user] = await db
          .select({ id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl })
          .from(usersTable)
          .where(eq(usersTable.id, userId));
        if (user) broadcastPresence(userId, false, user);
      }
    } catch {}
    logger.debug({ userId, socketId: socket.id }, "socket disconnected");
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "TeamEdit API server started");
});
