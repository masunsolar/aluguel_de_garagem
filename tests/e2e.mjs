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
  assert.deepEqual(Object.keys(a.json[0]).sort(), ["breakdown", "creditCents", "end", "feeCents", "id", "paidWithCredit", "paymentStatus", "receiptCount", "shortId", "start", "status", "totalCents"]);
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
await test("BLOQUEIO com motivo: ninguém reserva; vizinho vê só o motivo público (nunca a anotação interna); desbloquear libera e audita", async () => {
  const d = D(48); const r = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "14:00"), endAt: iso(d, "18:00"), status: "bloqueada", notes: "chaveiro cobra R$80", publicReason: "manutenção do portão" } });
  eq(r.status, 201); const blk = r.json.id;
  const c = await book(d, "15:00", d, "16:00"); eq(c.status, 409); assert.ok(c.text.includes("manutenção do portão")); assert.ok(!c.text.includes("chaveiro"));
  const av = await call("GET", "/api/availability"); const b = av.json.find((x) => x.start === Z(d, "14:00"));
  assert.ok(b && b.blocked === true && b.reason === "manutenção do portão"); assert.ok(!av.text.includes("chaveiro"));
  assert.ok(!(await call("GET", "/api/minhas-reservas", { jar: A })).text.includes("chaveiro")); assert.ok((await call("GET", "/api/admin/reservations", { jar: ADM })).text.includes("chaveiro cobra R$80"));
  // editar o motivo público audita a mudança; reserva comum nunca ganha motivo público
  eq((await call("PATCH", `/api/admin/reservations/${blk}`, { jar: ADM, body: { publicReason: "pintura do piso" } })).status, 200);
  assert.ok((await call("GET", "/api/availability")).json.some((x) => x.reason === "pintura do piso"));
  assert.ok((await detail(blk)).events.some((e) => e.action === "editada" && e.details.changes?.["motivo para os vizinhos"]?.to === "pintura do piso"));
  eq((await call("PATCH", `/api/admin/reservations/${blk}`, { jar: ADM, body: { status: "cancelada" } })).status, 200);
  const ev = (await detail(blk)).events; assert.ok(ev.some((e) => e.action === "bloqueio_criado") && ev.some((e) => e.action === "status_alterado" && e.details.from === "bloqueada"));
  eq((await book(d, "15:00", d, "16:00")).status, 201);
  assert.ok(!(await call("GET", "/api/availability")).json.some((x) => x.blocked && x.start === Z(d, "15:00"))); });
await test("BLOQUEIO sem motivo: vizinho vê 'bloqueada' sem motivo; motivo público é ignorado fora de bloqueio", async () => {
  const d = D(47); const r = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "02:00"), endAt: iso(d, "03:00"), status: "bloqueada", notes: "segredo" } });
  eq(r.status, 201); const b = (await call("GET", "/api/availability")).json.find((x) => x.start === Z(d, "02:00"));
  assert.ok(b.blocked === true && !("reason" in b));
  const m = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: iso(d, "04:00"), endAt: iso(d, "05:00"), status: "confirmada", name: "Teste", publicReason: "não deve aparecer" } });
  eq(m.status, 201); const x = (await call("GET", "/api/availability")).json.find((y) => y.start === Z(d, "04:00")); assert.ok(!x.blocked && !x.reason);
  for (const id of [r.json.id, m.json.id]) eq((await call("PATCH", `/api/admin/reservations/${id}`, { jar: ADM, body: { status: "cancelada" } })).status, 200); });
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
// cada apartamento = uma pessoa diferente (nome e placa próprios): o bloqueio reconhece a pessoa por nome, placa OU apto
const who = (apartment) => { const n = apartment.replace(/\D/g, ""); return { apartment, name: `Morador ${n}`, plate: `APT${n.padStart(4, "0")}` }; };
const ap = (apartment, o = {}) => ({ ...o, extra: { ...(o.extra ?? {}), ...who(apartment) } });
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
  assert.ok(d.charge.some((c) => c.id === debtA)); assert.ok(!d.charge.some((c) => c.id === debtB)); for (const c of d.charge) assert.deepEqual(Object.keys(c).sort(), ["credit_cents", "end_at", "fee_cents", "id", "start_at", "total_cents"]);
  const fut = (await db.query("select id from reservations where start_at=$1", [Z(D(5), "05:00")])).rows[0].id;
  const f = await detail(fut); assert.ok(f.charge.some((c) => c.id === fut)); assert.ok(f.charge.some((c) => c.id === debtA));
  const r = await call("POST", `/api/admin/reservations/${fut}/cobranca`, { jar: ADM }); eq(r.status, 200); eq(r.json.itens, f.charge.length);
  for (const c of f.charge) eq((await db.query("select 1 from reservation_events where reservation_id=$1 and action='cobranca_aberta'", [c.id])).rowCount >= 1, true);
  eq((await call("POST", `/api/admin/reservations/${fut}/cobranca`)).status, 401);
  eq((await call("POST", `/api/admin/reservations/${crypto.randomUUID()}/cobranca`, { jar: ADM })).status, 404);
  eq((await call("POST", `/api/admin/reservations/x/cobranca`, { jar: ADM })).status, 404);
  eq((await call("PATCH", `/api/admin/reservations/${fut}`, { jar: ADM, body: { paymentStatus: "pago" } })).status, 200);
  assert.ok(!(await detail(fut)).charge.some((c) => c.id === fut)); });
