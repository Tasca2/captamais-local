#!/usr/bin/env node
/**
 * CLI do CRM local (ações por conversa/snapshot). Usa o mesmo motor do app: ./db.mjs.
 * Uso: node crm.mjs <comando> [--chave valor ...]
 * Comandos: board | render | list | add-lead | set-stage | activity | agenda | done | show
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) out[k] = true; else { out[k] = n; i++; } }
  }
  return out;
}
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
const fail = (m) => { out({ ok: false, error: m }); process.exit(1); };

const [, , cmd, ...rest] = process.argv;
const a = parseArgs(rest);

try {
  switch (cmd) {
    case 'board': out({ ok: true, ...db.computeBoard(a.layout) }); break;
    case 'render': {
      const board = db.computeBoard(a.layout);
      const tpl = fs.readFileSync(path.join(SCRIPT_DIR, '..', 'assets', 'board.html'), 'utf8');
      const safe = JSON.stringify(board).replace(/</g, '\\u003c');
      const html = tpl.replace(/\/\*__CRM_DATA__\*\/[\s\S]*?\};/, `/*__CRM_DATA__*/ ${safe};`);
      const outPath = path.join(db.dataDir(), 'crm-view.html');
      fs.writeFileSync(outPath, html);
      out({ ok: true, path: outPath, totals: board.totals });
      break;
    }
    case 'list': {
      const conn = db.openDb();
      const clauses = [], params = [];
      if (a.stage) { clauses.push('stage=?'); params.push(String(a.stage)); }
      if (a.search) { const q = `%${a.search}%`; clauses.push("(name LIKE ? OR IFNULL(email,'') LIKE ? OR IFNULL(phone,'') LIKE ?)"); params.push(q, q, q); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const leads = conn.prepare(`SELECT * FROM leads ${where} ORDER BY datetime(created_at) DESC LIMIT 200`).all(...params);
      out({ ok: true, count: leads.length, leads });
      break;
    }
    case 'add-lead':
      if (!a.name || a.name === true) fail('Informe --name.');
      out({ ok: true, lead: db.createLead({ name: a.name, email: a.email, phone: a.phone, city: a.city, stage: a.stage, subtitle: a.subtitle, description: a.description, entityType: a.entityType }) });
      break;
    case 'set-stage':
      if (!a.id || !a.stage || a.stage === true) fail('Informe --id e --stage.');
      { const l = db.moveStage(Number(a.id), String(a.stage)); l ? out({ ok: true, lead: l }) : fail('Lead não encontrado.'); }
      break;
    case 'activity':
      if (!a.lead || !a.type) fail('Informe --lead e --type (call|followup|meeting|task).');
      out({ ok: true, activity: db.addActivity(Number(a.lead), { type: a.type, title: a.title, due_at: a.due, notes: a.notes, meet_link: a.meet === true ? 'https://meet.google.com/new' : a.meet }) });
      break;
    case 'agenda': out({ ok: true, items: db.agenda(Number(a.days) || 7) }); break;
    case 'done': if (!a.activity) fail('Informe --activity N.'); out({ ok: db.doneActivity(Number(a.activity)) }); break;
    case 'show': { if (!a.id) fail('Informe --id N.'); const r = db.getLead(Number(a.id)); r.lead ? out({ ok: true, ...r }) : fail('Lead não encontrado.'); break; }
    default:
      out({ ok: false, error: `Comando desconhecido: ${cmd || '(vazio)'}`, comandos: ['board', 'render', 'list', 'add-lead', 'set-stage', 'activity', 'agenda', 'done', 'show'] });
      process.exit(1);
  }
} catch (e) { fail(e.message || String(e)); }
