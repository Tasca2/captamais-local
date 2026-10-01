/** Teste rápido do CRM local (sem cliente MCP). Usa uma pasta temporária. */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { normalizeCloudUrl, type CaptaMaisConfig } from './config.js';
import { createActivity, createLead, listLeads, moveStage, getLead, setActivityGoogleEvent } from './db.js';
import { importLeadFile, readLeadFile } from './leadImport.js';

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

assert(normalizeCloudUrl('https://captamais.me/') === 'https://captamais.me', 'aceita a nuvem oficial por HTTPS');
assert(normalizeCloudUrl('http://127.0.0.1:3000/') === 'http://127.0.0.1:3000', 'aceita HTTP somente no loopback');
try {
  normalizeCloudUrl('https://dominio-externo.example');
  assert(false, 'recusa host externo');
} catch {
  console.log('  ok — recusa host externo');
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

const activity = createActivity(config, a.id, { type: 'meeting', title: 'Diagnóstico', dueAt: '2026-09-18T14:00:00.000Z' });
assert(activity.lead_id === a.id && activity.type === 'meeting', 'criar atividade local');
const synced = setActivityGoogleEvent(config, activity.id, { eventId: 'evt-1', htmlLink: 'https://calendar.google.com/event/1', meetLink: 'https://meet.google.com/abc-defg-hij' });
assert(synced.calendar_sync_status === 'synced' && synced.google_event_id === 'evt-1', 'persistir vínculo com evento Google');

const csvFile = path.join(dataDir, 'leads.csv');
fs.writeFileSync(csvFile, 'Lista de contatos;;;;\nNome do contato;WhatsApp;E-mail;Município;Detalhes\nAna Lima;(11) 97777-6666;ANA@EXEMPLO.COM;São Paulo;Pediu retorno\nAna Lima;(11) 97777-6666;ANA@EXEMPLO.COM;São Paulo;Duplicada\n');
const parsedImport = await readLeadFile(csvFile);
assert(parsedImport.mapping.includes('Nome do contato → Nome'), 'identifica coluna de nome da planilha');
assert(parsedImport.mapping.includes('WhatsApp → Telefone'), 'identifica coluna de telefone da planilha');
const importResult = importLeadFile(config, parsedImport);
assert(importResult.imported === 1 && importResult.skipped === 1, 'importa lead e elimina duplicado da planilha');
assert(listLeads(config, { search: 'ANA@EXEMPLO.COM' }).length === 1, 'normaliza e-mail importado');

console.log('\n✅ CRM local OK. Banco:', config.dbPath);
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
