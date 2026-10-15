import Database from 'better-sqlite3';
import type { CaptaMaisConfig } from './config.js';

export type Lead = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  stage: string;
  description: string | null;
  subtitle: string | null;
  entity_type: string;
  custom_fields: string;
  created_at: string;
  updated_at: string | null;
};
export type Activity = {
  id: number; lead_id: number; type: string; title: string | null; due_at: string | null;
  done: number; notes: string | null; meet_link: string | null; created_at: string;
  google_event_id: string | null; google_event_url: string | null; calendar_sync_status: string | null;
};

/** Etapas padrão do funil local. */
export const DEFAULT_STAGES = ['NEW LEAD', 'CONTACTED', 'MEETING', 'PROPOSAL', 'WON', 'LOST'] as const;

let db: Database.Database | null = null;

/**
 * Abre (e cria/migra) o banco LOCAL do usuário. Os dados ficam só na máquina dele.
 */
export function openDb(config: CaptaMaisConfig): Database.Database {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      city TEXT,
      stage TEXT NOT NULL DEFAULT 'NEW LEAD',
      description TEXT,
      subtitle TEXT,
      entity_type TEXT NOT NULL DEFAULT 'PF',
      custom_fields TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT,
      due_at TEXT, done INTEGER NOT NULL DEFAULT 0, notes TEXT, meet_link TEXT, created_at TEXT NOT NULL,
      google_event_id TEXT, google_event_url TEXT, calendar_sync_status TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_act_lead ON activities(lead_id);
    CREATE TABLE IF NOT EXISTS lead_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mode TEXT, query TEXT, filters TEXT,
      total_found INTEGER NOT NULL DEFAULT 0, purchased INTEGER NOT NULL DEFAULT 0, credits_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL, cnpj TEXT, razao TEXT, fantasia TEXT, email TEXT,
      phone TEXT, cellphone TEXT, city TEXT, uf TEXT, cnae TEXT, porte TEXT, situacao TEXT, socio TEXT, site TEXT,
      imported_lead_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ml_list ON market_leads(list_id);
  `);
  // Funis (layouts) — mesmas tabelas do CRM visual (captamais-skill), para o MCP também escolher o destino.
  db.exec(`
    CREATE TABLE IF NOT EXISTS layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, layout_id INTEGER NOT NULL, col_key TEXT NOT NULL,
      title TEXT NOT NULL, color TEXT, position INTEGER NOT NULL DEFAULT 0);
  `);
  try { db.exec('ALTER TABLE leads ADD COLUMN layout_id INTEGER'); } catch {}
  if (!db.prepare('SELECT id FROM layouts LIMIT 1').get()) {
    const id = Number(db.prepare('INSERT INTO layouts (name, position, created_at) VALUES (?,?,?)').run('Prospecção', 0, new Date().toISOString()).lastInsertRowid);
    const cols: [string, string, string][] = [
      ['NEW LEAD', 'NOVO LEAD', '#3b82f6'], ['INITIAL CONTACT', 'CONTATO INICIAL', '#8b5cf6'], ['FIRST MEETING', 'PRIMEIRA REUNIÃO', '#6366f1'],
      ['SECOND MEETING', 'SEGUNDA REUNIÃO', '#f59e0b'], ['CLOSING', 'FECHAMENTO', '#10b981'],
    ];
    cols.forEach((c, i) => db!.prepare('INSERT INTO columns (layout_id,col_key,title,color,position) VALUES (?,?,?,?,?)').run(id, c[0], c[1], c[2], i));
    db.prepare('UPDATE leads SET layout_id = ? WHERE layout_id IS NULL').run(id);
  }
  try { db.exec('ALTER TABLE activities ADD COLUMN google_event_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE activities ADD COLUMN google_event_url TEXT'); } catch {}
  try { db.exec('ALTER TABLE activities ADD COLUMN calendar_sync_status TEXT'); } catch {}
  return db;
}

export function listLeads(config: CaptaMaisConfig, opts?: { stage?: string; search?: string; limit?: number }): Lead[] {
  const conn = openDb(config);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts?.stage) {
    clauses.push('UPPER(stage) = UPPER(?)');
    params.push(opts.stage);
  }
  if (opts?.search) {
    clauses.push('(name LIKE ? OR IFNULL(email,\'\') LIKE ? OR IFNULL(phone,\'\') LIKE ?)');
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 500);
  return conn
    .prepare(`SELECT * FROM leads ${where} ORDER BY datetime(created_at) DESC LIMIT ?`)
    .all(...params, limit) as Lead[];
}

export type Layout = { id: number; name: string; position: number; created_at: string };

export function listLayouts(config: CaptaMaisConfig): Layout[] {
  return openDb(config).prepare('SELECT * FROM layouts ORDER BY position, id').all() as Layout[];
}

export function createLayout(config: CaptaMaisConfig, name: string): Layout {
  const conn = openDb(config);
  const clean = String(name || '').trim().slice(0, 60) || 'Novo funil';
  const pos = ((conn.prepare('SELECT MAX(position) m FROM layouts').get() as { m: number | null }).m ?? -1) + 1;
  const id = Number(conn.prepare('INSERT INTO layouts (name, position, created_at) VALUES (?,?,?)').run(clean, pos, new Date().toISOString()).lastInsertRowid);
  [['Entrada', '#3b82f6'], ['Em andamento', '#f59e0b'], ['Ganhos', '#10b981']].forEach((c, i) =>
    conn.prepare('INSERT INTO columns (layout_id,col_key,title,color,position) VALUES (?,?,?,?,?)').run(id, 'col_' + Math.random().toString(16).slice(2, 12), c[0], c[1], i));
  return conn.prepare('SELECT * FROM layouts WHERE id=?').get(id) as Layout;
}

/**
 * Funil de destino escolhido pelo usuário: id/nome de um existente, ou um novo (criado agora).
 * Devolve null se nada foi informado ou o funil não existe — não há destino "padrão" silencioso.
 */
export function resolveLayoutTarget(config: CaptaMaisConfig, opts: { layout?: string | number; newLayoutName?: string }): number | null {
  if (opts.newLayoutName && opts.newLayoutName.trim()) return createLayout(config, opts.newLayoutName).id;
  const ref = String(opts.layout ?? '').trim();
  if (!ref) return null;
  const all = listLayouts(config);
  const byId = /^\d+$/.test(ref) ? all.find((l) => l.id === Number(ref)) : undefined;
  const byName = all.find((l) => l.name.trim().toLowerCase() === ref.toLowerCase());
  return (byId || byName)?.id ?? null;
}

export function createLead(
  config: CaptaMaisConfig,
  input: { name: string; email?: string; phone?: string; city?: string; stage?: string; description?: string; subtitle?: string; entityType?: string; layoutId?: number },
): Lead {
  const conn = openDb(config);
  const now = new Date().toISOString();
  const layoutId = input.layoutId && listLayouts(config).some((l) => l.id === input.layoutId) ? input.layoutId : listLayouts(config)[0]?.id;
  const firstCol = (conn.prepare('SELECT col_key FROM columns WHERE layout_id = ? ORDER BY position, id LIMIT 1').get(layoutId) as { col_key: string } | undefined)?.col_key;
  const stage = (input.stage || firstCol || 'NEW LEAD').trim() || 'NEW LEAD';
  const info = conn
    .prepare(
      `INSERT INTO leads (name, email, phone, city, stage, description, subtitle, entity_type, custom_fields, created_at, layout_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    )
    .run(
      input.name.trim(),
      (input.email || '').trim() || null,
      (input.phone || '').trim() || null,
      (input.city || '').trim() || null,
      stage,
      (input.description || '').trim() || null,
      (input.subtitle || '').trim() || null,
      (input.entityType || 'PF').trim() || 'PF',
      now,
      layoutId ?? null,
    );
  return conn.prepare('SELECT * FROM leads WHERE id = ?').get(Number(info.lastInsertRowid)) as Lead;
}

