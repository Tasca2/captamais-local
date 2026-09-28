#!/usr/bin/env node
/**
 * Servidor LOCAL do CaptaMais CRM (usado pela skill). Só escuta em 127.0.0.1.
 * Serve a UI interativa e uma API que mexe SÓ no banco local. Sem segredos, sem nuvem.
 * Proteção: token de sessão aleatório (anti-CSRF) exigido em toda rota /api.
 */
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.mjs';
import { runSync, ensureLeadInCloud } from './sync.mjs';
import { openApp, findRunning } from './open.mjs';
import { spawn } from 'node:child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(SCRIPT_DIR, '..', 'assets');
const HOST = '127.0.0.1';
// Modos de execução: (padrão) lança o CRM solto do terminal, abre a janela e sai; --child é o CRM em si;
// --foreground roda aqui mesmo (depuração). --no-open (ou CAPTAMAIS_NO_OPEN=1) não abre janela.
const ARGS = new Set(process.argv.slice(2));
const IS_CHILD = ARGS.has('--child');
const FOREGROUND = ARGS.has('--foreground') || process.env.CAPTAMAIS_FOREGROUND === '1';
if (ARGS.has('--no-open')) process.env.CAPTAMAIS_NO_OPEN = '1';
// Solto do terminal, o CRM se encerra sozinho após muito tempo sem uso (a aba aberta avisa que está viva).
const IDLE_MIN = process.env.CAPTAMAIS_IDLE_MIN === undefined ? 720 : Number(process.env.CAPTAMAIS_IDLE_MIN);
let lastActivity = Date.now();
process.stdout.on('error', () => {}); // o terminal que iniciou pode fechar; não derrubar o CRM por isso
const START_PORT = Number(process.env.CAPTAMAIS_PORT) || 4599;
const TOKEN = crypto.randomBytes(16).toString('hex');
// A chave vem da variável de ambiente OU do arquivo local (~/.captamais/config.json), gravado pela tela
// "Conectar conta". Nunca é devolvida ao navegador; só o servidor local a usa para falar com a nuvem.
const CONFIG_FILE = path.join(db.dataDir(), 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch { return {}; } }
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) {}
}
const ENV_KEY = (process.env.CAPTAMAIS_API_KEY || '').trim();
let API_KEY = ENV_KEY || String(readConfig().apiKey || '').trim();
const KEY_FORMAT = /^ctm_[a-f0-9]{48}$/;
const CLOUD_URL = (process.env.CAPTAMAIS_CLOUD_URL || 'https://captamais.me').trim().replace(/\/+$/, '');
// A chave viaja em cada chamada: só HTTPS (http só para testes em localhost). Nunca em texto puro pela rede.
try {
  const u = new URL(CLOUD_URL);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('inseguro');
} catch {
  console.error('[captamais-crm] CAPTAMAIS_CLOUD_URL precisa ser HTTPS (ex.: https://captamais.me). Encerrando para não expor sua chave.');
  process.exit(1);
}

/** Chama a nuvem CaptaMais autenticando pela chave do usuário. Ferramentas de nuvem passam por aqui. */
async function cloud(path, body, method = 'POST', key = API_KEY) {
  if (!key) return { ok: false, code: 'no_key', message: 'Conecte sua conta CaptaMais (defina CAPTAMAIS_API_KEY).' };
  try {
    // redirect:'error' — um redirecionamento reenviaria a chave (cabeçalho customizado) ao destino; recusa.
    const options = { method, redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', 'x-captamais-key': key } };
    if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body || {});
    const r = await fetch(`${CLOUD_URL}${path}`, options);
    const data = await r.json().catch(() => ({ ok: false, message: 'Resposta inválida da nuvem.' }));
    if (!r.ok && data.ok !== false) return { ...data, ok: false, message: data.message || `Falha na nuvem (HTTP ${r.status}).` };
    return data;
  } catch { return { ok: false, code: 'network', message: 'Sem conexão com a nuvem.' }; }
}

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

/** Bloqueia acesso de outras origens/hosts (defesa contra páginas maliciosas locais). */
function guardOk(req) {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return false;
  return true;
}

