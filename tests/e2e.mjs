// Testes ponta a ponta contra o servidor de PRODUÇÃO (next build && next start) e um Postgres real.
// Use um banco de TESTE (a suíte grava dados). Uso: npm run db:init && npm run build && PORT=3100 npm start  ->  npm test
import assert from "node:assert/strict";
import pg from "pg";
import { SignJWT } from "jose";

const BASE = process.env.BASE ?? "http://localhost:3100";
const PASS = process.env.TEST_ADMIN_PASSWORD; // a senha cujo hash está em ADMIN_PASSWORD_HASH (use um banco/senha de TESTE)
if (!PASS) throw new Error("Defina TEST_ADMIN_PASSWORD (a senha de teste do admin). Veja o README.");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
await db.query("delete from rate_limits");
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
const tok = (aud, payload, secret = key) => new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setAudience(aud).setExpirationTime("1h").sign(secret);

// Datas relativas a hoje (Brasília) para respeitar a janela de antecedência
const D = (n) => new Date(Date.now() + n * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
const Z = (d, hm) => new Date(`${d}T${hm}:00-03:00`).toISOString();
const iso = (d, t) => `${d}T${t}:00-03:00`;

let ipc = 0;
async function call(method, path, { body, jar, ip, form } = {}) {
  const headers = { "x-forwarded-for": ip ?? `10.1.${(++ipc >> 8) & 255}.${ipc & 255}` };
  if (jar) headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  let b; if (form) b = form; else if (body !== undefined) { headers["content-type"] = "application/json"; b = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: b, redirect: "manual" });
  const setc = r.headers.getSetCookie();
  for (const c of setc) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (jar) { if (!v || /Max-Age=0/i.test(c)) delete jar[k]; else jar[k] = v; } }
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers, setc };
}
const car = { name: "João Silva", apartment: "101", carBrand: "Fiat", carModel: "Argo", carColor: "Prata", plate: "ABC1D23" };
const book = (sd, st, ed, et, o = {}) => call("POST", "/api/reservations", { body: { startDate: sd, startTime: st, endDate: ed, endTime: et, ...car, ...(o.extra ?? {}) }, jar: o.jar, ip: o.ip });
const JPEG = (n = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1), Buffer.from([0xff, 0xd9])]);
const upload = (id, buf, jar, name = "f.jpg") => { const f = new FormData(); f.append("file", new Blob([buf]), name); return call("POST", `/api/admin/reservations/${id}/photos`, { form: f, jar }); };
const login = async (jar) => { const r = await call("POST", "/api/admin/login", { body: { password: PASS }, jar }); eq(r.status, 200); return r; };
const detail = async (id) => (await call("GET", `/api/admin/reservations/${id}`, { jar: ADM })).json;
const dbRow = async (id) => (await db.query("select * from reservations where id=$1", [id])).rows[0];
const cfg = (over = {}) => ({ garageName: "Garagem", maximumReservationAdvanceDays: 60, pricing: { dayPrice: 30, nightPrice: 15, dayStartHour: 6, nightStartHour: 18 }, ...over });

let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "\n      ", String(e.message).split("\n").slice(0, 3).join(" | ")); } }
const eq = assert.equal;
const A = {}, B = {}, ADM = {};
let resA, resA2, code, mid;

// ================= VIZINHO =================
await test("home abre e mostra o nome da garagem", async () => { const r = await call("GET", "/"); eq(r.status, 200); assert.match(r.text, /Garagem/); });
await test("config pública: padrão de 14 dias de antecedência e preços R$30/R$15", async () => {
  const c = (await call("GET", "/api/config")).json; eq(c.maximumReservationAdvanceDays, 14); eq(c.pricing.dayPrice, 30); eq(c.pricing.nightPrice, 15); });
await test("disponibilidade inicial vazia", async () => { assert.deepEqual((await call("GET", "/api/availability")).json, []); });
await test("antecedência PADRÃO (14 dias) vale no servidor, não só na tela: dia+15 → 400, dia+14 → 201", async () => {
  const r = await book(D(15), "10:00", D(15), "12:00"); eq(r.status, 400); assert.match(r.json.error, /14 dias/);
  eq((await book(D(14), "10:00", D(14), "12:00")).status, 201); });
await test("admin faz login e muda a antecedência máxima para 60 (configuração, não constante no código)", async () => {
  await login(ADM); eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200);
  eq((await call("GET", "/api/config")).json.maximumReservationAdvanceDays, 60);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 0 }) })).status, 400);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 999 }) })).status, 400); });
await test("preço 18:00→10:00 do dia seguinte = R$15 (check-out até 10:30 não cobra a manhã); fuso salvo corretamente em UTC", async () => {
  const r = await book(D(20), "18:00", D(21), "10:00", { jar: A }); eq(r.status, 201); eq(r.json.totalCents, 1500); resA = r.json; code = r.json.code;
  const { rows } = await db.query("select start_at, end_at from reservations where total_cents = 1500 and start_at=$1", [Z(D(20), "18:00")]);
  eq(rows[0].start_at.toISOString(), Z(D(20), "18:00")); eq(rows[0].end_at.toISOString(), Z(D(21), "10:00")); });
await test("MATRIZ de sobreposição com 10:00→12:00", async () => {
  const d = D(23); eq((await book(d, "10:00", d, "12:00")).status, 201);
  const t = async (a, b, st) => eq((await book(d, a, d, b)).status, st, `${a}→${b}`);
  await t("11:59", "13:00", 409); await t("09:00", "10:01", 409); await t("10:30", "11:30", 409); await t("09:00", "13:00", 409); await t("10:00", "12:00", 409);
  await t("12:00", "14:00", 201); // entrada exatamente na saída
  await t("08:00", "10:00", 201); // saída exatamente na entrada
  await t("11:30", "12:30", 409); await t("07:00", "08:30", 409); await t("07:00", "08:00", 201); });
