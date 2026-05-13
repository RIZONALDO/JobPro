import { Router } from "express";
import authRouter from "./auth.js";
import tasksRouter from "./tasks.js";
import usersRouter from "./users.js";
import settingsRouter from "./settings.js";
import notificationsRouter from "./notifications.js";
import feedRouter from "./feed.js";
import dmRouter from "./dm.js";
import clientsRouter from "./clients.js";
import uploadRouter from "./upload.js";

const router = Router();
router.use(authRouter);
router.use(tasksRouter);
router.use(usersRouter);
router.use(settingsRouter);
router.use(notificationsRouter);
router.use(feedRouter);
router.use(dmRouter);
router.use(clientsRouter);
router.use(uploadRouter);

export default router;