export function moveStage(config: CaptaMaisConfig, leadId: number, stage: string): Lead | null {
  const conn = openDb(config);
  const now = new Date().toISOString();
  const res = conn.prepare('UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?').run(stage.trim(), now, leadId);
  if (res.changes === 0) return null;
  return conn.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead;
}

export function getLead(config: CaptaMaisConfig, leadId: number): Lead | null {
  const conn = openDb(config);
  return (conn.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead | undefined) || null;
}

export function createActivity(
  config: CaptaMaisConfig,
  leadId: number,
  input: { type: string; title?: string; dueAt: string; notes?: string },
): Activity {
  const conn = openDb(config);
  if (!getLead(config, leadId)) throw new Error('Lead não encontrado.');
  const type = input.type.toLowerCase();
  if (!['call', 'followup', 'meeting', 'task'].includes(type)) throw new Error('Tipo de atividade inválido.');
  const info = conn.prepare(`INSERT INTO activities (lead_id,type,title,due_at,notes,created_at) VALUES (?,?,?,?,?,?)`)
    .run(leadId, type, input.title?.trim() || null, input.dueAt, input.notes?.trim() || null, new Date().toISOString());
  return conn.prepare('SELECT * FROM activities WHERE id=?').get(Number(info.lastInsertRowid)) as Activity;
}

export function setActivityGoogleEvent(
  config: CaptaMaisConfig,
  activityId: number,
  event: { eventId?: string; htmlLink?: string; meetLink?: string } | null,
): Activity {
  const conn = openDb(config);
  conn.prepare(`UPDATE activities SET google_event_id=?,google_event_url=?,meet_link=?,calendar_sync_status=? WHERE id=?`)
    .run(event?.eventId || null, event?.htmlLink || null, event?.meetLink || null, event ? 'synced' : 'error', activityId);
  return conn.prepare('SELECT * FROM activities WHERE id=?').get(activityId) as Activity;
}
