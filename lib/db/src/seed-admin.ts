import bcrypt from "bcryptjs";
import { db, usersTable } from "./index.js";

const hash = await bcrypt.hash("admin123", 10);
await db.insert(usersTable).values({
  name: "Administrador",
  login: "admin",
  passwordHash: hash,
  role: "admin",
  mustChangePassword: true,
}).onConflictDoNothing();

console.log("Admin criado: login=admin senha=admin123 (altere no primeiro acesso)");
process.exit(0);
