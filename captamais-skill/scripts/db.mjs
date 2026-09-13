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

// Colunas-padrão do funil inicial.
const DEFAULT_COLUMNS = [
  { col_key: 'NEW LEAD', title: 'NOVO LEAD', color: '#3b82f6' },
  { col_key: 'INITIAL CONTACT', title: 'CONTATO INICIAL', color: '#8b5cf6' },
  { col_key: 'FIRST MEETING', title: 'PRIMEIRA REUNIÃO', color: '#6366f1' },
  { col_key: 'SECOND MEETING', title: 'SEGUNDA REUNIÃO', color: '#f59e0b' },
  { col_key: 'CLOSING', title: 'FECHAMENTO', color: '#10b981' },
];
export const ACTIVITY_TYPES = ['call', 'followup', 'meeting', 'task'];
export const ACTIVITY_LABEL = { call: 'Ligação', followup: 'Follow-up', meeting: 'Reunião', task: 'Tarefa' };
export const COLUMN_COLORS = ['#3b82f6', '#8b5cf6', '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#71717a'];

export function safeHttpUrl(u) {
  const s = String(u || '').trim(); if (!s) return null;
  try { const p = new URL(s); return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : null; } catch { return null; }
}
export function dataDir() {
  const dir = process.env.CAPTAMAIS_DATA_DIR || path.join(os.homedir(), '.captamais');
  fs.mkdirSync(dir, { recursive: true }); return dir;
}
const now = () => new Date().toISOString();
const clean = (v) => { if (v === undefined || v === null) return null; const s = String(v).trim(); return s || null; };
const newKey = () => 'col_' + crypto.randomBytes(5).toString('hex');

let _db = null;
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
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, phone TEXT, city TEXT,
      stage TEXT NOT NULL DEFAULT 'NEW LEAD', description TEXT, subtitle TEXT,
      entity_type TEXT NOT NULL DEFAULT 'PF', custom_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT,
      due_at TEXT, done INTEGER NOT NULL DEFAULT 0, notes TEXT, meet_link TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_act_lead ON activities(lead_id);
  `);
  try { _db.exec('ALTER TABLE leads ADD COLUMN layout_id INTEGER'); } catch (_) {}
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
  const info = db.prepare(
    `INSERT INTO leads (name,email,phone,city,stage,description,subtitle,entity_type,custom_fields,layout_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,'{}',?,?)`,
  ).run(String(input.name).trim(), clean(input.email), clean(input.phone), clean(input.city), stage,
        clean(input.description), clean(input.subtitle), (String(input.entityType || input.entity_type || 'PF').toUpperCase() === 'PJ' ? 'PJ' : 'PF'), lid, now());
  return getLead(info.lastInsertRowid).lead;
}
export function updateLead(id, patch) {
  const db = openDb();
  const cur = db.prepare('SELECT * FROM leads WHERE id=?').get(Number(id)); if (!cur) return null;
  const g = (k, d) => (patch[k] !== undefined ? patch[k] : d);
  db.prepare(`UPDATE leads SET name=?,email=?,phone=?,city=?,stage=?,description=?,subtitle=?,entity_type=?,updated_at=? WHERE id=?`)
    .run(String(g('name', cur.name)).trim() || cur.name, clean(g('email', cur.email)), clean(g('phone', cur.phone)),
         clean(g('city', cur.city)), clean(g('stage', cur.stage)) || cur.stage, clean(g('description', cur.description)),
         clean(g('subtitle', cur.subtitle)), (String(g('entity_type', cur.entity_type)).toUpperCase() === 'PJ' ? 'PJ' : 'PF'), now(), Number(id));
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
  const meet = type === 'meeting' && input.meet_link ? safeHttpUrl(input.meet_link) : null;
  const info = db.prepare('INSERT INTO activities (lead_id,type,title,due_at,notes,meet_link,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(Number(leadId), type, clean(input.title) || ACTIVITY_LABEL[type], clean(input.due_at), clean(input.notes), meet, now());
  return db.prepare('SELECT * FROM activities WHERE id=?').get(info.lastInsertRowid);
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
const CSV_COLS = ['name', 'email', 'phone', 'city', 'stage', 'subtitle', 'entity_type', 'description', 'created_at'];
const CSV_HEADER_PT = ['nome', 'email', 'telefone', 'cidade', 'etapa', 'subtitulo', 'tipo', 'anotacoes', 'criado_em'];
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

/** Parser CSV simples e robusto (aspas, vírgulas e quebras dentro de campo). */
function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* ignora */ }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const HEADER_ALIASES = {
  name: ['name', 'nome', 'nome completo', 'full name', 'fullname'],
  email: ['email', 'e-mail', 'e_mail', 'mail'],
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'fone', 'tel'],
  city: ['city', 'cidade', 'municipio', 'município'],
  stage: ['stage', 'etapa', 'funil', 'coluna'],
  subtitle: ['subtitle', 'subtitulo', 'subtítulo', 'empresa', 'cargo', 'companhia'],
  entity_type: ['entity_type', 'tipo', 'pf/pj', 'pf_pj'],
  description: ['description', 'anotacoes', 'anotações', 'observacoes', 'observações', 'notas', 'descricao', 'descrição'],
};
function mapHeader(h) {
  const key = String(h || '').trim().toLowerCase();
  for (const canon of Object.keys(HEADER_ALIASES)) if (HEADER_ALIASES[canon].includes(key)) return canon;
  return null;
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

export function importLeadsCsv(text, layoutId) {
  const rows = parseCsv(text);
  if (rows.length < 2) return 0;
  const headers = rows[0].map(mapHeader);
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    headers.forEach((canon, i) => { if (canon) obj[canon] = rows[r][i]; });
    if (!clean(obj.name)) continue;
    try { createLead({ ...obj, entityType: obj.entity_type, layout_id: layoutId }); n++; } catch { /* pula inválidos */ }
  }
  return n;
}