await test("preços e virada de meia-noite: 18→06=15; 18→10(dia seguinte)=15; 23:30→01:00=15; 00:00→06:00=15; 06→18=30; 05→07=15 (check-out); 10→11=30", async () => {
  const p = async (d1, t1, d2, t2, cents) => { const r = await book(d1, t1, d2, t2); eq(r.status, 201, `${d1} ${t1}`); eq(r.json.totalCents, cents, `${t1}→${t2}`); };
  await p(D(25), "18:00", D(26), "06:00", 1500); await p(D(27), "18:00", D(28), "10:00", 1500); await p(D(29), "23:30", D(30), "01:00", 1500);
  await p(D(31), "00:00", D(31), "06:00", 1500); await p(D(32), "06:00", D(32), "18:00", 3000); await p(D(33), "05:00", D(33), "07:00", 1500); await p(D(34), "10:00", D(34), "11:00", 3000); });
await test("virada de dia salva as datas certas (23:30→01:00 = 02:30 UTC → 04:00 UTC)", async () => {
  const { rows } = await db.query("select start_at, end_at from reservations where start_at=$1", [Z(D(29), "23:30")]); eq(rows[0].end_at.toISOString(), Z(D(30), "01:00")); });
await test("disponibilidade pública não vaza nada além de início/fim", async () => {
  const r = await call("GET", "/api/availability"); assert.ok(r.json.length >= 5);
  for (const x of r.json) assert.deepEqual(Object.keys(x).sort(), ["end", "start"]);
  for (const s of ["João", "ABC1D23", "Argo", "101", "Prata"]) assert.ok(!r.text.includes(s), s); });
await test("manipular preço/status/id/source no corpo é ignorado", async () => {
  const r = await book(D(36), "18:00", D(37), "06:00", { extra: { totalCents: 1, status: "finalizada", id: "x", source: "admin" } });
  eq(r.status, 201); eq(r.json.totalCents, 1500);
  const row = (await db.query("select status, source from reservations where start_at=$1", [Z(D(36), "18:00")])).rows[0]; eq(row.status, "confirmada"); eq(row.source, "vizinho"); });
await test("validações: passado, saída<entrada, 30/02, >14 dias de duração, <30min, ano 9999, placa, <script>, tamanho, JSON lixo", async () => {
  const bad = async (...a) => eq((await book(...a)).status, 400, a.join(" "));
  await bad(D(-2), "10:00", D(-2), "12:00"); await bad(D(38), "12:00", D(38), "10:00"); await bad("2027-02-30", "10:00", "2027-02-30", "12:00");
  await bad(D(38), "10:00", D(54), "10:00"); await bad(D(38), "10:00", D(38), "10:10"); await bad("9999-12-31", "10:00", "9999-12-31", "12:00");
  const x = (extra) => book(D(38), "10:00", D(38), "12:00", { extra });
  eq((await x({ plate: "12-INVALIDA" })).status, 400); eq((await x({ name: "<script>alert(1)</script>" })).status, 400); eq((await x({ name: "x".repeat(500) })).status, 400);
  eq((await call("POST", "/api/reservations", { body: "lixo" })).status, 400);
  eq((await db.query("select 1 from reservations where start_at>=$1 and start_at<$2", [Z(D(38), "00:00"), Z(D(39), "00:00")])).rowCount, 0); });
await test("CORRIDA: 8 reservas simultâneas do mesmo horário → 1 vence + 7 conflitos", async () => {
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => book(D(40), "18:00", D(40), "21:00", { ip: `8.8.8.${i}` })));
  const c = rs.map((r) => r.status); eq(c.filter((s) => s === 201).length, 1); eq(c.filter((s) => s === 409).length, 7);
  eq((await db.query("select count(*)::int n from reservations where start_at=$1", [Z(D(40), "18:00")])).rows[0].n, 1); });
await test("honeypot: robô recebe 'sucesso' mas nada é gravado", async () => {
  eq((await book(D(41), "10:00", D(41), "12:00", { extra: { website: "http://spam", plate: "HNY1P23" } })).status, 201);
  eq((await db.query("select 1 from reservations where plate='HNY1P23'")).rowCount, 0); });
await test("rate limit de reservas: 9ª tentativa do mesmo IP em 1h → 429", async () => {
  let last; for (let i = 0; i < 9; i++) last = await book(D(41), "10:00", D(41), "10:10", { ip: "7.7.7.7" }); eq(last.status, 429); });
await test("minhas reservas: dono vê só as suas, sem dados pessoais; outros não veem nada", async () => {
  resA2 = (await book(D(42), "10:00", D(42), "12:00", { jar: A })).json; eq(resA2.totalCents, 3000);
  const a = await call("GET", "/api/minhas-reservas", { jar: A }); eq(a.json.length, 2);
  assert.deepEqual(Object.keys(a.json[0]).sort(), ["breakdown", "end", "id", "paymentStatus", "receiptCount", "shortId", "start", "status", "totalCents"]);
  for (const s of ["João", "ABC1D23", "Argo"]) assert.ok(!a.text.includes(s));
  eq((await call("GET", "/api/minhas-reservas", { jar: B })).json.length, 0); eq((await call("GET", "/api/minhas-reservas")).json.length, 0); });
await test("código de acompanhamento vincula a outro aparelho; errado → 404; 11 tentativas → 429", async () => {
  const C = {}; eq((await call("POST", "/api/minhas-reservas", { body: { code }, jar: C })).status, 200); eq((await call("GET", "/api/minhas-reservas", { jar: C })).json.length, 1);
  eq((await call("POST", "/api/minhas-reservas", { body: { code: "codigo-errado-123" } })).status, 404);
  let last; for (let i = 0; i < 11; i++) last = await call("POST", "/api/minhas-reservas", { body: { code: "tentativa-" + i + "-xxxx" }, ip: "6.6.6.6" }); eq(last.status, 429); });
await test("BOLA/IDOR: cookie adulterado, chave errada ou audiência errada não dá acesso", async () => {
  const rid = (await db.query("select id from reservations limit 1")).rows[0].id;
  eq((await call("GET", "/api/minhas-reservas", { jar: { viz: await tok("neighbor", { ids: [rid] }, new TextEncoder().encode("x".repeat(40))) } })).json.length, 0);
  eq((await call("GET", "/api/minhas-reservas", { jar: { viz: await tok("admin", { ids: [rid] }) } })).json.length, 0);
  eq((await call("GET", "/api/minhas-reservas", { jar: { viz: "lixo.lixo.lixo" } })).json.length, 0);
  eq((await call("GET", "/api/minhas-reservas", { jar: { viz: await tok("neighbor", { ids: ["' or 1=1 --", rid + "x"] }) } })).json.length, 0); });