async function handle(req, res) {
  if (!guardOk(req)) return send(res, 403, 'forbidden');
  const u = new URL(req.url, `http://${HOST}`);
  const p = u.pathname;
  const method = req.method || 'GET';

  // Identificação (sem dados): permite reaproveitar um CRM já aberto em vez de subir outro.
  if (p === '/__captamais' && method === 'GET') return json(res, 200, { app: 'captamais-crm', dbDir: db.dataDir() });
  lastActivity = Date.now();

  // Página inicial (shell) — injeta token + logo. Não expõe dados.
  if (p === '/' && method === 'GET') {
    let html = fs.readFileSync(path.join(ASSETS, 'app.html'), 'utf8');
    const logo = fs.readFileSync(path.join(ASSETS, 'logo.svg'), 'utf8');
    html = html.replace('/*__CM_TOKEN__*/ ""', JSON.stringify(TOKEN)).replace('<!--__CM_LOGO__-->', logo);
    return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  }
  if (p === '/assets/logo.svg' && method === 'GET') {
    return send(res, 200, fs.readFileSync(path.join(ASSETS, 'logo.svg')), { 'Content-Type': 'image/svg+xml' });
  }

  // A partir daqui, tudo é /api e exige token de sessão.
  if (!p.startsWith('/api/')) return send(res, 404, 'not found');
  if (req.headers['x-cm-token'] !== TOKEN) return json(res, 403, { ok: false, error: 'token inválido' });

  try {
    if (p === '/api/ping' && method === 'GET') return json(res, 200, { ok: true });
    if (p === '/api/board' && method === 'GET') return json(res, 200, { ok: true, ...db.computeBoard(u.searchParams.get('layout')) });
    if (p === '/api/agenda' && method === 'GET') return json(res, 200, { ok: true, items: db.agenda(Number(u.searchParams.get('days')) || 7) });
    if (p === '/api/export' && method === 'GET') return json(res, 200, { ok: true, ...db.exportAll() });
    if (p === '/api/export.csv' && method === 'GET') return send(res, 200, db.exportLeadsCsv(u.searchParams.get('layout')), { 'Content-Type': 'text/csv; charset=utf-8' });
    if (p === '/api/backup' && method === 'POST') { const f = db.writeBackup(); return json(res, 200, { ok: !!f }); }

    // ── Sincronização local ↔ nuvem (a pessoa escolhe o modo na tela) ──
    if (p === '/api/sync/status' && method === 'GET') {
      return json(res, 200, { ok: true, configured: !!API_KEY, ...db.syncSummary() });
    }
    if (p === '/api/sync/run' && method === 'POST') {
      const b = await readBody(req);
      if (!API_KEY) return json(res, 400, { ok: false, code: 'no_key', message: 'Conecte sua conta CaptaMais primeiro.' });
      try { db.writeBackup(); } catch (_) {} // rede de segurança antes de mexer nos dados
      try { return json(res, 200, { ok: true, stats: await runSync(cloud, b.mode), ...db.syncSummary() }); }
      catch (e) { return json(res, 400, { ok: false, message: String(e?.message || 'Falha ao sincronizar.') }); }
    }
    // Abre o Planejamento Financeiro do SITE (com o lead escolhido, já enviado à nuvem).
    if (p === '/api/planning/url' && method === 'POST') {
      const b = await readBody(req);
      if (!API_KEY) return json(res, 400, { ok: false, code: 'no_key', message: 'Conecte sua conta CaptaMais primeiro.' });
      if (!b.lead_id) return json(res, 200, { ok: true, url: `${CLOUD_URL}/financial-planning` });
      try {
        const cloudId = await ensureLeadInCloud(cloud, Number(b.lead_id));
        const planId = Number(b.plan_id);
        // Com plano informado abre aquele planejamento; senão começa um novo para o lead. (O site só aplica se for da conta.)
        const q = Number.isInteger(planId) && planId > 0 ? `planId=${planId}` : `leadId=${cloudId}`;
        return json(res, 200, { ok: true, url: `${CLOUD_URL}/financial-planning?${q}` });
      } catch (e) { return json(res, 400, { ok: false, message: String(e?.message || 'Não foi possível abrir o planejamento.') }); }
    }
    // Atalho na ficha do lead: quantos planejamentos existem na nuvem e quando foi o último (só ids e datas).
    const plansMatch = p.match(/^\/api\/leads\/(\d+)\/plans$/);
    if (plansMatch && method === 'GET') {
      const lead = db.getLead(Number(plansMatch[1])).lead;
      if (!lead) return json(res, 404, { ok: false, error: 'lead não encontrado' });
      if (!API_KEY || !lead.cloud_id) return json(res, 200, { ok: true, count: 0, plans: [], synced: !!lead.cloud_id });
      const d = await cloud('/api/mcp/lead/plans', { cloudId: lead.cloud_id });
      return json(res, 200, d.ok ? { ok: true, count: d.count, plans: d.plans, synced: true } : { ok: false, message: d.message });
    }

    // ── Conectar / desconectar a conta (a chave nunca volta para o navegador) ──
    if (p === '/api/link/connect' && method === 'POST') {
      const b = await readBody(req);
      const key = String(b.key || '').trim();
      if (!KEY_FORMAT.test(key)) return json(res, 400, { ok: false, message: 'Chave inválida. Copie-a inteira em Minha Conta → Conector.' });
      const d = await cloud('/api/mcp/link/status', {}, 'POST', key);
      if (!d.linked) return json(res, 400, { ok: false, message: d.code === 'network' ? 'Sem conexão com a nuvem.' : 'A nuvem não reconheceu essa chave. Gere ou rotacione a chave em Minha Conta.' });
      writeConfig({ ...readConfig(), apiKey: key });
      API_KEY = key;
      return json(res, 200, { ok: true, name: d.name || '', plan: d.plan || '' });
    }
    if (p === '/api/link/disconnect' && method === 'POST') {
      const cfg = readConfig(); delete cfg.apiKey; writeConfig(cfg);
      API_KEY = ENV_KEY;
      return json(res, 200, { ok: true, stillLinkedByEnv: !!ENV_KEY });
    }

    // ── Vinculação + ferramentas de nuvem (proxy autenticado pela chave) ──
    if (p === '/api/link/status' && method === 'GET') {
      if (!API_KEY) return json(res, 200, { ok: true, linked: false, configured: false, cloudUrl: CLOUD_URL });
      const d = await cloud('/api/mcp/link/status', {});
      return json(res, 200, { ...d, configured: true, cloudUrl: CLOUD_URL });
    }
    if (p === '/api/integrations/google/status' && method === 'GET') {
      if (!API_KEY) return json(res, 200, { ok: true, configured: false, connected: false, gmail: false, calendar: false });
      const d = await cloud('/api/mcp/integrations/google/status', null, 'GET');
      return json(res, d.ok ? 200 : 400, { ...d, ...(d.data || {}), configured: true });
    }
    if (p === '/api/integrations/google/connect' && method === 'POST') {
      const d = await cloud('/api/mcp/integrations/google/connect', { services: ['gmail', 'calendar'] });
      return json(res, d.ok ? 200 : 400, d);
    }
    if (p === '/api/integrations/google/disconnect' && method === 'POST') {
      const d = await cloud('/api/mcp/integrations/google/disconnect', {});
      return json(res, d.ok ? 200 : 400, d);
    }
    if (p === '/api/tool/cnpj' && method === 'POST') {
      const b = await readBody(req);
      const d = await cloud('/api/mcp/tool/cnpj', { cnpj: b.cnpj });
      return json(res, d.ok ? 200 : 400, d);
    }

    // ── Layouts (funis) ──
    if (p === '/api/layouts' && method === 'GET') return json(res, 200, { ok: true, layouts: db.listLayouts() });
    if (p === '/api/layouts' && method === 'POST') { const b = await readBody(req); return json(res, 200, { ok: true, layout: db.createLayout(b.name) }); }
    let mm;
    if ((mm = p.match(/^\/api\/layouts\/(\d+)$/))) {
      if (method === 'PATCH') { const b = await readBody(req); return json(res, 200, { ok: true, layout: db.renameLayout(Number(mm[1]), b.name) }); }
      if (method === 'DELETE') { try { db.deleteLayout(Number(mm[1])); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
    }
    // ── Colunas ──
    if (p === '/api/columns' && method === 'POST') { const b = await readBody(req); return json(res, 200, { ok: true, column: db.createColumn(b.layout_id, b.title, b.color) }); }
    if ((mm = p.match(/^\/api\/columns\/(\d+)$/))) {
      if (method === 'PATCH') { const b = await readBody(req); return json(res, 200, { ok: true, column: db.updateColumn(Number(mm[1]), b) }); }
      if (method === 'DELETE') { try { db.deleteColumn(Number(mm[1]), u.searchParams.get('moveTo')); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
    }
    if ((mm = p.match(/^\/api\/columns\/(\d+)\/move$/)) && method === 'POST') { const b = await readBody(req); return json(res, 200, { ok: true, column: db.moveColumn(Number(mm[1]), b.dir) }); }

    if (p === '/api/leads' && method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { ok: true, lead: db.createLead(body) });
    }
    if (p === '/api/import' && method === 'POST') {
      const body = await readBody(req);
      if (typeof body.csv === 'string') return json(res, 200, { ok: true, imported: db.importLeadsCsv(body.csv, body.layout_id) });
      return json(res, 200, { ok: true, imported: db.importLeads(body.leads || body) });
    }

    let m;
    if ((m = p.match(/^\/api\/leads\/(\d+)$/))) {
      const id = Number(m[1]);
      if (method === 'GET') { const r = db.getLead(id); return r.lead ? json(res, 200, { ok: true, ...r }) : json(res, 404, { ok: false, error: 'lead não encontrado' }); }
      if (method === 'PATCH') { const body = await readBody(req); const lead = db.updateLead(id, body); return lead ? json(res, 200, { ok: true, lead }) : json(res, 404, { ok: false, error: 'lead não encontrado' }); }
    }
    if ((m = p.match(/^\/api\/leads\/(\d+)\/stage$/)) && method === 'POST') {
      const body = await readBody(req); const lead = db.moveStage(Number(m[1]), body.stage);
      return lead ? json(res, 200, { ok: true, lead }) : json(res, 404, { ok: false, error: 'lead não encontrado' });
    }
    if ((m = p.match(/^\/api\/leads\/(\d+)\/activities$/)) && method === 'POST') {
      const body = await readBody(req);
      try {
        const leadId = Number(m[1]);
        if (body.sync_calendar && !body.due_at) return json(res, 400, { ok: false, error: 'Informe data e hora para adicionar ao Google Agenda.' });
        const activity = db.addActivity(leadId, body);
        let calendar = null;
        if (body.sync_calendar) {
          const lead = db.getLead(leadId).lead;
          const d = await cloud('/api/mcp/integrations/google/calendar/events', {
            activity: { localId: activity.id, type: activity.type, title: activity.title, startAt: activity.due_at, notes: activity.notes },
            lead: { name: lead.name, email: lead.email, phone: lead.phone },
            createMeet: activity.type === 'meeting',
          });
          calendar = d;
          db.setActivityCalendarResult(activity.id, d.ok ? {
            eventId: d.data?.eventId, eventUrl: d.data?.htmlLink, meetLink: d.data?.meetLink,
          } : { error: d.message || 'Não foi possível criar o evento.' });
        }
        return json(res, 200, { ok: true, activity: db.getActivity(activity.id), calendar });
      }
      catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    }
    if ((m = p.match(/^\/api\/activities\/(\d+)\/done$/)) && method === 'POST') {
      return json(res, 200, { ok: db.doneActivity(Number(m[1])) });
    }
    return json(res, 404, { ok: false, error: 'rota não encontrada' });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
}

function listen(port, tries = 8) {
  const server = createServer((req, res) => { handle(req, res).catch(() => send(res, 500, 'erro')); });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) return listen(port + 1, tries - 1);
    console.error('[captamais-crm] erro:', e.message); process.exit(1);
  });
  server.listen(port, HOST, () => {
    try { db.writeBackup(); } catch (_) {} // backup automático (silencioso) a cada abertura
    const url = `http://${HOST}:${port}/`;
    // stdout em JSON (1ª linha) para a skill/CLI capturar o endereço; log humano em stderr.
    process.stdout.write(JSON.stringify({ ok: true, url, dbDir: db.dataDir() }) + '\n');
    console.error(`[captamais-crm] CRM local rodando em ${url}  (dados: ${db.dataDir()})`);
    // Solto do terminal (--child), some sozinho depois de muito tempo sem uso.
    if (IS_CHILD && IDLE_MIN > 0) {
      const every = Math.min(60000, Math.max(500, (IDLE_MIN * 60000) / 2));
      setInterval(() => { if (Date.now() - lastActivity > IDLE_MIN * 60000) process.exit(0); }, every).unref();
    }
    // Rodando em primeiro plano (depuração): abre a janela daqui mesmo.
    if (FOREGROUND && !IS_CHILD) openApp(url).catch(() => {});
  });
}

/** Modo padrão: reaproveita um CRM já aberto ou sobe um solto do terminal; abre a janela e sai. */
async function launch() {
  const report = (url, reused, opened) => {
    process.stdout.write(JSON.stringify({ ok: true, url, dbDir: db.dataDir(), reused, opened: !!opened.opened, window: opened.kind || null }) + '\n');
    console.error(`[captamais-crm] ${reused ? 'CRM já estava aberto' : 'CRM iniciado'} em ${url}` + (opened.opened ? (opened.kind === 'app' ? ' (janela de aplicativo)' : ' (navegador padrão)') : ' — abra este endereço no navegador'));
  };
  const running = await findRunning(START_PORT, db.dataDir());
  if (running) { report(running.url, true, await openApp(running.url)); return process.exit(0); }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: process.env });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('O CRM demorou para iniciar.')), 15000);
    child.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); try { resolve(JSON.parse(buf.slice(0, i)).url); } catch (e) { reject(e); } } });
    child.on('exit', (c) => reject(new Error(`O CRM encerrou ao iniciar (código ${c}).`)));
    child.on('error', reject);
  }).catch((e) => { console.error('[captamais-crm] erro:', e.message); process.exit(1); });
  child.stdout.destroy();
  child.unref();
  report(url, false, await openApp(url));
  process.exit(0);
}

if (IS_CHILD || FOREGROUND) listen(START_PORT);
else launch();
