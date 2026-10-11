import "server-only";
import { neon } from "@neondatabase/serverless";

type Row = Record<string, any>;
let _neon: ReturnType<typeof neon> | undefined;
let _pool: any;

/** Tagged template: sql`select * from t where id = ${id}`. Neon (HTTP) em produção; `pg` só para Postgres local. */
export async function sql(strings: TemplateStringsArray, ...values: any[]): Promise<Row[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  if (/neon\.tech/.test(url)) { _neon ??= neon(url); return (await _neon(strings, ...values)) as Row[]; }
  _pool ??= new (await import("pg")).default.Pool({ connectionString: url });
  return (await _pool.query(strings.reduce((a, s, i) => a + "$" + i + s), values)).rows;
}

/** jsonb pode chegar já convertido (objeto) ou como texto, dependendo do driver. */
export const json = (v: any) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };
export const iso = (v: any) => (v == null ? null : new Date(v).toISOString());