await test("CANCELAMENTO: outro vizinho / sem cookie / id aleatório / id malformado → 404 e nada muda", async () => {
  const id = (await call("GET", "/api/minhas-reservas", { jar: A })).json[0].id;
  eq((await call("DELETE", `/api/minhas-reservas/${id}`, { jar: B })).status, 404); eq((await call("DELETE", `/api/minhas-reservas/${id}`)).status, 404);
  eq((await call("DELETE", `/api/minhas-reservas/${crypto.randomUUID()}`, { jar: A })).status, 404); eq((await call("DELETE", `/api/minhas-reservas/1%20or%201=1`, { jar: A })).status, 404);
  eq((await dbRow(id)).status, "confirmada"); });
await test("CANCELAMENTO próprio: libera o horário e registra na auditoria; repetir → 404", async () => {
  const mine = (await call("GET", "/api/minhas-reservas", { jar: A })).json.find((r) => r.shortId === resA2.id);
  eq((await call("DELETE", `/api/minhas-reservas/${mine.id}`, { jar: A })).status, 200); eq((await call("DELETE", `/api/minhas-reservas/${mine.id}`, { jar: A })).status, 404);
  eq((await book(D(42), "10:00", D(42), "12:00")).status, 201);
  eq((await db.query("select 1 from reservation_events where reservation_id=$1 and actor='vizinho' and details->>'to'='cancelada'", [mine.id])).rowCount, 1); });
await test("RESERVA PASSADA/EM ANDAMENTO não cancela; status é derivado do horário sem alterar dados", async () => {
  const P = {}, Q = {};
  const rp = (await book(D(43), "10:00", D(43), "12:00", { jar: P })).json; const rq = (await book(D(44), "10:00", D(44), "12:00", { jar: Q })).json;
  const idP = (await call("GET", "/api/minhas-reservas", { jar: P })).json[0].id, idQ = (await call("GET", "/api/minhas-reservas", { jar: Q })).json[0].id;
  await db.query("update reservations set start_at=now()-interval '1 hour', end_at=now()+interval '1 hour' where id=$1", [idP]);
  await db.query("update reservations set start_at=now()-interval '5 hours', end_at=now()-interval '3 hours' where id=$1", [idQ]);
  eq((await call("GET", "/api/minhas-reservas", { jar: P })).json[0].status, "em_andamento"); eq((await call("GET", "/api/minhas-reservas", { jar: Q })).json[0].status, "finalizada");
  eq((await call("DELETE", `/api/minhas-reservas/${idP}`, { jar: P })).status, 404); eq((await call("DELETE", `/api/minhas-reservas/${idQ}`, { jar: Q })).status, 404);
  for (const [id, r] of [[idP, rp], [idQ, rq]]) { const row = await dbRow(id); eq(row.status, "confirmada"); eq(row.total_cents, r.totalCents); }
  // estas duas viraram reservas JÁ USADAS e não pagas do apto 101: quitar para não acionar o bloqueio por pendências nos testes seguintes
  await db.query("update reservations set payment_status='pago', paid_at=now() where id = any($1)", [[idP, idQ]]); });

// ================= SEGURANÇA ADMIN =================
await test("/admin sem login redireciona; /admin/login abre", async () => {
  const r = await call("GET", "/admin"); eq(r.status, 307); assert.match(r.headers.get("location"), /\/admin\/login$/); eq((await call("GET", "/admin/login")).status, 200); });
await test("TODA rota /api/admin sem sessão → 401 (inclui quote, fotos, settings)", async () => {
  const id = crypto.randomUUID();
  for (const [m, p] of [["GET", "/api/admin/reservations"], ["POST", "/api/admin/reservations"], ["GET", `/api/admin/reservations/${id}`], ["PATCH", `/api/admin/reservations/${id}`], ["DELETE", `/api/admin/reservations/${id}`], ["POST", `/api/admin/reservations/${id}/photos`], ["GET", `/api/admin/photos/${id}`], ["DELETE", `/api/admin/photos/${id}`], ["GET", "/api/admin/settings"], ["PUT", "/api/admin/settings"], ["POST", "/api/admin/quote"]])
    eq((await call(m, p, m === "GET" ? {} : { body: {} })).status, 401, `${m} ${p}`); });
await test("sessão de vizinho, token forjado, audiência errada ou ÉPOCA antiga NÃO valem como admin", async () => {
  const bad = [{ viz: await tok("neighbor", { ids: [] }) }, { adm: await tok("neighbor", { v: 0 }) }, { adm: await tok("admin", { v: 0 }, new TextEncoder().encode("y".repeat(40))) }, { adm: await tok("admin", { v: 999 }) }, { adm: await tok("admin", {}) }, { adm: "a.b.c" }];
  for (const jar of bad) { eq((await call("GET", "/api/admin/reservations", { jar })).status, 401); eq((await call("GET", "/admin", { jar })).status, 307); } });
await test("cookie do admin: HttpOnly + Secure + SameSite=Strict + 1 dia, sem dados sensíveis; senha errada → 401", async () => {
  eq((await call("POST", "/api/admin/login", { body: { password: "errada" } })).status, 401);
  const r = await call("POST", "/api/admin/login", { body: { password: PASS } }); const c = r.setc.find((x) => x.startsWith("adm="));
  assert.match(c, /HttpOnly/i); assert.match(c, /Secure/i); assert.match(c, /SameSite=strict/i); assert.match(c, /Max-Age=86400/i);
  const payload = JSON.parse(Buffer.from(c.split("=")[1].split(";")[0].split(".")[1], "base64url")); assert.ok(Object.keys(payload).every((k) => ["aud", "exp", "iat", "v"].includes(k))); eq(payload.aud, "admin"); });
await test("força bruta: 6ª tentativa do mesmo IP → 429 mesmo com a senha certa", async () => {
  for (let i = 0; i < 5; i++) await call("POST", "/api/admin/login", { body: { password: "x" + i }, ip: "5.5.5.5" });
  eq((await call("POST", "/api/admin/login", { body: { password: PASS }, ip: "5.5.5.5" })).status, 429); });
