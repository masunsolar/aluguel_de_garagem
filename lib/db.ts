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

/** Uma consulta para `tx`: q`select ...` monta a consulta sem executar. */
export type Query = { strings: TemplateStringsArray; values: any[] };
export const q = (strings: TemplateStringsArray, ...values: any[]): Query => ({ strings, values });

/**
 * Várias consultas numa ÚNICA transação (tudo ou nada), na ordem. Devolve as linhas de cada uma.
 * Neon: transação não interativa via HTTP (não dá para decidir algo no meio; a lógica fica no SQL).
 * READ COMMITTED: cada consulta vê o que as anteriores (e um lock adquirido antes) já garantiram.
 */
export async function tx(queries: Query[]): Promise<Row[][]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  if (/neon\.tech/.test(url)) {
    _neon ??= neon(url);
    const n = _neon;
    return (await n.transaction(queries.map((x) => n(x.strings, ...x.values)))) as Row[][];
  }
  _pool ??= new (await import("pg")).default.Pool({ connectionString: url });
  const client = await _pool.connect();
  try {
    await client.query("begin");
    const out: Row[][] = [];
    for (const x of queries) out.push((await client.query(x.strings.reduce((a, s, i) => a + "$" + i + s), x.values)).rows);
    await client.query("commit");
    return out;
  } catch (e) { await client.query("rollback").catch(() => {}); throw e; }
  finally { client.release(); }
}

/** jsonb pode chegar já convertido (objeto) ou como texto, dependendo do driver. */
export const json = (v: any) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };
export const iso = (v: any) => (v == null ? null : new Date(v).toISOString());
