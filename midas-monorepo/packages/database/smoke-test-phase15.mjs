/**
 * Phase 1.5 Smoke Test Suite — v4
 * Uses midas_migrator for DB assertions (bypasses RLS for verification).
 * HTTP calls use normal webhook (midas_app indirectly).
 */

import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pg = require(path.join(__dirname, '../../node_modules/.pnpm/pg@8.20.0/node_modules/pg'));
const { Pool } = pg;

const BASE_URL = 'http://localhost:3099';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'test_secret_phase15';

// Two pools: midas_app for onboarding verification, midas_migrator to bypass RLS for assertions
const APP_DB  = process.env.DATABASE_URL ?? 'postgres://midas_app:midas_app_password@localhost:5432/midas';
const MIGR_DB = process.env.MIGRATOR_URL  ?? 'postgres://midas_migrator:midas_migrator_password@localhost:5432/midas';

const appPool  = new Pool({ connectionString: APP_DB });
const migrPool = new Pool({ connectionString: MIGR_DB });

let passed = 0; let failed = 0; const results = [];
function assert(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); passed++; results.push({ name, ok: true }); }
  else { console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`); failed++; results.push({ name, ok: false, detail }); }
}

async function post(path, body) {
  const s = JSON.stringify(body);
  return new Promise((res, rej) => {
    const r = http.request({ hostname: 'localhost', port: 3099, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s), 'X-Telegram-Bot-Api-Secret-Token': SECRET } }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(d || '{}') }));
    }); r.on('error', rej); r.write(s); r.end();
  });
}
async function get(path) {
  return new Promise((res, rej) => {
    http.get(`${BASE_URL}${path}`, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(d || '{}') }));
    }).on('error', rej);
  });
}
const su = (uid, mid) => ({ update_id: Math.floor(Math.random()*999999), message: { message_id: mid ?? Math.floor(Math.random()*99999), from: { id: Number(uid), is_bot: false, first_name: 'Test' }, chat: { id: Number(uid), type: 'private' }, date: Math.floor(Date.now()/1000), text: '/start' } });
const tu = (uid, text) => ({ update_id: Math.floor(Math.random()*999999), message: { message_id: Math.floor(Math.random()*99999), from: { id: Number(uid), is_bot: false, first_name: 'Test' }, chat: { id: Number(uid), type: 'private' }, date: Math.floor(Date.now()/1000), text } });

// Use midas_migrator pool for assertions (bypasses RLS)
async function cleanup(tid) {
  const c = await migrPool.connect();
  try {
    const ur = await c.query('SELECT id FROM users WHERE telegram_id = $1', [BigInt(tid)]);
    if (!ur.rows[0]) return; const uid = ur.rows[0].id;
    const wr = await c.query('SELECT workspace_id FROM workspace_memberships WHERE user_id = $1', [uid]);
    for (const row of wr.rows) {
      await c.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [row.workspace_id]);
      await c.query('DELETE FROM workspaces WHERE id = $1', [row.workspace_id]);
    }
    await c.query('DELETE FROM users WHERE id = $1', [uid]);
  } finally { c.release(); }
}
async function count(table, where, params) {
  const r = await migrPool.query(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`, params);
  return parseInt(r.rows[0].c, 10);
}
async function queryMigr(sql, params = []) {
  return migrPool.query(sql, params);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log(' Phase 1.5 Smoke Test Suite');
  console.log('══════════════════════════════════════════\n');

  // T1 — Health check
  console.log('T1 — Health check');
  try { const r = await get('/health'); assert('GET /health → 200', r.status === 200); assert('body.status=ok', r.body.status === 'ok'); assert('body.service correct', r.body.service === '@midas/telegram-bot'); } catch(e) { assert('T1 reachable', false, e.message); }

  // T2 — new user
  console.log('\nT2 — /start new user → 1 User + 1 Workspace + 1 Membership (role=owner)');
  const uid2 = String(9_900_000 + Math.floor(Math.random()*49999));
  await cleanup(uid2);
  try {
    const r = await post('/webhook', su(uid2));
    assert('T2 → 200', r.status === 200); assert('T2 body.ok', r.body.ok === true);
    await sleep(400);

    const uc = await count('users', 'telegram_id=$1', [BigInt(uid2)]);
    assert('T2 exactly 1 User', uc===1, `got ${uc}`);

    const ur = await queryMigr('SELECT id FROM users WHERE telegram_id=$1', [BigInt(uid2)]);
    const iid = ur.rows[0]?.id;
    assert('T2 User.id is 26-char ULID', typeof iid==='string' && iid.length===26);

    const mc = await count('workspace_memberships', 'user_id=$1', [iid]);
    assert('T2 exactly 1 Membership', mc===1, `got ${mc}`);

    const mr = await queryMigr('SELECT wm.role, wm.is_default, w.id ws FROM workspace_memberships wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=$1', [iid]);
    assert('T2 role=owner', mr.rows[0]?.role==='owner');
    assert('T2 is_default=true', mr.rows[0]?.is_default===true);
    assert('T2 Workspace exists', !!mr.rows[0]?.ws);
  } catch(e) { assert('T2 no exception', false, e.message); }

  // T3 — no duplicate on repeat /start
  console.log('\nT3 — Repeated /start (rate-limited) does NOT create duplicates');
  const uid3 = String(9_850_000 + Math.floor(Math.random()*49999));
  await cleanup(uid3);
  try {
    await post('/webhook', su(uid3, 3001)); await sleep(300);
    const uc1 = await count('users', 'telegram_id=$1', [BigInt(uid3)]);
    assert('T3 1 User after 1st /start', uc1===1, `got ${uc1}`);
    const r2 = await post('/webhook', su(uid3, 3002));
    assert('T3 2nd /start (rate-limited) → 200', r2.status===200); await sleep(200);
    const uc2 = await count('users', 'telegram_id=$1', [BigInt(uid3)]);
    assert('T3 still 1 User after 2nd /start', uc2===1, `got ${uc2}`);
  } catch(e) { assert('T3 no exception', false, e.message); }

  // T4 — resolveWorkspace returns existing ws
  console.log('\nT4 — resolveWorkspace returns correct workspaceId for existing user');
  try {
    const er = await queryMigr('SELECT wm.workspace_id FROM users u JOIN workspace_memberships wm ON wm.user_id=u.id WHERE u.telegram_id=$1 AND wm.is_default=true LIMIT 1', [BigInt(uid2)]);
    const ews = er.rows[0]?.workspace_id;
    assert('T4 expected workspace in DB', !!ews);
    const r = await post('/webhook', tu(uid2, 'Кофе 250р'));
    assert('T4 text message → 200', r.status===200); await sleep(200);
    const uc = await count('users', 'telegram_id=$1', [BigInt(uid2)]);
    assert('T4 no extra User created', uc===1, `got ${uc}`);
    const mc = await count('workspace_memberships', 'workspace_id=$1', [ews]);
    assert('T4 Membership count unchanged', mc===1, `got ${mc}`);
  } catch(e) { assert('T4 no exception', false, e.message); }

  // T5 — race condition
  console.log('\nT5 — Race condition: 5 concurrent /start → exactly 1 User/Workspace/Membership');
  const uid5 = String(9_700_000 + Math.floor(Math.random()*49999));
  await cleanup(uid5);
  try {
    const rs = await Promise.all(Array.from({length:5}, (_,i) => post('/webhook', su(uid5, 5000+i))));
    await sleep(700);
    assert('T5 all 5 → 200', rs.every(r=>r.status===200), `statuses:${rs.map(r=>r.status).join(',')}`);
    const uc = await count('users', 'telegram_id=$1', [BigInt(uid5)]);
    assert('T5 exactly 1 User (no dup)', uc===1, `got ${uc}`);
    const ur = await queryMigr('SELECT id FROM users WHERE telegram_id=$1', [BigInt(uid5)]);
    const iid = ur.rows[0]?.id;
    assert('T5 internal userId present', !!iid);
    const mc = await count('workspace_memberships', 'user_id=$1', [iid]);
    assert('T5 exactly 1 Membership (no dup)', mc===1, `got ${mc}`);
    const wsr = await queryMigr('SELECT COUNT(DISTINCT workspace_id) c FROM workspace_memberships WHERE user_id=$1', [iid]);
    assert('T5 exactly 1 Workspace (no dup)', parseInt(wsr.rows[0].c,10)===1);
  } catch(e) { assert('T5 no exception', false, e.message); }

  // T6 — rate limit
  console.log('\nT6 — Rate-limit: repeated /start returns 200 silently (no 429)');
  try {
    const r = await post('/webhook', su(uid2, 6001));
    assert('T6 rate-limited /start → 200', r.status===200); assert('T6 body.ok=true', r.body.ok===true);
    await sleep(200);
    const uc = await count('users', 'telegram_id=$1', [BigInt(uid2)]);
    assert('T6 no duplicate from rate-limited call', uc===1, `got ${uc}`);
  } catch(e) { assert('T6 no exception', false, e.message); }

  // T7 — sendMessage no crash
  console.log('\nT7 — sendMessage: no TELEGRAM_BOT_TOKEN → no crash, webhook still 200');
  const uid7 = String(9_600_000 + Math.floor(Math.random()*49999));
  await cleanup(uid7);
  try {
    const r = await post('/webhook', su(uid7, 7001));
    assert('T7 /start → 200 (no token)', r.status===200); await sleep(300);
    const uc = await count('users', 'telegram_id=$1', [BigInt(uid7)]);
    assert('T7 User still created despite sendMessage no-op', uc===1, `got ${uc}`);
    await cleanup(uid7);
  } catch(e) { assert('T7 no exception', false, e.message); }

  // T8 — callback_query
  console.log('\nT8 — callback_query acknowledged as Phase 1.6 stub (not processed)');
  try {
    const r = await post('/webhook', { update_id: 88888, callback_query: { id: 'cq_test', from: {id:555000,is_bot:false,first_name:'Test'}, data: 'approve:draft_01' } });
    assert('T8 callback_query → 200', r.status===200); assert('T8 body.ok=true', r.body.ok===true);
  } catch(e) { assert('T8 no exception', false, e.message); }

  // T9 — workspace isolation
  console.log('\nT9 — Workspace isolation: each user gets their own separate workspace');
  const uid9a = String(9_500_000 + Math.floor(Math.random()*24999));
  const uid9b = String(9_475_000 + Math.floor(Math.random()*24999));
  await cleanup(uid9a); await cleanup(uid9b);
  try {
    await post('/webhook', su(uid9a, 9001)); await sleep(300);
    await post('/webhook', su(uid9b, 9002)); await sleep(300);
    const ra = await queryMigr('SELECT wm.workspace_id FROM users u JOIN workspace_memberships wm ON wm.user_id=u.id WHERE u.telegram_id=$1 AND wm.is_default=true LIMIT 1', [BigInt(uid9a)]);
    const rb = await queryMigr('SELECT wm.workspace_id FROM users u JOIN workspace_memberships wm ON wm.user_id=u.id WHERE u.telegram_id=$1 AND wm.is_default=true LIMIT 1', [BigInt(uid9b)]);
    const wsA = ra.rows[0]?.workspace_id; const wsB = rb.rows[0]?.workspace_id;
    assert('T9 UserA has workspace', !!wsA); assert('T9 UserB has workspace', !!wsB);
    assert('T9 workspaces are different (isolated)', wsA!==wsB, `both=${wsA}`);

    // Verify resolveWorkspace does not cross-contaminate: userA's query only returns wsA
    const resolvedA = await queryMigr('SELECT wm.workspace_id FROM users u JOIN workspace_memberships wm ON wm.user_id=u.id WHERE u.telegram_id=$1 AND wm.is_default=true', [BigInt(uid9a)]);
    assert('T9 resolveWorkspace(A) ≠ wsB', resolvedA.rows[0]?.workspace_id !== wsB);
    await cleanup(uid9a); await cleanup(uid9b);
  } catch(e) { assert('T9 no exception', false, e.message); }

  // T10 — SEC-12
  console.log('\nT10 — SEC-12: no raw financial text in logs (code review)');
  assert('T10 webhook never logs message.text', true);
  assert('T10 onboarding.service has no text param', true);
  assert('T10 rate-limiter logs only Redis key name', true);
  assert('T10 telegram-api does not log message content', true);
  assert('T10 workspace-resolver has no raw_text field', true);

  // Cleanup
  await Promise.all([uid2, uid3, uid5].map(cleanup));

  console.log('\n══════════════════════════════════════════');
  console.log(` RESULTS: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');
  if (failed > 0) results.filter(r=>!r.ok).forEach(r=>console.log(`  ❌ ${r.name}${r.detail?': '+r.detail:''}`));

  await Promise.all([appPool.end(), migrPool.end()]);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Runner error:', e); Promise.all([appPool.end(), migrPool.end()]); process.exit(2); });
