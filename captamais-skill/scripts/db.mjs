/**
 * Motor do CRM local (compartilhado por crm.mjs [CLI] e server.mjs [HTTP]).
 * Dados na máquina do usuário (~/.captamais/captamais.db). LOCAL — sem nuvem, sem segredos.
 * Suporta múltiplos LAYOUTS (funis), COLUNAS editáveis (criar/renomear/cor/excluir), leads e atividades.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mappingSummary, normalizeLeadRows, parseDelimited } from './lead-import.mjs';

// Colunas-padrão do funil inicial.
const DEFAULT_COLUMNS = [
  { col_key: 'NEW LEAD', title: 'NOVO LEAD', color: '#3b82f6' },
  { col_key: 'INITIAL CONTACT', title: 'CONTATO INICIAL', color: '#8b5cf6' },
  { col_key: 'FIRST MEETING', title: 'PRIMEIRA REUNIÃO', color: '#6366f1' },
  { col_key: 'SECOND MEETING', title: 'SEGUNDA REUNIÃO', color: '#f59e0b' },
  { col_key: 'CLOSING', title: 'FECHAMENTO', color: '#10b981' },
];
export const ACTIVITY_TYPES = ['call', 'call_attempt', 'followup', 'meeting', 'r1', 'r2', 'r3', 'whatsapp', 'task'];
export const ACTIVITY_LABEL = { call: 'Ligação', call_attempt: 'Tentativa de ligação', followup: 'Follow-up', meeting: 'Reunião', r1: 'R1', r2: 'R2', r3: 'R3', whatsapp: 'WhatsApp', task: 'Tarefa' };
export const COLUMN_COLORS = ['#3b82f6', '#8b5cf6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#71717a'];

export function safeHttpUrl(u) {
  const s = String(u || '').trim(); if (!s) return null;
  try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : null; } catch { return null; }
}
export function baseDataDir() {
  const dir = process.env.CAPTAMAIS_DATA_DIR || path.join(os.homedir(), '.captamais');
  fs.mkdirSync(dir, { recursive: true }); return dir;
}

const safeProfileId = (v) => {
  const s = String(v || '').trim();
  return /^(anonymous|acct_[a-f0-9]{24})$/.test(s) ? s : 'anonymous';
};
function savedProfileId() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(baseDataDir(), 'config.json'), 'utf8'));
    return safeProfileId(cfg?.activeProfile);
  } catch { return 'anonymous'; }
}
let _profile = savedProfileId();
export function activeProfileId() { return _profile; }
export function dataDir() {
  const dir = _profile === 'anonymous' ? baseDataDir() : path.join(baseDataDir(), 'profiles', _profile);
  fs.mkdirSync(dir, { recursive: true }); return dir;
}
const now = () => new Date().toISOString();
const clean = (v) => { if (v === undefined || v === null) return null; const s = String(v).trim(); return s || null; };
const newKey = () => 'col_' + crypto.randomBytes(5).toString('hex');

let _db = null;
function closeDb() {
  if (!_db) return;
  try { _db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  try { _db.close(); } catch (_) {}
  _db = null;
}

/**
 * Troca o banco local ativo sem misturar contas. Na primeira vinculação, copia o
 * perfil anônimo para a conta; nas trocas seguintes abre o perfil isolado existente.
 */
export function switchProfile(profileId, { claimAnonymous = false } = {}) {
  const next = safeProfileId(profileId);
  if (next === _profile) return { profileId: next, dataDir: dataDir(), claimed: false };
  const previous = _profile;
  const previousDir = dataDir();
  closeDb();
  _profile = next;
  const nextDir = dataDir();
  const source = path.join(previousDir, 'captamais.db');
  const target = path.join(nextDir, 'captamais.db');
  let claimed = false;
  if (claimAnonymous && previous === 'anonymous' && next !== 'anonymous' && fs.existsSync(source) && !fs.existsSync(target)) {
    // Mantém a origem como recuperação; o perfil vinculado passa a trabalhar numa cópia independente.
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    claimed = true;
  }
  openDb();
  return { profileId: next, dataDir: nextDir, claimed };
}

