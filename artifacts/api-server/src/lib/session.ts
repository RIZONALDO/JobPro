import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const PgSession = ConnectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgSession({ pool, createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET ?? "teamedit-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: "lax" },
});