await test("PENDÊNCIAS POR PESSOA: outro celular + outro apto não escapa: bate pela placa OU pelo nome (sem acento/maiúsculas); pessoa diferente passa", async () => {
  const K = { name: "Kárina Teste", apartment: "811", plate: "KAR1A23" };
  for (const [a, b, h] of [["01:00", "02:00", 70], ["03:00", "04:00", 90]]) { const J = {}; eq((await book(D(7), a, D(7), b, { jar: J, extra: K })).status, 201); await past((await mineIds(J))[0], h); }
  const r = await book(D(7), "05:00", D(7), "06:00", { extra: { ...K, name: "Outra Pessoa", apartment: "999", plate: "kar-1a23" } }); // mesma placa
  eq(r.status, 403); assert.ok(!/placa|nome|apart|811|KAR/i.test(r.json.error)); // não diz qual dado bateu
  eq((await book(D(7), "05:00", D(7), "06:00", { extra: { ...K, name: "  KARINA   teste ", apartment: "998", plate: "ZZZ9Z99" } })).status, 403); // mesmo nome
  eq((await book(D(7), "05:00", D(7), "06:00", { extra: { ...K, name: "Karina Outra", apartment: "997", plate: "ZZZ9Z98" } })).status, 201); // outra pessoa
  // a cobrança dessa pessoa junta as pendências mesmo vindas de "outro apto"
  const id = (await db.query("select id from reservations where start_at=$1", [Z(D(7), "05:00")])).rows[0].id;
  await db.query("update reservations set name='Karina Teste', plate='KAR1A23' where id=$1", [id]);
  eq((await detail(id)).charge.length, 3); });
await test("ESTACIONOU SEM AGENDAR: moradores que já usaram (só admin, agrupados, com pendências); registro com taxa somada e mostrada separada; recalcular mantém a taxa", async () => {
  eq((await call("GET", "/api/admin/residents")).status, 401);
  const list = (await call("GET", "/api/admin/residents", { jar: ADM })).json;
  const k = list.find((x) => x.name === "Kárina Teste" && x.apartment === "811"); assert.ok(k, "morador listado");
  eq(k.uses, 2); eq(k.plate, "KAR1A23"); eq(k.pendingCount, 2); eq(k.pendingCents, 3000); // as 2 já usadas (a futura não conta)
  assert.ok(!list.some((x) => x.name === "Horário bloqueado")); // bloqueios não viram morador
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, noBookingFee: 12.5 }) })).status, 200);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.noBookingFee, 12.5);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ maximumReservationAdvanceDays: 14, noBookingFee: -1 }) })).status, 400);
  const c = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: Z(D(-10), "09:00"), endAt: Z(D(-10), "17:00"), status: "irregular",
    name: k.name, apartment: k.apartment, plate: k.plate, feeCents: 1250 } });
  eq(c.status, 201, c.text);
  let row = await dbRow(c.json.id); eq(row.fee_cents, 1250); eq(row.total_cents, 3000 + 1250); // dia R$30 + taxa
  const d = await detail(c.json.id); const item = d.charge.find((x) => x.id === c.json.id); eq(item.fee_cents, 1250); eq(item.total_cents, 4250);
  eq(d.charge.length, 3); // as 2 já usadas em aberto + esta
  // mudar o horário recalculando: o uso muda, a taxa fica
  eq((await call("PATCH", `/api/admin/reservations/${c.json.id}`, { jar: ADM, body: { endAt: Z(D(-9), "10:00"), priceMode: "recalc" } })).status, 200);
  row = await dbRow(c.json.id); eq(row.fee_cents, 1250); // uso recalculado (abaixo) + a mesma taxa
  eq(row.total_cents - row.fee_cents, (await call("POST", "/api/admin/quote", { jar: ADM, body: { startAt: Z(D(-10), "09:00"), endAt: Z(D(-9), "10:00") } })).json.totalCents);
  // editar só a taxa / tirar a taxa: total acompanha e fica no histórico
  eq((await call("PATCH", `/api/admin/reservations/${c.json.id}`, { jar: ADM, body: { feeCents: 0 } })).status, 200);
  const r2 = await dbRow(c.json.id); eq(r2.fee_cents, 0); eq(r2.total_cents, row.total_cents - 1250);
  assert.ok((await db.query("select 1 from reservation_events where reservation_id=$1 and details->'changes' ? 'taxa'", [c.json.id])).rowCount === 1);
  eq((await call("PATCH", `/api/admin/reservations/${c.json.id}`, { jar: ADM, body: { feeCents: -5 } })).status, 400);
  // bloqueio nunca tem taxa
  const b = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: Z(D(12), "03:00"), endAt: Z(D(12), "04:00"), status: "bloqueada", feeCents: 999 } });
  eq((await dbRow(b.json.id)).fee_cents, 0);
  // quitar a Karina para não afetar os testes seguintes
  await db.query("update reservations set payment_status='pago', paid_at=now() where plate in ('KAR1A23','ZZZ9Z98','ZZZ9Z99') or name ilike 'kar%'"); });