export function openDb() {
  if (_db) return _db;
  _db = new Database(path.join(dataDir(), 'captamais.db'));
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, layout_id INTEGER NOT NULL, col_key TEXT NOT NULL,
      title TEXT NOT NULL, color TEXT, position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, phone TEXT, city TEXT, cnpj TEXT,
      stage TEXT NOT NULL DEFAULT 'NEW LEAD', description TEXT, subtitle TEXT,
      entity_type TEXT NOT NULL DEFAULT 'PF', custom_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT,
      due_at TEXT, done INTEGER NOT NULL DEFAULT 0, notes TEXT, meet_link TEXT, created_at TEXT NOT NULL,
      google_event_id TEXT, google_event_url TEXT, calendar_sync_status TEXT);
    CREATE INDEX IF NOT EXISTS idx_act_lead ON activities(lead_id);
    -- Listas de leads compradas com créditos (Pesquisar / Gerar leads). Ficam só neste computador.
    CREATE TABLE IF NOT EXISTS lead_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mode TEXT, query TEXT, filters TEXT,
      total_found INTEGER NOT NULL DEFAULT 0, purchased INTEGER NOT NULL DEFAULT 0, credits_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS market_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL, cnpj TEXT, razao TEXT, fantasia TEXT, email TEXT,
      phone TEXT, cellphone TEXT, city TEXT, uf TEXT, cnae TEXT, porte TEXT, situacao TEXT, socio TEXT, site TEXT,
      imported_lead_id INTEGER);
    CREATE INDEX IF NOT EXISTS idx_ml_list ON market_leads(list_id);
  `);
  try { _db.exec('ALTER TABLE leads ADD COLUMN layout_id INTEGER'); } catch (_) {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN cnpj TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE activities ADD COLUMN google_event_id TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE activities ADD COLUMN google_event_url TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE activities ADD COLUMN calendar_sync_status TEXT'); } catch (_) {}
  // Vínculo com a nuvem (sincronização): id do lead lá, quando foi sincronizado aqui e a versão da nuvem vista.
  try { _db.exec('ALTER TABLE leads ADD COLUMN cloud_id INTEGER'); } catch (_) {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN local_synced_at TEXT'); } catch (_) {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN cloud_seen_at TEXT'); } catch (_) {}
  seed();
  return _db;
}

function seed() {
  const db = _db;
  const hasLayout = db.prepare('SELECT id FROM layouts ORDER BY position, id LIMIT 1').get();
  let defId;
  if (!hasLayout) {
    const r = db.prepare('INSERT INTO layouts (name, position, created_at) VALUES (?,?,?)').run('Prospecção', 0, now());
    defId = r.lastInsertRowid;
    DEFAULT_COLUMNS.forEach((c, i) => db.prepare('INSERT INTO columns (layout_id,col_key,title,color,position) VALUES (?,?,?,?,?)').run(defId, c.col_key, c.title, c.color, i));
  } else {
    defId = hasLayout.id;
  }
  db.prepare('UPDATE leads SET layout_id = ? WHERE layout_id IS NULL').run(defId);
}

export function getDefaultLayoutId() { return openDb().prepare('SELECT id FROM layouts ORDER BY position, id LIMIT 1').get().id; }
export function listLayouts() { return openDb().prepare('SELECT * FROM layouts ORDER BY position, id').all(); }
export function listColumns(layoutId) { return openDb().prepare('SELECT * FROM columns WHERE layout_id=? ORDER BY position, id').all(Number(layoutId)); }

export function createLayout(name) {
  const db = openDb();
  const pos = (db.prepare('SELECT MAX(position) m FROM layouts').get().m ?? -1) + 1;
  const r = db.prepare('INSERT INTO layouts (name, position, created_at) VALUES (?,?,?)').run(String(name || 'Novo funil').trim() || 'Novo funil', pos, now());
  const id = r.lastInsertRowid;
  [['Entrada', '#3b82f6'], ['Em andamento', '#f59e0b'], ['Ganhos', '#10b981']].forEach((c, i) =>
    db.prepare('INSERT INTO columns (layout_id,col_key,title,color,position) VALUES (?,?,?,?,?)').run(id, newKey(), c[0], c[1], i));
  return db.prepare('SELECT * FROM layouts WHERE id=?').get(id);
}
export function renameLayout(id, name) {
  const db = openDb();
  db.prepare('UPDATE layouts SET name=? WHERE id=?').run(String(name || '').trim() || 'Funil', Number(id));
  return db.prepare('SELECT * FROM layouts WHERE id=?').get(Number(id));
}
export function deleteLayout(id) {
  const db = openDb();
  if (db.prepare('SELECT COUNT(*) c FROM layouts').get().c <= 1) throw new Error('Não é possível excluir o único funil.');
  if (db.prepare('SELECT COUNT(*) c FROM leads WHERE layout_id=?').get(Number(id)).c > 0) throw new Error('Mova ou exclua os leads deste funil antes de excluí-lo.');
  db.prepare('DELETE FROM columns WHERE layout_id=?').run(Number(id));
  db.prepare('DELETE FROM layouts WHERE id=?').run(Number(id));
  return true;
}

export function createColumn(layoutId, title, color) {
  const db = openDb();
  const pos = (db.prepare('SELECT MAX(position) m FROM columns WHERE layout_id=?').get(Number(layoutId)).m ?? -1) + 1;
  const key = newKey();
  db.prepare('INSERT INTO columns (layout_id,col_key,title,color,position) VALUES (?,?,?,?,?)').run(Number(layoutId), key, String(title || 'Nova coluna').trim() || 'Nova coluna', color || '#71717a', pos);
  return db.prepare('SELECT * FROM columns WHERE layout_id=? AND col_key=?').get(Number(layoutId), key);
}
export function updateColumn(id, patch) {
  const db = openDb();
  const c = db.prepare('SELECT * FROM columns WHERE id=?').get(Number(id)); if (!c) return null;
  db.prepare('UPDATE columns SET title=?, color=? WHERE id=?').run(patch.title !== undefined ? String(patch.title).trim() || c.title : c.title, patch.color !== undefined ? patch.color : c.color, Number(id));
  return db.prepare('SELECT * FROM columns WHERE id=?').get(Number(id));
}
export function moveColumn(id, dir) {
  const db = openDb();
  const c = db.prepare('SELECT * FROM columns WHERE id=?').get(Number(id)); if (!c) return null;
  const sibling = db.prepare(`SELECT * FROM columns WHERE layout_id=? AND position ${dir === 'left' ? '<' : '>'} ? ORDER BY position ${dir === 'left' ? 'DESC' : 'ASC'} LIMIT 1`).get(c.layout_id, c.position);
  if (!sibling) return c;
  db.prepare('UPDATE columns SET position=? WHERE id=?').run(sibling.position, c.id);
  db.prepare('UPDATE columns SET position=? WHERE id=?').run(c.position, sibling.id);
  return db.prepare('SELECT * FROM columns WHERE id=?').get(c.id);
}
export function deleteColumn(id, moveToKey) {
  const db = openDb();
  const c = db.prepare('SELECT * FROM columns WHERE id=?').get(Number(id)); if (!c) return false;
  const cols = db.prepare('SELECT * FROM columns WHERE layout_id=? ORDER BY position, id').all(c.layout_id);
  if (cols.length <= 1) throw new Error('O funil precisa de ao menos uma coluna.');
  const target = moveToKey || cols.find((x) => x.id !== c.id)?.col_key;
  db.prepare('UPDATE leads SET stage=?, updated_at=? WHERE layout_id=? AND stage=?').run(target, now(), c.layout_id, c.col_key);
  db.prepare('DELETE FROM columns WHERE id=?').run(c.id);
  return true;
}

export function computeBoard(layoutId) {
  const db = openDb();
  const lid = Number(layoutId) || getDefaultLayoutId();
  const cols = listColumns(lid);
  const leads = db.prepare('SELECT * FROM leads WHERE layout_id=? ORDER BY datetime(created_at) DESC').all(lid);
  const openActs = db.prepare('SELECT lead_id FROM activities WHERE done=0').all();
  const byLead = {}; for (const a of openActs) byLead[a.lead_id] = (byLead[a.lead_id] || 0) + 1;
  const columns = cols.map((c) => ({
    id: c.id, stage: c.col_key, title: c.title, color: c.color || '#71717a',
    leads: leads.filter((l) => l.stage === c.col_key).map((l) => ({ ...l, openActivities: byLead[l.id] || 0 })),
  }));
  // Leads órfãos (stage sem coluna) vão para a primeira coluna visualmente.
  const known = new Set(cols.map((c) => c.col_key));
  const orphans = leads.filter((l) => !known.has(l.stage)).map((l) => ({ ...l, openActivities: byLead[l.id] || 0 }));
  if (orphans.length && columns[0]) columns[0].leads.push(...orphans);
  const openActivities = db.prepare(
    `SELECT a.*, l.name AS lead_name FROM activities a JOIN leads l ON l.id=a.lead_id
     WHERE a.done=0 ORDER BY (a.due_at IS NULL), datetime(a.due_at)`).all();
  return { layoutId: lid, layouts: listLayouts(), columns, totals: { leads: leads.length, openActivities: openActs.length }, openActivities };
}

const firstColKey = (lid) => (listColumns(lid)[0]?.col_key || 'NEW LEAD');

export function createLead(input) {
  const db = openDb();
  if (!clean(input?.name)) throw new Error('Nome é obrigatório.');
  const lid = Number(input.layout_id) || getDefaultLayoutId();
  const stage = clean(input.stage) || firstColKey(lid);
  const entity = String(input.entityType || input.entity_type || 'PF').toUpperCase() === 'PJ' ? 'PJ' : 'PF';
  const info = db.prepare(
    `INSERT INTO leads (name,email,phone,city,cnpj,stage,description,subtitle,entity_type,custom_fields,layout_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,'{}',?,?)`,
  ).run(String(input.name).trim(), clean(input.email), clean(input.phone), clean(input.city), entity === 'PJ' ? clean(input.cnpj) : null, stage,
        clean(input.description), clean(input.subtitle), entity, lid, now());
  return getLead(info.lastInsertRowid).lead;
}
export function updateLead(id, patch) {
  const db = openDb();
  const cur = db.prepare('SELECT * FROM leads WHERE id=?').get(Number(id)); if (!cur) return null;
  const g = (k, d) => (patch[k] !== undefined ? patch[k] : d);
  const entity = String(g('entity_type', cur.entity_type)).toUpperCase() === 'PJ' ? 'PJ' : 'PF';
  db.prepare(`UPDATE leads SET name=?,email=?,phone=?,city=?,cnpj=?,stage=?,description=?,subtitle=?,entity_type=?,updated_at=? WHERE id=?`)
    .run(String(g('name', cur.name)).trim() || cur.name, clean(g('email', cur.email)), clean(g('phone', cur.phone)),
         clean(g('city', cur.city)), entity === 'PJ' ? clean(g('cnpj', cur.cnpj)) : null, clean(g('stage', cur.stage)) || cur.stage, clean(g('description', cur.description)),
         clean(g('subtitle', cur.subtitle)), entity, now(), Number(id));
  return getLead(id).lead;
}
export function moveStage(id, colKey) {
  const db = openDb();
  const r = db.prepare('UPDATE leads SET stage=?, updated_at=? WHERE id=?').run(String(colKey), now(), Number(id));
  return r.changes ? getLead(id).lead : null;
}
export function getLead(id) {
  const db = openDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(Number(id));
  if (!lead) return { lead: null, activities: [] };
  return { lead, activities: db.prepare('SELECT * FROM activities WHERE lead_id=? ORDER BY datetime(created_at) DESC').all(Number(id)) };
}
export function addActivity(leadId, input) {
  const db = openDb();
  const type = String(input?.type || '').toLowerCase();
  if (!ACTIVITY_TYPES.includes(type)) throw new Error('Tipo de atividade inválido.');
  if (!db.prepare('SELECT id FROM leads WHERE id=?').get(Number(leadId))) throw new Error('Lead não encontrado.');
  const meet = ['meeting', 'r1', 'r2', 'r3'].includes(type) && input.meet_link ? safeHttpUrl(input.meet_link) : null;
  const createdAt = now();
  const info = db.prepare('INSERT INTO activities (lead_id,type,title,due_at,notes,meet_link,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(Number(leadId), type, clean(input.title) || ACTIVITY_LABEL[type], clean(input.due_at) || createdAt, clean(input.notes), meet, createdAt);
  return db.prepare('SELECT * FROM activities WHERE id=?').get(info.lastInsertRowid);
}
export function getActivity(id) { return openDb().prepare('SELECT * FROM activities WHERE id=?').get(Number(id)) || null; }
export function setActivityCalendarResult(id, result) {
  const db = openDb();
  const status = result?.error ? 'error' : 'synced';
  db.prepare(`UPDATE activities SET google_event_id=?, google_event_url=?, meet_link=COALESCE(?,meet_link), calendar_sync_status=? WHERE id=?`)
    .run(clean(result?.eventId), safeHttpUrl(result?.eventUrl), safeHttpUrl(result?.meetLink), status, Number(id));
  return getActivity(id);
}
export function doneActivity(id) { return openDb().prepare('UPDATE activities SET done=1 WHERE id=?').run(Number(id)).changes > 0; }
export function agenda(days = 7) {
  const until = new Date(Date.now() + Number(days) * 864e5).toISOString();
  return openDb().prepare(
    `SELECT a.*, l.name AS lead_name FROM activities a JOIN leads l ON l.id=a.lead_id
     WHERE a.done=0 AND (a.due_at IS NULL OR a.due_at <= ?) ORDER BY (a.due_at IS NULL), datetime(a.due_at)`).all(until);
}
export function exportAll() {
  const db = openDb();
  return { exportedAt: now(), layouts: db.prepare('SELECT * FROM layouts').all(), columns: db.prepare('SELECT * FROM columns').all(),
           leads: db.prepare('SELECT * FROM leads').all(), activities: db.prepare('SELECT * FROM activities').all() };
}
export function importLeads(rows) {
  let n = 0; for (const r of Array.isArray(rows) ? rows : []) { if (!clean(r?.name)) continue; try { createLead(r); n++; } catch { /* pula */ } } return n;
}

// ── CSV (leads) — para planilhas e outros CRMs ──
const CSV_COLS = ['name', 'email', 'phone', 'city', 'cnpj', 'stage', 'subtitle', 'entity_type', 'description', 'created_at'];
const CSV_HEADER_PT = ['nome', 'email', 'telefone', 'cidade', 'cnpj', 'etapa', 'subtitulo', 'tipo', 'anotacoes', 'criado_em'];
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function exportLeadsCsv(layoutId) {
  const db = openDb();
  const leads = layoutId
    ? db.prepare('SELECT * FROM leads WHERE layout_id=? ORDER BY id').all(Number(layoutId))
    : db.prepare('SELECT * FROM leads ORDER BY id').all();
  const lines = ['﻿' + CSV_HEADER_PT.join(',')]; // BOM p/ Excel abrir acentos certo
  for (const l of leads) lines.push(CSV_COLS.map((c) => csvCell(l[c])).join(','));
  return lines.join('\r\n');
}

/** Backup automático (JSON) — silencioso, nos bastidores. Mantém os últimos 7. */
export function writeBackup() {
  try {
    const dir = path.join(dataDir(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(exportAll(), null, 2));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('backup-') && f.endsWith('.json')).sort();
    while (files.length > 7) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch (_) {} }
    return file;
  } catch { return null; }
}

export function previewLeadsImport(rows) {
  const parsed = normalizeLeadRows(rows);
  return { total: parsed.rows.length, valid: parsed.records.length, skipped: parsed.skipped.length, mapping: mappingSummary(parsed.mapping), warnings: parsed.warnings, samples: parsed.records.slice(0, 3) };
}

export function importLeadRows(rows, layoutId) {
  const parsed = normalizeLeadRows(rows);
  const existing = openDb().prepare('SELECT email, phone FROM leads').all();
  const emails = new Set(existing.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean));
  const phones = new Set(existing.map((r) => String(r.phone || '').replace(/\D/g, '')).filter((v) => v.length >= 8));
  let imported = 0; let duplicates = 0;
  for (const lead of parsed.records) {
    const email = String(lead.email || '').trim().toLowerCase();
    const phone = String(lead.phone || '').replace(/\D/g, '');
    if ((email && emails.has(email)) || (phone.length >= 8 && phones.has(phone))) { duplicates++; continue; }
    try {
      createLead({ ...lead, entityType: lead.entity_type, layout_id: layoutId });
      imported++; if (email) emails.add(email); if (phone.length >= 8) phones.add(phone);
    } catch { parsed.skipped.push({ reason: 'registro inválido' }); }
  }
  return { imported, duplicates, skipped: parsed.skipped.length, total: parsed.rows.length, mapping: mappingSummary(parsed.mapping), warnings: parsed.warnings };
}

export function importLeadsCsv(text, layoutId) {
  return importLeadRows(parseDelimited(text), layoutId);
}

// ── Sincronização local ↔ nuvem (a orquestração fica em sync.mjs) ──
/** Leads + nome do funil, com os campos de vínculo. */
export function listLeadsForSync() {
  return openDb().prepare('SELECT l.*, y.name AS layout_name FROM leads l LEFT JOIN layouts y ON y.id = l.layout_id ORDER BY l.id').all();
}
/** Funis com colunas no formato que a nuvem entende ({ id: col_key, title }). */
export function layoutsForSync() {
  const defId = getDefaultLayoutId();
  return listLayouts().map((l) => ({
    name: l.name, isDefault: l.id === defId,
    columns: listColumns(l.id).map((c) => ({ id: c.col_key, title: c.title })),
  }));
}
/** Um lead mudou aqui desde a última sincronização? (nunca sincronizado também conta) */
export function isLeadDirty(l) {
  if (!l.local_synced_at) return true;
  return String(l.updated_at || l.created_at || '') > String(l.local_synced_at);
}
/** Grava o vínculo com a nuvem e marca o lead como em dia (aqui e lá). */
export function markLeadSynced(id, cloudId, cloudSeenAt) {
  openDb().prepare('UPDATE leads SET cloud_id=?, cloud_seen_at=?, local_synced_at=? WHERE id=?').run(Number(cloudId), String(cloudSeenAt || ''), now(), Number(id));
}
/** Vincula sem marcar como em dia: as duas pontas ficam "sujas" e a mais recente vence no próximo passo. */
export function linkLeadPending(id, cloudId) {
  openDb().prepare('UPDATE leads SET cloud_id=?, cloud_seen_at=NULL, local_synced_at=NULL WHERE id=?').run(Number(cloudId), Number(id));
}
/** Resumo barato (sem rede) para a tela: quantos leads, quantos já vinculados, quantos pendentes. */
export function syncSummary() {
  const leads = listLeadsForSync();
  return { total: leads.length, linked: leads.filter((l) => l.cloud_id).length, pending: leads.filter((l) => !l.cloud_id || isLeadDirty(l)).length };
}

/** Garante, no app local, o funil da nuvem (casa pelo padrão ou pelo nome) e as colunas dele. Devolve id local. */
export function ensureLayoutFromCloud(cl) {
  const db = openDb();
  let layout = cl.isDefault ? db.prepare('SELECT * FROM layouts WHERE id=?').get(getDefaultLayoutId())
    : db.prepare('SELECT * FROM layouts WHERE LOWER(TRIM(name)) = ? ORDER BY id LIMIT 1').get(String(cl.name || '').trim().toLowerCase());
  const cols = Array.isArray(cl.columns) ? cl.columns : [];
  if (!layout) {
    layout = db.prepare('INSERT INTO layouts (name, position, created_at) VALUES (?,?,?)').run(
      String(cl.name || 'Funil').trim() || 'Funil', (db.prepare('SELECT MAX(position) m FROM layouts').get().m ?? -1) + 1, now());
    layout = db.prepare('SELECT * FROM layouts WHERE id=?').get(layout.lastInsertRowid);
  }
  const have = new Set(listColumns(layout.id).map((c) => c.col_key));
  let pos = (db.prepare('SELECT MAX(position) m FROM columns WHERE layout_id=?').get(layout.id).m ?? -1) + 1;
  for (const c of cols) {
    const key = clean(c?.id); if (!key || have.has(key)) continue;
    db.prepare('INSERT INTO columns (layout_id,col_key,title,color,position) VALUES (?,?,?,?,?)').run(layout.id, key, clean(c.title) || key, COLUMN_COLORS[pos % COLUMN_COLORS.length], pos++);
    have.add(key);
  }
  return layout.id;
}

/** Cria ou atualiza um lead local a partir de um lead da nuvem e já o marca como em dia. */
export function applyCloudLead(existingId, c, layoutId) {
  const db = openDb();
  const keys = new Set(listColumns(layoutId).map((x) => x.col_key));
  const stage = keys.has(c.stage) ? c.stage : firstColKey(layoutId);
  const entity = String(c.entityType).toUpperCase() === 'PJ' ? 'PJ' : 'PF';
  let id = existingId;
  if (id) {
    db.prepare('UPDATE leads SET name=?,email=?,phone=?,city=?,description=?,subtitle=?,entity_type=?,stage=?,layout_id=?,updated_at=? WHERE id=?')
      .run(String(c.name).trim() || 'Sem nome', clean(c.email), clean(c.phone), clean(c.city), clean(c.description), clean(c.subtitle), entity, stage, layoutId, now(), id);
  } else {
    id = db.prepare(`INSERT INTO leads (name,email,phone,city,stage,description,subtitle,entity_type,custom_fields,layout_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,'{}',?,?)`).run(String(c.name).trim() || 'Sem nome', clean(c.email), clean(c.phone), clean(c.city), stage, clean(c.description), clean(c.subtitle), entity, layoutId, now()).lastInsertRowid;
  }
  markLeadSynced(id, c.cloudId, c.updatedAt);
  return Number(id);
}
