/** Teste rápido do CRM local (sem cliente MCP). Usa uma pasta temporária. */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { CaptaMaisConfig } from './config.js';
import { createLead, listLeads, moveStage, getLead } from './db.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captamais-mcp-test-'));
const config: CaptaMaisConfig = {
  dataDir,
  dbPath: path.join(dataDir, 'captamais.db'),
  cloudUrl: 'https://captamais.me',
  apiKey: '',
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`  ok — ${msg}`);
}

console.log('== CRM local (captamais-mcp) ==');

const a = createLead(config, { name: 'João Silva', email: 'joao@x.com', phone: '11999998888', city: 'São Paulo' });
assert(a.id > 0, 'criar lead retorna id');
assert(a.stage === 'NEW LEAD', 'etapa inicial NEW LEAD');

const b = createLead(config, { name: 'Maria Souza', phone: '21988887777', stage: 'MEETING' });
assert(b.stage === 'MEETING', 'criar lead com etapa MEETING');

const all = listLeads(config, {});
assert(all.length === 2, 'listar retorna 2 leads');

const onlyMeeting = listLeads(config, { stage: 'meeting' });
assert(onlyMeeting.length === 1 && onlyMeeting[0].name === 'Maria Souza', 'filtro por etapa (case-insensitive)');

const search = listLeads(config, { search: 'joao@x' });
assert(search.length === 1 && search[0].name === 'João Silva', 'busca por email');

const moved = moveStage(config, a.id, 'WON');
assert(!!moved && moved.stage === 'WON', 'mover etapa para WON');
assert(getLead(config, a.id)?.stage === 'WON', 'persistiu a etapa WON');

const missing = moveStage(config, 99999, 'WON');
assert(missing === null, 'mover lead inexistente retorna null');

console.log('\n✅ CRM local OK. Banco:', config.dbPath);
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