await test("VIZINHO vê a taxa separada em \"Minhas reservas\"", async () => {
  const J = {}; eq((await book(D(8), "01:00", D(8), "02:00", { jar: J, extra: who("812") })).status, 201); const [id] = await mineIds(J);
  eq((await call("PATCH", `/api/admin/reservations/${id}`, { jar: ADM, body: { feeCents: 1000 } })).status, 200);
  const m = (await call("GET", "/api/minhas-reservas", { jar: J })).json[0]; eq(m.feeCents, 1000); eq(m.totalCents, 1500 + 1000); });
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
  assert.match(W.waLink("43998765432", "oi & tchau"), /^https:\/\/api\.whatsapp\.com\/send\?phone=5543998765432&text=oi%20%26%20tchau$/);
  eq(W.waLink("", "😀✅"), "https://api.whatsapp.com/send?text=%F0%9F%98%80%E2%9C%85"); // emoji em UTF-8
  assert.match(W.waLink("", "x"), /^https:\/\/api\.whatsapp\.com\/send\?text=x$/);
  const m = W.chargeMessage("Karina Waldrich", [{ start_at: Z(D(3), "01:00"), end_at: Z(D(3), "02:00"), total_cents: 1500 }, { start_at: Z(D(4), "01:00"), end_at: Z(D(4), "02:00"), total_cents: 3000 }], "pix@exemplo.com");
  assert.match(m, /^Oi, Karina!/); assert.match(m, /Total: R\$\s45,00/); assert.match(m, /Chave PIX: pix@exemplo\.com/);
  const t = W.chargeMessage("K", [{ start_at: Z(D(3), "01:00"), end_at: Z(D(3), "02:00"), total_cents: 2500, fee_cents: 1000 }]);
  assert.match(t, /R\$\s25,00 \(inclui R\$\s10,00 de taxa por estacionar sem agendar\)/); assert.match(t, /Total: R\$\s25,00/);
  let I; try { I = await import("../lib/identity.ts"); } catch { return; }
  eq(I.nameKey("  Kárina   SILVA "), "karina silva"); eq(I.nameKey("Jo"), ""); eq(I.plateKey("abc-1d23"), "ABC1D23"); eq(I.plateKey("123"), "");
  eq(I.samePerson({ apartment: "Apto 101" }, { apartment: "101" }), true); eq(I.samePerson({ name: "", plate: "" }, { name: "", plate: "" }), false);
  eq(I.samePerson({ name: "Ana", apartment: "1", plate: "AAA1A11" }, { name: "Ana B", apartment: "2", plate: "AAA1A12" }), false); });
await test("LOGOUT revoga na hora: token copiado antes do logout deixa de funcionar (API e página)", async () => {
  const J = {}; await login(J); const copy = { adm: J.adm }; eq((await call("GET", "/api/admin/reservations", { jar: copy })).status, 200);
  eq((await call("DELETE", "/api/admin/login", { jar: J })).status, 200); eq(Object.keys(J).length, 0);
  eq((await call("GET", "/api/admin/reservations", { jar: copy })).status, 401); eq((await call("GET", "/admin", { jar: copy })).status, 307); });
await test("quem não está logado não consegue deslogar o admin (DELETE /login sem sessão não revoga nada)", async () => {
  const J = {}; await login(J); eq((await call("DELETE", "/api/admin/login")).status, 200); eq((await call("GET", "/api/admin/reservations", { jar: J })).status, 200); });

