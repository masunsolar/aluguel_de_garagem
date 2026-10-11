import { readFileSync } from "node:fs";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Defina DATABASE_URL (ex.: no .env.local).");
const chunks = readFileSync(new URL("./schema.sql", import.meta.url), "utf8").split(/\n-- GO\n/).map((s) => s.trim()).filter(Boolean);
if (/neon\.tech/.test(url)) {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  for (const c of chunks) await sql.query(c);
} else {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url }); await c.connect();
  for (const s of chunks) await c.query(s);
  await c.end();
}
console.log("Banco pronto.");
