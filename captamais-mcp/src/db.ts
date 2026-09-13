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
  `);
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

export function createLead(
  config: CaptaMaisConfig,
  input: { name: string; email?: string; phone?: string; city?: string; stage?: string; description?: string; subtitle?: string; entityType?: string },
): Lead {
  const conn = openDb(config);
  const now = new Date().toISOString();
  const stage = (input.stage || 'NEW LEAD').trim() || 'NEW LEAD';
  const info = conn
    .prepare(
      `INSERT INTO leads (name, email, phone, city, stage, description, subtitle, entity_type, custom_fields, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
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