await test("passo do seletor de horário (5/10/30 min): padrão 30, configurável, ausente = não mexe", async () => {
  await login(ADM); // os testes de logout acima revogam a sessão
  eq((await call("GET", "/api/config")).json.timeStepMinutes, 30);
  eq((await call("PUT", "/api/admin/settings", { body: cfg({ timeStepMinutes: 5 }) })).status, 401);
  for (const n of [0, 7, 15, 60, "5"]) eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ timeStepMinutes: n }) })).status, 400, String(n));
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ timeStepMinutes: 10 }) })).status, 200);
  eq((await call("GET", "/api/config")).json.timeStepMinutes, 10); eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.timeStepMinutes, 10);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200); eq((await call("GET", "/api/config")).json.timeStepMinutes, 10); // sem o campo: continua 10
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ timeStepMinutes: 30 }) })).status, 200); });
await test("PACOTES: diária R$40, fim de semana e semana; sempre a combinação mais barata; null desliga", async () => {
  await login(ADM);
  const pk = (o = {}) => cfg({ pricing: { dayPrice: 30, nightPrice: 15, dayStartHour: 9, nightStartHour: 18, checkoutTime: "10:00", fullDayPrice: 40, weekendPrice: 100, weekPrice: 260, ...o } });
  const quote = async (a, b) => (await call("POST", "/api/admin/quote", { jar: ADM, body: { startAt: a, endAt: b } })).json;
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: pk() })).status, 200);
  eq((await call("GET", "/api/config")).json.pricing.fullDayPrice, 40);
  const diaria = await quote(Z("2027-03-03", "09:00"), Z("2027-03-04", "10:00")); // quarta 09h → quinta 10h
  eq(diaria.totalCents, 4000); eq(diaria.breakdown.packages[0].kind, "diaria"); eq(diaria.breakdown.packages[0].fullCents, 4500);
  eq((await quote(Z("2027-03-03", "09:00"), Z("2027-03-03", "18:00"))).totalCents, 3000); // só o dia: avulso
  eq((await quote(Z("2027-03-03", "18:00"), Z("2027-03-04", "10:00"))).totalCents, 1500); // pernoite
  eq((await quote(Z("2027-03-01", "09:00"), Z("2027-03-08", "10:00"))).totalCents, 26000); // segunda → segunda: semana
  // sexta 18h → segunda 10h: 1 noite + 2 diárias = R$95 < pacote de R$100; com o pacote a R$80 ele é usado
  eq((await quote(Z("2027-03-05", "18:00"), Z("2027-03-08", "10:00"))).totalCents, 9500);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: pk({ weekendPrice: 80 }) })).status, 200);
  const fds = await quote(Z("2027-03-05", "18:00"), Z("2027-03-08", "10:00")); eq(fds.totalCents, 8000); eq(fds.breakdown.packages[0].kind, "fimdesemana");
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: pk({ fullDayPrice: -1 }) })).status, 400);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200); // sem os campos = pacotes desligados
  eq((await quote(Z("2027-03-03", "09:00"), Z("2027-03-04", "10:00"))).totalCents, 4500); });
await test("CUSTO MENSAL: padrão 200; admin altera (auditado); ausente = não mexe; negativo → 400", async () => {
  await login(ADM);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.monthlyCost, 200);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ monthlyCost: 210.5 }) })).status, 200);
  eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.monthlyCost, 210.5);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg() })).status, 200); eq((await call("GET", "/api/admin/settings", { jar: ADM })).json.monthlyCost, 210.5);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ monthlyCost: -1 }) })).status, 400);
  assert.ok((await db.query("select 1 from reservation_events where action='configuracao_alterada' and details->>'chave'='finance'")).rowCount >= 1);
  eq((await call("PUT", "/api/admin/settings", { jar: ADM, body: cfg({ monthlyCost: 200 }) })).status, 200); });