await test("cabeçalhos de segurança e private/no-store nas APIs", async () => {
  const h = (await call("GET", "/")).headers; eq(h.get("x-frame-options"), "DENY"); eq(h.get("x-content-type-options"), "nosniff");
  assert.match((await call("GET", "/api/admin/reservations", { jar: ADM })).headers.get("cache-control"), /private, no-store/); });

// ================= ADMIN =================
await test("admin lista reservas (dados completos, sem access_hash)", async () => {
  const r = await call("GET", "/api/admin/reservations", { jar: ADM }); eq(r.status, 200); assert.ok(r.json.length >= 10); assert.ok(r.text.includes("ABC1D23")); assert.ok(!r.text.includes("access_hash")); });
await test("registro manual IRREGULAR ocupa a vaga; conflito devolve as reservas conflitantes para resolver no painel", async () => {
  const d = D(47); const r = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "10:00"), endAt: iso(d, "14:00"), status: "irregular", name: "Fulano", apartment: "22", carBrand: "VW", carModel: "Gol", carColor: "Branco", plate: "XYZ9K88", notes: "Visto da janela" } });
  eq(r.status, 201); mid = r.json.id; eq((await book(d, "12:00", d, "13:00")).status, 409);
  const c = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "13:00"), endAt: iso(d, "16:00"), status: "confirmada", name: "Outro" } });
  eq(c.status, 409); eq(c.json.conflicts[0].id, mid); assert.match(c.json.error, /Fulano/); });
await test("PREÇO: cotação com preços atuais não altera nada; editar horário MANTÉM o valor por padrão", async () => {
  const d = D(47); const q = await call("POST", "/api/admin/quote", { jar: ADM, body: { startAt: iso(d, "10:00"), endAt: iso(d, "19:00") } }); eq(q.json.totalCents, 4500);
  eq((await detail(mid)).total_cents, 3000);
  eq((await call("PATCH", `/api/admin/reservations/${mid}`, { jar: ADM, body: { endAt: iso(d, "19:00") } })).status, 200);
  const x = await detail(mid); eq(x.total_cents, 3000); eq(x.price_breakdown, null); /* detalhamento do horário antigo não vale mais */ const ev = x.events.find((e) => e.action === "editada"); assert.ok(ev.details.changes["saída"]); eq(ev.details.preco, "mantido"); assert.ok(!ev.details.changes["valor"]); });
await test("PREÇO: 'recalcular' é explícito, aplica preços atuais e audita de→para", async () => {
  eq((await call("PATCH", `/api/admin/reservations/${mid}`, { jar: ADM, body: { endAt: iso(D(47), "20:00"), priceMode: "recalc" } })).status, 200);
  const x = await detail(mid); eq(x.total_cents, 4500); eq(x.price_breakdown.totalCents, 4500); eq(x.price_breakdown.periods.length, 2); const ev = x.events.filter((e) => e.action === "editada").at(-1); eq(ev.details.preco, "recalculado"); assert.ok(ev.details.changes["valor"].from !== ev.details.changes["valor"].to); });
await test("PREÇO: valor manual é permitido e auditado (de→para); dados do veículo também", async () => {
  eq((await call("PATCH", `/api/admin/reservations/${mid}`, { jar: ADM, body: { totalCents: 1234, plate: "NEW1A23", carColor: "Preto" } })).status, 200);
  const x = await detail(mid); eq(x.total_cents, 1234); const ev = x.events.at(-1); eq(ev.details.preco, "manual"); assert.ok(ev.details.changes["valor"].to.includes("12,34")); eq(ev.details.changes["placa"].from, "XYZ9K88"); eq(ev.details.changes["placa"].to, "NEW1A23"); eq(ev.details.changes["cor"].to, "Preto"); });
await test("confirmar, irregular e cancelar ficam no histórico; cancelar libera a vaga; reativar com conflito → 409", async () => {
  for (const status of ["confirmada", "irregular", "cancelada"]) eq((await call("PATCH", `/api/admin/reservations/${mid}`, { jar: ADM, body: { status } })).status, 200);
  assert.deepEqual((await detail(mid)).events.filter((e) => e.action === "status_alterado").map((e) => e.details.to), ["confirmada", "irregular", "cancelada"]);
  eq((await book(D(47), "12:00", D(47), "13:00")).status, 201); eq((await call("PATCH", `/api/admin/reservations/${mid}`, { jar: ADM, body: { status: "confirmada" } })).status, 409); });
await test("PATCH rejeita status inválido, priceMode inválido e id inválido; valor negativo", async () => {
  for (const body of [{ status: "hackeado" }, { priceMode: "x" }, { totalCents: -5 }]) eq((await call("PATCH", `/api/admin/reservations/${mid}`, { jar: ADM, body })).status, 400);
  eq((await call("PATCH", `/api/admin/reservations/nao-e-uuid`, { jar: ADM, body: { status: "confirmada" } })).status, 404); });
await test("BLOQUEIO com motivo: ninguém reserva; vizinho só vê ocupado, sem motivo; desbloquear libera e audita", async () => {
  const d = D(48); const r = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "14:00"), endAt: iso(d, "18:00"), status: "bloqueada", notes: "manutenção do portão" } });
  eq(r.status, 201); const blk = r.json.id; eq((await book(d, "15:00", d, "16:00")).status, 409);
  const av = await call("GET", "/api/availability"); assert.ok(av.json.some((b) => b.start === Z(d, "14:00"))); assert.ok(!av.text.includes("manutenção"));
  assert.ok(!(await call("GET", "/api/minhas-reservas", { jar: A })).text.includes("manutenção")); assert.ok((await call("GET", "/api/admin/reservations", { jar: ADM })).text.includes("manutenção do portão"));
  eq((await call("PATCH", `/api/admin/reservations/${blk}`, { jar: ADM, body: { status: "cancelada" } })).status, 200);
  const ev = (await detail(blk)).events; assert.ok(ev.some((e) => e.action === "bloqueio_criado") && ev.some((e) => e.action === "status_alterado" && e.details.from === "bloqueada"));
  eq((await book(d, "15:00", d, "16:00")).status, 201); });
