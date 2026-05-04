import { Router } from "express";
import authRouter from "./auth.js";
import projectsRouter from "./projects.js";
import jobsRouter from "./jobs.js";
import tasksRouter from "./tasks.js";
import usersRouter from "./users.js";
import settingsRouter from "./settings.js";
import notificationsRouter from "./notifications.js";
import feedRouter from "./feed.js";
import dmRouter from "./dm.js";

const router = Router();
router.use(authRouter);
router.use(projectsRouter);
router.use(jobsRouter);
router.use(tasksRouter);
router.use(usersRouter);
router.use(settingsRouter);
router.use(notificationsRouter);
router.use(feedRouter);
router.use(dmRouter);

export default router;