await test("BACKUP: só admin; JSON sem hash do código nem admin_epoch; CSV com ; e fórmula neutralizada", async () => {
  await login(ADM);
  eq((await call("GET", "/api/admin/export")).status, 401); eq((await call("GET", "/api/admin/export?format=csv")).status, 401);
  const r = await call("POST", "/api/admin/reservations", { jar: ADM, body: { startAt: Z(D(9), "03:00"), endAt: Z(D(9), "04:00"), status: "confirmada", name: "=HIPERLINK(\"x\")", apartment: "12" } });
  eq(r.status, 201, r.text);
  const j = await call("GET", "/api/admin/export", { jar: ADM }); eq(j.status, 200);
  assert.match(j.headers.get("content-disposition") ?? "", /attachment; filename="garagem-backup-/);
  assert.ok(j.json.reservations.length >= 1 && Array.isArray(j.json.events)); assert.ok(!("access_hash" in j.json.reservations[0]));
  assert.ok(!("admin_epoch" in j.json.settings) && "pricing" in j.json.settings);
  const c = await call("GET", "/api/admin/export?format=csv", { jar: ADM }); eq(c.status, 200);
  assert.match(c.headers.get("content-type") ?? "", /text\/csv/); assert.ok(c.text.includes(`"'=HIPERLINK(""x"")"`)); assert.ok(c.text.split("\r\n")[0].includes(";")); });

// ================= CRÉDITO (pagou a mais) =================
const CR = { name: "Credora Teste", apartment: "950", plate: "CRD1A23" }; // dona do crédito
const CJ = {}; // o aparelho dela
const idAt = async (d, hm) => (await db.query("select id from reservations where start_at=$1 and deleted_at is null", [Z(d, hm)])).rows[0].id;
const pay = (id, cents, jar = ADM) => call("POST", `/api/admin/reservations/${id}/pagamento`, { jar, body: { receivedCents: cents } });
const credit = async (jar) => (await call("GET", "/api/minhas-reservas/credito", { jar })).json.creditCents;
await test("CRÉDITO: pagou R$60 devendo R$30 → reserva quitada e R$30 guardados; lote e uso imutáveis; banco recusa saldo negativo", async () => {
  await login(ADM);
  const r = await book(D(10), "13:00", D(10), "14:00", { jar: CJ, extra: CR }); eq(r.status, 201); eq(r.json.totalCents, 3000); eq(r.json.creditUsedCents, 0); eq(r.json.paymentStatus, "pendente");
  const id = await idAt(D(10), "13:00");
  const p = await pay(id, 6000); eq(p.status, 200, p.text); eq(p.json.paid, true); eq(p.json.usedHereCents, 3000); eq(p.json.creditLeftCents, 3000);
  const d = await detail(id); eq(d.payment_status, "pago"); assert.ok(d.paid_at); eq(d.credit_cents, 3000); eq(d.credit.balanceCents, 3000); eq(d.credit.lots[0].remainingCents, 3000);
  assert.ok(d.events.some((e) => e.action === "pagamento_registrado" && e.details.recebido_cents === 6000)); assert.ok(d.events.some((e) => e.action === "credito_usado" && e.details.quitou));
  eq(await credit(CJ), 3000); eq(await credit(undefined), 0); eq(await credit({}), 0);
  await assert.rejects(db.query("update credits set amount_cents = 1"), /imutável/); await assert.rejects(db.query("delete from credit_uses"), /imutável/);
  const lot = (await db.query("select id from credits where reservation_id=$1", [id])).rows[0].id;
  await assert.rejects(db.query("insert into credit_uses (credit_id, amount_cents, reason) values ($1, 999999, 'baixa')", [lot]), /saldo inválido/); });
await test("CRÉDITO: a próxima reserva do mesmo aparelho já nasce paga com o crédito; \"Minhas reservas\" mostra o abatido", async () => {
  const r = await book(D(11), "13:00", D(11), "14:00", { jar: CJ, extra: CR }); eq(r.status, 201); eq(r.json.creditUsedCents, 3000); eq(r.json.paymentStatus, "pago");
  eq(await credit(CJ), 0);
  const m = (await call("GET", "/api/minhas-reservas", { jar: CJ })).json.find((x) => x.start === Z(D(11), "13:00")); eq(m.creditCents, 3000); eq(m.paymentStatus, "pago"); eq(m.paidWithCredit, true);
  const first = (await call("GET", "/api/minhas-reservas", { jar: CJ })).json.find((x) => x.start === Z(D(10), "13:00")); eq(first.paidWithCredit, false); }); // paga com o próprio PIX
await test("CRÉDITO: outro aparelho com os mesmos dados ou outra pessoa do mesmo apto NÃO usa nem vê o crédito; admin usa pelo painel", async () => {
  eq((await book(D(13), "13:00", D(13), "14:00", { jar: CJ, extra: CR })).json.creditUsedCents, 0); // sem saldo agora
  const p = await pay(await idAt(D(13), "13:00"), 7500); eq(p.json.paid, true); eq(p.json.creditLeftCents, 4500);
  const K = {}; // aparelho de outra pessoa digitando os dados da Credora
  const k1 = await book(D(13), "15:00", D(13), "16:00", { jar: K, extra: CR }); eq(k1.json.creditUsedCents, 0); eq(k1.json.paymentStatus, "pendente");
  eq(await credit(K), 0);
  const k2 = await book(D(13), "17:00", D(13), "18:00", { jar: K, extra: CR }); eq(k2.json.creditUsedCents, 0); // a 1ª reserva dele não está paga: continua sem acesso
  const outra = await book(D(13), "19:00", D(13), "20:00", { jar: CJ, extra: { name: "Vizinha Outra", apartment: "950", plate: "OUT1A23" } });
  eq(outra.json.creditUsedCents, 0); // mesmo apto, outro nome: o crédito não é dela
  const u = await call("POST", `/api/admin/reservations/${await idAt(D(13), "15:00")}/credito`, { jar: ADM, body: { action: "usar" } });
  eq(u.status, 200, u.text); eq(u.json.usedCents, 3000); eq(u.json.paid, true); eq(u.json.creditLeftCents, 1500);
  const o = await call("POST", `/api/admin/reservations/${await idAt(D(13), "19:00")}/credito`, { jar: ADM, body: { action: "usar" } });
  eq(o.status, 400); assert.match(o.json.error, /não tem crédito/); });
await test("CRÉDITO: cancelar reserva paga com crédito devolve o valor, que paga sozinho a próxima pendência da pessoa; vizinho cancelando também devolve", async () => {
  const k1 = await idAt(D(13), "15:00"), k2 = await idAt(D(13), "17:00");
  eq((await call("PATCH", `/api/admin/reservations/${k1}`, { jar: ADM, body: { status: "cancelada" } })).status, 200);
  assert.ok((await detail(k1)).events.some((e) => e.action === "credito_devolvido" && e.details.valor_cents === 3000));
  const d2 = await detail(k2); eq(d2.payment_status, "pago"); eq(d2.credit_cents, 3000); eq(d2.credit.balanceCents, 1500);
  const mine = (await call("GET", "/api/minhas-reservas", { jar: CJ })).json.find((x) => x.start === Z(D(11), "13:00"));
  eq((await call("DELETE", `/api/minhas-reservas/${mine.id}`, { jar: CJ })).status, 200);
  eq(await credit(CJ), 4500); });
await test("CRÉDITO: \"voltar para pendente\" devolve o crédito e NÃO reaplica; excluir devolve; contas e backup incluem o crédito", async () => {
  const r = await book(D(10), "17:00", D(10), "18:00", { jar: CJ, extra: CR }); eq(r.json.creditUsedCents, 3000); eq(r.json.paymentStatus, "pago");
  const id = await idAt(D(10), "17:00"); eq(await credit(CJ), 1500);
  eq((await call("PATCH", `/api/admin/reservations/${id}`, { jar: ADM, body: { paymentStatus: "pendente" } })).status, 200);
  const d = await detail(id); eq(d.payment_status, "pendente"); eq(d.credit_cents, 0); eq(await credit(CJ), 4500);
  eq((await call("POST", `/api/admin/reservations/${id}/credito`, { jar: ADM, body: { action: "usar" } })).json.usedCents, 3000);
  eq((await call("DELETE", `/api/admin/reservations/${id}`, { jar: ADM })).status, 200); eq(await credit(CJ), 4500);
  const list = (await call("GET", "/api/admin/reservations", { jar: ADM })).json; assert.ok(list.every((x) => typeof x.credit_cents === "number"));
  const b = (await call("GET", "/api/admin/export", { jar: ADM })).json; assert.ok(b.credits.length >= 2 && b.creditUses.length >= 4);
  assert.ok((await call("GET", "/api/admin/export?format=csv", { jar: ADM })).text.split("\r\n")[0].includes("abatido com crédito")); });
await test("PAGAMENTO PARCIAL: recebeu menos → abate e continua pendente; cobrança conta só o que falta; valores inválidos → 400; só admin", async () => {
  const PJ = {}, P = { name: "Parcial Teste", apartment: "951", plate: "PRC1A23" };
  eq((await book(D(10), "15:00", D(10), "16:00", { jar: PJ, extra: P })).status, 201); const id = await idAt(D(10), "15:00");
  eq((await pay(id, 1000, {})).status, 401);
  for (const v of [0, -5, 1.5, "10"]) eq((await pay(id, v)).status, 400, String(v));
  const p = await pay(id, 1000); eq(p.json.paid, false); eq(p.json.usedHereCents, 1000); eq(p.json.creditLeftCents, 0);
  const d = await detail(id); eq(d.payment_status, "pendente"); eq(d.credit_cents, 1000);
  const item = d.charge.find((c) => c.id === id); eq(item.credit_cents, 1000);
  eq((await call("POST", `/api/admin/reservations/${id}/cobranca`, { jar: ADM })).status, 200);
  const ev = (await detail(id)).events.filter((e) => e.action === "cobranca_aberta").at(-1); assert.match(ev.details.total, /20,00/);
  eq((await call("GET", "/api/minhas-reservas", { jar: PJ })).json[0].creditCents, 1000);
  eq((await pay(id, 2000)).json.paid, true);
  const again = await pay(id, 500); eq(again.status, 400); assert.match(again.json.error, /já está paga/);
  eq((await pay(crypto.randomUUID(), 500)).status, 404); eq((await pay("x", 500)).status, 404); });
await test("CRÉDITO AVULSO e BAIXA: lançar paga a pendência e guarda o resto; baixa zera o saldo (auditada); só admin", async () => {
  const PJ = {}, P = { name: "Parcial Teste", apartment: "951", plate: "PRC1A23" };
  eq((await book(D(11), "15:00", D(11), "16:00", { jar: PJ, extra: P })).status, 201); const id = await idAt(D(11), "15:00");
  eq((await call("POST", `/api/admin/reservations/${id}/credito`, { body: { action: "lancar", amountCents: 5000 } })).status, 401);
  eq((await call("POST", `/api/admin/reservations/${id}/credito`, { jar: ADM, body: { action: "lancar", amountCents: 0 } })).status, 400);
  eq((await call("POST", `/api/admin/reservations/${id}/credito`, { jar: ADM, body: { action: "outra" } })).status, 400);
  const r = await call("POST", `/api/admin/reservations/${id}/credito`, { jar: ADM, body: { action: "lancar", amountCents: 5000, note: "PIX sem reserva" } });
  eq(r.status, 200, r.text); eq(r.json.usedCents, 3000); eq(r.json.creditLeftCents, 2000); eq((await detail(id)).payment_status, "pago");
  const lot = (await detail(id)).credit.lots[0]; eq(lot.remainingCents, 2000); eq(lot.note, "PIX sem reserva");
  eq((await call("POST", `/api/admin/creditos/${lot.id}/baixa`, { body: {} })).status, 401);
  eq((await call("POST", `/api/admin/creditos/${crypto.randomUUID()}/baixa`, { jar: ADM, body: {} })).status, 404);
  const b = await call("POST", `/api/admin/creditos/${lot.id}/baixa`, { jar: ADM, body: { note: "devolvido em dinheiro" } }); eq(b.status, 200, b.text); eq(b.json.removedCents, 2000);
  eq((await detail(id)).credit.balanceCents, 0);
  eq((await call("POST", `/api/admin/creditos/${lot.id}/baixa`, { jar: ADM, body: {} })).json.removedCents, 0);
  assert.ok((await db.query("select 1 from reservation_events where action='credito_baixa' and details->>'obs'='devolvido em dinheiro'")).rowCount === 1); });
await test("CORRIDA: 4 pedidos simultâneos de \"usar crédito\" com saldo para 1 reserva → só R$15 são gastos", async () => {
  const Q = { name: "Corrida Credito", apartment: "952", plate: "RAC1E23" };
  for (const h of ["19", "21", "22", "23", "13"]) eq((await book(D(12), `${h}:00`, D(12), `${h}:30`, { extra: Q })).status, 201);
  const ids = []; for (const h of ["19", "21", "22", "23", "13"]) ids.push(await idAt(D(12), `${h}:00`));
  for (const id of ids.slice(0, 4)) await db.query("insert into payment_receipts (reservation_id, mime, data) values ($1, 'image/jpeg', '\\xffd8')", [id]); // pula o automático
  eq((await call("PATCH", `/api/admin/reservations/${ids[4]}`, { jar: ADM, body: { status: "cancelada" } })).status, 200);
  // a 5ª (13h) é cancelada só para receber o lançamento sem ser paga por ele
  const l = await call("POST", `/api/admin/reservations/${ids[4]}/credito`, { jar: ADM, body: { action: "lancar", amountCents: 1500 } }); eq(l.json.usedCents, 0); eq(l.json.creditLeftCents, 1500);
  const rs = await Promise.all(ids.slice(0, 4).map((id) => call("POST", `/api/admin/reservations/${id}/credito`, { jar: ADM, body: { action: "usar" } })));
  const used = rs.filter((r) => r.status === 200).reduce((t, r) => t + r.json.usedCents, 0); eq(used, 1500); // os outros: 400 "sem crédito" ou 0
  eq((await db.query("select coalesce(sum(u.amount_cents),0)::int s from credit_uses u join credits c on c.id=u.credit_id where c.name='Corrida Credito'")).rows[0].s, 1500); });

// ================= PEDIDOS DE CRÉDITO (vizinho adiciona, admin confirma) =================
const V = { name: "Vizinho Credito", apartment: "960", plate: "VCR1A23" };
const VJ = {}; let reqV;
const askCredit = (body, jar) => call("POST", "/api/creditos", { jar, body });
const sendFile = (url, buf, jar, name = "c.jpg") => { const f = new FormData(); f.append("file", new Blob([buf]), name); return call("POST", url, { form: f, jar }); };
const myCredit = async (jar) => (await call("GET", "/api/creditos", { jar })).json;
await test("PEDIDO DE CRÉDITO: vizinho pede com comprovante; não vira saldo antes de confirmar; só o dono anexa/vê; validações", async () => {
  await login(ADM);
  for (const bad of [{ ...V, amountCents: 50 }, { ...V, apartment: "", amountCents: 6000 }, { ...V, amountCents: 6000, name: "<b>x</b>" }, { ...V, amountCents: 1.5 }])
    eq((await askCredit(bad, {})).status, 400, JSON.stringify(bad));
  const r = await askCredit({ ...V, amountCents: 6000, note: "PIX das 10h" }, VJ); eq(r.status, 201, r.text); reqV = r.json.id;
  const m = await myCredit(VJ); eq(m.owner, null); eq(m.balanceCents, 0); eq(m.requests[0].status, "pendente"); eq(m.requests[0].amountCents, 6000);
  assert.deepEqual(Object.keys(m.requests[0]).sort(), ["adminNote", "amountCents", "confirmedCents", "createdAt", "decidedAt", "id", "receiptCount", "status"]);
  eq((await myCredit({})).requests.length, 0);
  eq((await sendFile(`/api/creditos/${reqV}/comprovante`, JPEG(), {})).status, 404); // outro aparelho
  eq((await sendFile(`/api/creditos/${reqV}/comprovante`, Buffer.from("lixo"), VJ)).status, 400);
  eq((await sendFile(`/api/creditos/${reqV}/comprovante`, JPEG(), VJ)).status, 201);
  eq((await myCredit(VJ)).requests[0].receiptCount, 1);
  eq((await call("GET", "/api/admin/creditos")).status, 401);
  const o = (await call("GET", "/api/admin/creditos", { jar: ADM })).json.requests.find((x) => x.id === reqV);
  eq(o.status, "pendente"); eq(o.receipts.length, 1); eq(o.receipts[0].actor, "vizinho"); eq(o.note, "PIX das 10h");
  eq((await call("GET", `/api/admin/credit-receipts/${o.receipts[0].id}`)).status, 401);
  const f = await call("GET", `/api/admin/credit-receipts/${o.receipts[0].id}`, { jar: ADM }); eq(f.status, 200); eq(f.headers.get("content-type"), "image/jpeg"); });
await test("CONFIRMAR: crédito com o valor recebido paga a pendência; a próxima reserva do aparelho já nasce paga; extrato do vizinho", async () => {
  eq((await book(D(10), "19:00", D(10), "20:00", { jar: VJ, extra: V })).json.creditUsedCents, 0); // ainda nada confirmado
  const pend = await idAt(D(10), "19:00");
  eq((await call("POST", `/api/admin/creditos/pedidos/${reqV}`, { body: { action: "confirmar", amountCents: 5000 } })).status, 401);
  const c = await call("POST", `/api/admin/creditos/pedidos/${reqV}`, { jar: ADM, body: { action: "confirmar", amountCents: 5000 } });
  eq(c.status, 200, c.text); eq(c.json.usedCents, 1500); eq(c.json.creditLeftCents, 3500);
  eq((await detail(pend)).payment_status, "pago");
  const again = await call("POST", `/api/admin/creditos/pedidos/${reqV}`, { jar: ADM, body: { action: "confirmar", amountCents: 5000 } }); eq(again.status, 400);
  eq((await db.query("select count(*)::int n from credits where request_id=$1", [reqV])).rows[0].n, 1);
  const m = await myCredit(VJ); eq(m.owner.name, V.name); eq(m.balanceCents, 3500); eq(m.requests[0].status, "confirmado"); eq(m.requests[0].confirmedCents, 5000);
  eq(m.movements[0].type, "entrada"); eq(m.movements[0].amountCents, 5000); eq(m.movements.at(-1).balanceCents, 3500);
  const b = await book(D(11), "19:00", D(11), "20:00", { jar: VJ, extra: V }); eq(b.json.creditUsedCents, 1500); eq(b.json.paymentStatus, "pago");
  eq((await myCredit(VJ)).balanceCents, 2000); eq(await credit(VJ), 2000);
  eq((await sendFile(`/api/creditos/${reqV}/comprovante`, JPEG(), VJ)).status, 400); // já analisado
  eq((await sendFile(`/api/admin/creditos/pedidos/${reqV}/comprovante`, JPEG(), ADM)).status, 201); // admin pode
  eq((await sendFile(`/api/admin/creditos/pedidos/${reqV}/comprovante`, JPEG(), {})).status, 401); });
await test("RECUSAR e CANCELAR: não criam crédito; vizinho vê o motivo; pedido decidido não muda", async () => {
  const r1 = (await askCredit({ ...V, amountCents: 2000 }, VJ)).json.id;
  eq((await call("POST", `/api/admin/creditos/pedidos/${r1}`, { jar: ADM, body: { action: "recusar", note: "PIX não caiu" } })).status, 200);
  const m = (await myCredit(VJ)).requests.find((x) => x.id === r1); eq(m.status, "recusado"); eq(m.adminNote, "PIX não caiu");
  eq((await call("DELETE", `/api/creditos/${r1}`, { jar: VJ })).status, 404);
  eq((await call("POST", `/api/admin/creditos/pedidos/${r1}`, { jar: ADM, body: { action: "confirmar", amountCents: 2000 } })).status, 400);
  const r2 = (await askCredit({ ...V, amountCents: 3000 }, VJ)).json.id;
  eq((await call("DELETE", `/api/creditos/${r2}`, {})).status, 404); // outro aparelho
  eq((await call("DELETE", `/api/creditos/${r2}`, { jar: VJ })).status, 200);
  eq((await call("POST", `/api/admin/creditos/pedidos/${r2}`, { jar: ADM, body: { action: "confirmar", amountCents: 3000 } })).status, 400);
  eq((await call("POST", `/api/admin/creditos/pedidos/${crypto.randomUUID()}`, { jar: ADM, body: { action: "recusar" } })).status, 404);
  eq((await myCredit(VJ)).balanceCents, 2000); });
await test("PAINEL DE CRÉDITOS: quem tem crédito com saldo e extrato; lançar crédito sem reserva com comprovante; admin anexa comprovante na reserva", async () => {
  eq((await call("POST", "/api/admin/creditos", { jar: ADM, body: { name: "Sem Reserva", amountCents: 2500 } })).status, 400); // sem apto nem placa
  const n = await call("POST", "/api/admin/creditos", { jar: ADM, body: { name: "Sem Reserva", apartment: "961", amountCents: 2500, note: "PIX avulso" } });
  eq(n.status, 201, n.text); eq(n.json.creditLeftCents, 2500);
  eq((await sendFile(`/api/admin/creditos/pedidos/${n.json.requestId}/comprovante`, JPEG(), ADM)).status, 201);
  const o = (await call("GET", "/api/admin/creditos", { jar: ADM })).json;
  const sr = o.people.find((p) => p.name === "Sem Reserva"); eq(sr.balanceCents, 2500); eq(sr.movements.length, 1);
  const vc = o.people.find((p) => p.name === V.name); eq(vc.balanceCents, 2000); eq(vc.receivedCents, 5000);
  assert.deepEqual(vc.movements.map((x) => x.type), ["entrada", "abatimento", "abatimento"]);
  const lr = o.requests.find((x) => x.id === n.json.requestId); eq(lr.status, "confirmado"); eq(lr.source, "admin"); eq(lr.receipts[0].actor, "admin");
  const rid = await idAt(D(11), "19:00");
  eq((await sendFile(`/api/admin/reservations/${rid}/comprovante`, JPEG(), {})).status, 401);
  eq((await sendFile(`/api/admin/reservations/${rid}/comprovante`, JPEG(), ADM)).status, 201);
  const d = await detail(rid); eq(d.receipts.length, 1); assert.ok(d.events.some((e) => e.action === "comprovante_anexado"));
  const b = (await call("GET", "/api/admin/export", { jar: ADM })).json; assert.ok(b.creditRequests.length >= 4); });
console.log(`\n${pass} passaram, ${fail} falharam`); await db.end(); process.exit(fail ? 1 : 0);