await test("FOTOS: só admin envia/vê/exclui; JPEG válido; tamanho e quantidade limitados; sem URL pública", async () => {
  const id = mid; eq((await upload(id, JPEG(), ADM)).status, 201);
  const photos = (await detail(id)).photos; eq(photos.length, 1); const url = `/api/admin/photos/${photos[0]}`;
  const g = await call("GET", url, { jar: ADM }); eq(g.status, 200); eq(g.headers.get("content-type"), "image/jpeg"); assert.match(g.headers.get("cache-control"), /private, no-store/);
  eq((await call("GET", url)).status, 401); eq((await call("GET", url, { jar: A })).status, 401); eq((await call("DELETE", url, { jar: A })).status, 401); eq((await upload(id, JPEG(), A)).status, 401); eq((await upload(id, JPEG(), null)).status, 401);
  eq((await call("GET", `/api/admin/photos/${crypto.randomUUID()}`, { jar: ADM })).status, 404); eq((await call("GET", `/api/admin/photos/1;drop`, { jar: ADM })).status, 404);
  eq((await upload(id, Buffer.from("<script>alert(1)</script>"), ADM, "x.jpg")).status, 400);
  eq((await upload(id, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)]), ADM, "x.jpg")).status, 400);
  eq((await upload(id, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50)]), ADM)).status, 400); // JPEG sem fim válido
  eq((await upload(id, JPEG(3_000_000), ADM)).status, 400);
  for (let i = 0; i < 9; i++) eq((await upload(id, JPEG(50 + i), ADM)).status, 201); eq((await upload(id, JPEG(), ADM)).status, 400);
  eq((await call("DELETE", url, { jar: ADM })).status, 200); eq((await call("GET", url, { jar: ADM })).status, 404);
  const acts = (await detail(id)).events.map((e) => e.action); assert.ok(acts.includes("foto_adicionada") && acts.includes("foto_removida")); });
await test("excluir é soft delete: some das listas, histórico permanece (incl. o evento de exclusão)", async () => {
  const d = D(49); const blk = (await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "14:00"), endAt: iso(d, "18:00"), status: "bloqueada", notes: "x" } })).json.id;
  eq((await call("DELETE", `/api/admin/reservations/${blk}`, { jar: ADM })).status, 200); eq((await call("GET", `/api/admin/reservations/${blk}`, { jar: ADM })).status, 404);
  const ev = (await db.query("select action from reservation_events where reservation_id=$1 order by id", [blk])).rows.map((r) => r.action); assert.deepEqual(ev, ["bloqueio_criado", "excluida"]);
  eq((await book(d, "15:00", d, "16:00")).status, 201); });
await test("histórico é imutável no banco; reservas não podem ser apagadas de verdade", async () => {
  await assert.rejects(db.query("update reservation_events set action='x'"), /imut/); await assert.rejects(db.query("delete from reservation_events"), /imut/); await assert.rejects(db.query("delete from reservations"), /imut/); });
await test("exclusion constraint no banco recusa sobreposição mesmo sem passar pela aplicação", async () => {
  await assert.rejects(db.query("insert into reservations (start_at,end_at,status) values ($1,$2,'confirmada')", [Z(D(20), "19:00"), Z(D(20), "20:00")]), /no_overlap/); });
await test("MUDAR PREÇO: vale só p/ novas reservas, antigas não mudam, mudança auditada", async () => {
  const old = (await db.query("select total_cents from reservations where start_at=$1", [Z(D(20), "18:00")])).rows[0].total_cents;
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ garageName: "Garagem Bloco A", pricing: { dayPrice: 40, nightPrice: 20, dayStartHour: 6, nightStartHour: 18 } }) })).status, 200);
  eq((await book(D(51), "18:00", D(52), "10:00")).json.totalCents, 2000); eq((await db.query("select total_cents from reservations where start_at=$1", [Z(D(20), "18:00")])).rows[0].total_cents, old);
  assert.match((await call("GET", "/")).text, /Garagem Bloco A/); assert.ok((await call("GET", "/api/admin/settings", { jar: ADM })).json.history.length >= 2);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ pricing: { dayPrice: -5, nightPrice: 1, dayStartHour: 6, nightStartHour: 18 } }) })).status, 400); });
await test("CHECK-OUT: config pública traz o horário (padrão 10:30) e cada reserva grava o detalhamento", async () => {
  eq((await call("GET", "/api/config")).json.pricing.checkoutTime, "10:30");
  const r = await book(D(55), "20:00", D(57), "10:00", { jar: A }); eq(r.status, 201); eq(r.json.totalCents, 6000); // 2 noites + 1 dia, manhã da saída grátis
  const b = r.json.breakdown; assert.deepEqual(b.periods.map((p) => p.kind), ["noite", "dia", "noite", "dia"]); eq(b.periods[3].waived, true); eq(b.periods[3].cents, 0);
  eq(b.periods[0].start, `${D(55)}T20:00`); eq(b.periods[3].end, `${D(57)}T10:00`); eq(b.totalCents, 6000); eq(b.checkoutTime, "10:30");
  eq((await dbRow((await db.query("select id from reservations where start_at=$1", [Z(D(55), "20:00")])).rows[0].id)).price_breakdown.totalCents, 6000);
  const mine = (await call("GET", "/api/minhas-reservas", { jar: A })).json.find((x) => x.start === Z(D(55), "20:00")); eq(mine.breakdown.periods.length, 4);
  eq((await book(D(58), "20:00", D(59), "10:30")).json.totalCents, 1500); // exatamente no limite
  eq((await book(D(59), "20:00", D(60), "10:31")).json.totalCents, 4500); }); // 1 minuto depois: cobra a manhã
await test("CHECK-OUT: só vale para quem pernoitou (07:00→10:00 no mesmo dia = R$30)", async () => {
  const r = await book(D(50), "07:00", D(50), "10:00"); eq(r.json.totalCents, 3000); eq(r.json.breakdown.periods.length, 1); assert.ok(!r.json.breakdown.periods[0].waived); });
await test("CHECK-OUT configurável: 11:00 amplia; fora do intervalo dia→noite = 400; igual ao início do dia desliga", async () => {
  const pr = (checkoutTime) => cfg({ pricing: { dayPrice: 30, nightPrice: 15, dayStartHour: 6, nightStartHour: 18, checkoutTime } });
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: pr("11:00") })).status, 200); eq((await call("GET", "/api/config")).json.pricing.checkoutTime, "11:00");
  eq((await book(D(52), "20:00", D(53), "10:45")).json.totalCents, 1500);
  for (const t of ["05:00", "18:00", "25:00", "abc"]) eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: pr(t) })).status, 400, t);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: pr("06:00") })).status, 200);
  eq((await book(D(53), "20:00", D(54), "10:00")).json.totalCents, 4500); // sem tolerância
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200); eq((await call("GET", "/api/config")).json.pricing.checkoutTime, "10:30"); });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const receipt = (id, buf, jar, name = "c.jpg") => { const f = new FormData(); f.append("file", new Blob([buf]), name); return call("POST", `/api/minhas-reservas/${id}/comprovante`, { form: f, jar }); };
let payId;
await test("PAGAMENTO: toda reserva entra como pendente (vizinho e manual)", async () => {
  const r = await book(D(45), "10:00", D(45), "12:00", { jar: A }); eq(r.status, 201);
  payId = (await db.query("select id from reservations where start_at=$1", [Z(D(45), "10:00")])).rows[0].id;
  eq((await dbRow(payId)).payment_status, "pendente"); eq((await dbRow(payId)).paid_at, null);
  const mine = (await call("GET", "/api/minhas-reservas", { jar: A })).json.find((x) => x.id === payId); eq(mine.paymentStatus, "pendente"); eq(mine.receiptCount, 0);
  const m = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(D(46), "10:00"), endAt: iso(D(46), "12:00"), name: "Manual" } });
  eq(m.status, 201); eq((await dbRow(m.json.id)).payment_status, "pendente"); });
await test("COMPROVANTE: só o dono envia; JPEG/PNG/PDF pelo conteúdo; lixo → 400; limite de 3", async () => {
  eq((await receipt(payId, JPEG(), B)).status, 404); eq((await receipt(payId, JPEG(), null)).status, 404); eq((await receipt(crypto.randomUUID(), JPEG(), A)).status, 404);
  eq((await receipt(payId, Buffer.from("<html><script>alert(1)</script>"), A, "x.pdf")).status, 400);
  eq((await receipt(payId, JPEG(3_000_000), A)).status, 400);
  eq((await receipt(payId, JPEG(), A)).status, 201); eq((await receipt(payId, PNG, A, "c.png")).status, 201); eq((await receipt(payId, PDF, A, "c.pdf")).status, 201);
  eq((await receipt(payId, JPEG(), A)).status, 400); // 4º
  eq((await call("GET", "/api/minhas-reservas", { jar: A })).json.find((x) => x.id === payId).receiptCount, 3);
  eq((await dbRow(payId)).payment_status, "pendente"); // enviar comprovante NÃO marca como pago
  const d = await detail(payId); assert.deepEqual(d.receipts.map((c) => c.mime), ["image/jpeg", "image/png", "application/pdf"]); assert.ok(d.events.some((e) => e.action === "comprovante_enviado")); });
await test("COMPROVANTE: só admin vê; servido sem cache e em sandbox", async () => {
  const [c] = (await detail(payId)).receipts.filter((x) => x.mime === "application/pdf"); const url = `/api/admin/receipts/${c.id}`;
  const g = await call("GET", url, { jar: ADM }); eq(g.status, 200); eq(g.headers.get("content-type"), "application/pdf");
  assert.match(g.headers.get("cache-control"), /no-store/); assert.match(g.headers.get("content-security-policy"), /sandbox/);
  eq((await call("GET", url)).status, 401); eq((await call("GET", url, { jar: A })).status, 401); eq((await call("GET", `/api/admin/receipts/${crypto.randomUUID()}`, { jar: ADM })).status, 404); });
await test("PAGAMENTO: admin marca pago (data registrada e auditada); vizinho vê; volta a pendente; valor inválido → 400", async () => {
  eq((await call("PATCH", `/api/admin/reservations/${payId}`, { jar: ADM, body: { paymentStatus: "pago" } })).status, 200);
  const x = await detail(payId); eq(x.payment_status, "pago"); assert.ok(x.paid_at); eq(x.status, "confirmada");
  const ev = x.events.filter((e) => e.action === "editada").at(-1); eq(ev.details.changes["pagamento"].from, "pendente"); eq(ev.details.changes["pagamento"].to, "pago");
  eq((await call("GET", "/api/minhas-reservas", { jar: A })).json.find((y) => y.id === payId).paymentStatus, "pago");
  const before = x.paid_at; eq((await call("PATCH", `/api/admin/reservations/${payId}`, { jar: ADM, body: { notes: "pago no PIX" } })).status, 200); eq((await detail(payId)).paid_at, before); // editar outra coisa não muda a data
  eq((await call("PATCH", `/api/admin/reservations/${payId}`, { jar: ADM, body: { paymentStatus: "quitado" } })).status, 400);
  eq((await call("PATCH", `/api/admin/reservations/${payId}`, { jar: ADM, body: { paymentStatus: "pendente" } })).status, 200); eq((await detail(payId)).paid_at, null); });
await test("FOTO do veículo aceita PNG da galeria? Não: o painel converte para JPEG antes; o servidor continua só aceitando JPEG", async () => {
  eq((await upload(payId, PNG, ADM, "x.png")).status, 400); eq((await upload(payId, JPEG(), ADM)).status, 201); });
await test("voltar a antecedência para 14 passa a valer na hora (dia+20 → 400)", async () => {
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14 }) })).status, 200);
  eq((await book(D(20), "08:00", D(20), "09:00")).status, 400); eq((await call("GET", "/api/config")).json.maximumReservationAdvanceDays, 14); });
await test("PIX: admin salva a chave (auditado); vizinho vê na config pública; só admin altera; chave inválida → 400; vazio desliga", async () => {
  const pix = { key: "natan@example.com", name: "Natan Silva", city: "Sao Paulo" };
  eq((await call("PUT", "/api/admin/settings", { body: cfg({ pix }) })).status, 401);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ pix: { ...pix, key: "<script>" } }) })).status, 400);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ pix }) })).status, 200);
  eq((await call("GET", "/api/config")).json.pix.key, "natan@example.com");
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.pix.name, "Natan Silva");
  assert.ok((await db.query("select 1 from reservation_events where action='configuracao_alterada' and details->>'chave'='pix'")).rowCount >= 1);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200); eq((await call("GET", "/api/config")).json.pix.key, "natan@example.com"); // sem pix no corpo = não mexe
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ pix: { key: "", name: "", city: "" } }) })).status, 200); eq((await call("GET", "/api/config")).json.pix.key, ""); });
await test("PIX copia e cola: CRC16 e campos corretos (vetor padrão CRC-16/CCITT-FALSE)", async () => {
  let m; try { m = await import("../lib/pix.ts"); } catch { console.log("      (Node sem suporte a importar .ts: teste do CRC ignorado)"); return; }
  const { crc16, pixPayload } = m;
  eq(crc16("123456789"), "29B1");
  const c = pixPayload({ key: "natan@example.com", name: "Natan Álvares", city: "São Paulo" }, 3000);
  assert.match(c, /^000201.*br\.gov\.bcb\.pix0117natan@example\.com.*5303986540530\.00.*5802BR5913NATAN ALVARES6009SAO PAULO.*6304[0-9A-F]{4}$/);
  eq(crc16(c.slice(0, -4)), c.slice(-4)); eq(pixPayload({ key: "x", name: "", city: "" }, 3000), null); });
// ================= PENDÊNCIAS E COBRANÇA =================
const past = (id, h) => db.query("update reservations set start_at=now()-make_interval(hours => $2), end_at=now()-make_interval(hours => $2 - 2) where id=$1", [id, h]);
const mineIds = async (jar) => (await call("GET", "/api/minhas-reservas", { jar })).json.map((x) => x.id);
const ap = (apartment, o = {}) => ({ ...o, extra: { ...(o.extra ?? {}), apartment } });
let debtA, debtB;
await test("PENDÊNCIAS: padrão = bloqueia com mais de 1; 2 reservas usadas e não pagas do apto 707 → 403 (\"Apto 707\" = \"707\"); outro apto passa", async () => {
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.maxUnpaidReservations, 1);
  const J = {};
  eq((await book(D(3), "01:00", D(3), "02:00", ap("707", { jar: J }))).status, 201);
  [debtA] = await mineIds(J); await past(debtA, 30);
  eq((await book(D(3), "03:00", D(3), "04:00", ap("707"))).status, 201); // 1 pendência: ainda pode
  const second = (await db.query("select id from reservations where start_at=$1", [Z(D(3), "03:00")])).rows[0].id; debtB = second; await past(second, 50);
  const r = await book(D(3), "05:00", D(3), "06:00", ap("Apto 707")); eq(r.status, 403); assert.match(r.json.error, /pagamentos pendentes/);
  assert.ok(!/707|R\$/.test(r.json.error)); // não revela valores nem detalhes
  eq((await book(D(3), "05:00", D(3), "06:00", ap("ap. 707"))).status, 403);
  eq((await book(D(3), "05:00", D(3), "06:00", ap("708"))).status, 201); });
await test("PENDÊNCIAS: reserva futura não conta; comprovante enviado tira da conta; pagar libera; cancelada não conta", async () => {
  const J = {}; eq((await book(D(4), "01:00", D(4), "02:00", ap("709", { jar: J }))).status, 201); eq((await book(D(4), "03:00", D(4), "04:00", ap("709"))).status, 201);
  eq((await book(D(4), "05:00", D(4), "06:00", ap("709"))).status, 201); // 3 futuras pendentes: nenhuma usada, nada bloqueia
  eq((await book(D(4), "07:00", D(4), "08:00", ap("707"))).status, 403);
  await db.query("insert into payment_receipts (reservation_id, mime, data) values ($1, 'image/jpeg', '\\xffd8')", [debtA]); // comprovante a conferir
  eq((await book(D(4), "07:00", D(4), "08:00", ap("707"))).status, 201);
  await db.query("delete from payment_receipts where reservation_id=$1", [debtA]); // volta a contar
  eq((await book(D(4), "09:00", D(4), "10:00", ap("707"))).status, 403);
  eq((await call("PATCH", `/api/admin/reservations/${debtA}`, { jar: ADM, body: { status: "cancelada" } })).status, 200); // cancelada não conta
  eq((await book(D(4), "09:00", D(4), "10:00", ap("707"))).status, 201);
  eq((await call("PATCH", `/api/admin/reservations/${debtA}`, { jar: ADM, body: { status: "finalizada" } })).status, 200);
  eq((await call("PATCH", `/api/admin/reservations/${debtB}`, { jar: ADM, body: { paymentStatus: "pago" } })).status, 200);
  eq((await book(D(4), "11:00", D(4), "12:00", ap("707"))).status, 201); });
await test("PENDÊNCIAS configurável: 0 bloqueia com qualquer uma; vazio (null) desliga; PUT sem o campo mantém; -1 → 400; reserva manual do admin nunca é bloqueada", async () => {
  eq((await book(D(5), "01:00", D(5), "02:00", ap("707"))).status, 201); // 707 tem 1 pendência (debtA) e o limite é 1: passa
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, maxUnpaidReservations: 0 }) })).status, 200);
  eq((await book(D(5), "03:00", D(5), "04:00", ap("707"))).status, 403);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14 }) })).status, 200); // sem o campo: continua 0
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.maxUnpaidReservations, 0);
  eq((await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(D(5), "03:00"), endAt: iso(D(5), "04:00"), apartment: "707", name: "Manual" } })).status, 201);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, maxUnpaidReservations: -1 }) })).status, 400);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, maxUnpaidReservations: null }) })).status, 200);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.maxUnpaidReservations, null);
  eq((await book(D(5), "05:00", D(5), "06:00", ap("707"))).status, 201);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, maxUnpaidReservations: 1 }) })).status, 200);
  assert.ok((await db.query("select 1 from reservation_events where action='configuracao_alterada' and details->>'chave'='booking'")).rowCount >= 1); });
await test("WHATSAPP: opcional; guarda só dígitos; inválido → 400; só admin vê (não aparece em minhas-reservas nem na disponibilidade)", async () => {
  eq((await book(D(6), "01:00", D(6), "02:00", { extra: { phone: "123" } })).status, 400);
  eq((await book(D(6), "01:00", D(6), "02:00", { extra: { phone: "abc<script>" } })).status, 400);
  const J = {}; eq((await book(D(6), "01:00", D(6), "02:00", { jar: J, extra: { phone: "(43) 99876-5432" } })).status, 201);
  const [id] = await mineIds(J); eq((await dbRow(id)).phone, "43998765432"); eq((await detail(id)).phone, "43998765432");
  assert.ok(!(await call("GET", "/api/minhas-reservas", { jar: J })).text.includes("998765432"));
  assert.ok(!(await call("GET", "/api/availability")).text.includes("998765432"));
  eq((await call("PATCH", `/api/admin/reservations/${id}`, { jar: ADM, body: { phone: "+55 43 91234-5678" } })).status, 200); eq((await dbRow(id)).phone, "5543912345678");
  eq((await call("PATCH", `/api/admin/reservations/${id}`, { jar: ADM, body: { phone: "" } })).status, 200); eq((await dbRow(id)).phone, null); });
await test("COBRANÇA: detalhe traz as pendências do apto (+ a própria, mesmo futura); registrar cobrança audita cada uma; só admin", async () => {
  const d = await detail(debtB); // debtB já foi paga; debtA (usada, sem comprovante) é a pendência do 707
  assert.ok(d.charge.some((c) => c.id === debtA)); assert.ok(!d.charge.some((c) => c.id === debtB)); for (const c of d.charge) assert.deepEqual(Object.keys(c).sort(), ["end_at", "id", "start_at", "total_cents"]);
  const fut = (await db.query("select id from reservations where start_at=$1", [Z(D(5), "05:00")])).rows[0].id;
  const f = await detail(fut); assert.ok(f.charge.some((c) => c.id === fut)); assert.ok(f.charge.some((c) => c.id === debtA));
  const r = await call("POST", `/api/admin/reservations/${fut}/cobranca`, { jar: ADM }); eq(r.status, 200); eq(r.json.itens, f.charge.length);
  for (const c of f.charge) eq((await db.query("select 1 from reservation_events where reservation_id=$1 and action='cobranca_aberta'", [c.id])).rowCount >= 1, true);
  eq((await call("POST", `/api/admin/reservations/${fut}/cobranca`)).status, 401);
  eq((await call("POST", `/api/admin/reservations/${crypto.randomUUID()}/cobranca`, { jar: ADM })).status, 404);
  eq((await call("POST", `/api/admin/reservations/x/cobranca`, { jar: ADM })).status, 404);
  eq((await call("PATCH", `/api/admin/reservations/${fut}`, { jar: ADM, body: { paymentStatus: "pago" } })).status, 200);
  assert.ok(!(await detail(fut)).charge.some((c) => c.id === fut)); });
await test("MENSAGEM DE COBRANÇA: admin edita (auditado); PUT sem o campo mantém; vazio volta ao padrão; caractere de controle → 400; só admin", async () => {
  const tpl = "Olá {nome}\n{reservas}\nTotal {total}\nPIX {pix}";
  eq((await call("PUT", "/api/admin/settings", { body: cfg({ chargeTemplate: tpl }) })).status, 401);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, chargeTemplate: tpl }) })).status, 200);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.chargeTemplate, tpl);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14 }) })).status, 200);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.chargeTemplate, tpl);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, chargeTemplate: "a\u0007b" }) })).status, 400);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, chargeTemplate: "x".repeat(1501) }) })).status, 400);
  assert.ok((await db.query("select 1 from reservation_events where action='configuracao_alterada' and details->>'chave'='charge_template'")).rowCount >= 1);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, chargeTemplate: "" }) })).status, 200);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.chargeTemplate, "");
  assert.ok(!(await call("GET", "/api/config")).text.includes("reservas}")); }); // não vaza na config pública
await test("funções puras: apartamento normalizado e link do WhatsApp", async () => {
  let A_, W; try { A_ = await import("../lib/apartment.ts"); W = await import("../lib/whatsapp.ts"); } catch { console.log("      (Node sem suporte a importar .ts: teste ignorado)"); return; }
  for (const v of ["101", "Apto 101", "ap. 101", " AP 101 ", "apartamento 101"]) eq(A_.apartmentKey(v), "101");
  eq(A_.apartmentKey("101-B"), "101b"); eq(A_.apartmentKey(""), "");
  eq(W.waNumber("(43) 99876-5432"), "5543998765432"); eq(W.waNumber("+55 43 99876-5432"), "5543998765432"); eq(W.waNumber("123"), "");
  assert.match(W.waLink("43998765432", "oi & tchau"), /^https:\/\/wa\.me\/5543998765432\?text=oi%20%26%20tchau$/);
  assert.match(W.waLink("", "x"), /^https:\/\/wa\.me\/\?text=x$/);
  const m = W.chargeMessage("Karina Waldrich", [{ start_at: Z(D(3), "01:00"), end_at: Z(D(3), "02:00"), total_cents: 1500 }, { start_at: Z(D(4), "01:00"), end_at: Z(D(4), "02:00"), total_cents: 3000 }], "pix@exemplo.com");
  assert.match(m, /^Oi, Karina!/); assert.match(m, /Total: R\$\s45,00/); assert.match(m, /Chave PIX: pix@exemplo\.com/); });
await test("LOGOUT revoga na hora: token copiado antes do logout deixa de funcionar (API e página)", async () => {
  const J = {}; await login(J); const copy = { adm: J.adm }; eq((await call("GET", "/api/admin/reservations", { jar: copy })).status, 200);
  eq((await call("DELETE", "/api/admin/login", { jar: J })).status, 200); eq(Object.keys(J).length, 0);
  eq((await call("GET", "/api/admin/reservations", { jar: copy })).status, 401); eq((await call("GET", "/admin", { jar: copy })).status, 307); });
await test("quem não está logado não consegue deslogar o admin (DELETE /login sem sessão não revoga nada)", async () => {
  const J = {}; await login(J); eq((await call("DELETE", "/api/admin/login")).status, 200); eq((await call("GET", "/api/admin/reservations", { jar: J })).status, 200); });

console.log(`\n${pass} passaram, ${fail} falharam`); await db.end(); process.exit(fail ? 1 : 0);
