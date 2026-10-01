import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeLeadRows, parseDelimited, rowsFromXlsx } from './lead-import.mjs';

test('reconhece CSV brasileiro, linha de título e aliases de contato', () => {
  const rows = parseDelimited('Relatório de contatos;;;;;\nNome do contato;WhatsApp;E-mail;Município;Observações;Origem\nAna Silva;(11) 98888-7777;ANA@EXEMPLO.COM;São Paulo;Pediu retorno;Evento\n');
  const result = normalizeLeadRows(rows);
  assert.equal(result.records.length, 1);
  assert.deepEqual(
    { name: result.records[0].name, phone: result.records[0].phone, email: result.records[0].email, city: result.records[0].city },
    { name: 'Ana Silva', phone: '(11) 98888-7777', email: 'ana@exemplo.com', city: 'São Paulo' },
  );
  assert.match(result.records[0].description, /Pediu retorno/);
  assert.match(result.records[0].description, /Origem: Evento/);
});

test('infere e-mail e telefone sem cabeçalho e elimina duplicados', () => {
  const result = normalizeLeadRows([
    ['Carlos Souza', 'carlos@example.com', '21999998888'],
    ['Carlos Souza', 'carlos@example.com', '21999998888'],
  ]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].email, 'carlos@example.com');
  assert.equal(result.records[0].phone, '21999998888');
  assert.equal(result.skipped[0].reason, 'duplicado no arquivo');
});

test('não troca texto comum por e-mail ou telefone inválido', () => {
  const result = normalizeLeadRows(parseDelimited('Nome,Email,Telefone,Cidade\nMaria,email-invalido,123,Curitiba'));
  assert.equal(result.records[0].name, 'Maria');
  assert.equal(result.records[0].email, '');
  assert.equal(result.records[0].phone, '');
  assert.equal(result.records[0].city, 'Curitiba');
  assert.match(result.records[0].description, /E-mail inválido: email-invalido/);
  assert.match(result.records[0].description, /Telefone inválido: 123/);
  assert.equal(result.warnings.length, 2);
});

test('lê arquivo XLSX real sem usar o pacote xlsx vulnerável', async () => {
  process.env.CAPTAMAIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'captamais-import-xlsx-'));
  const db = await import('./db.mjs');
  const leadlists = await import('./leadlists.mjs');
  const conn = db.openDb();
  const list = conn.prepare('INSERT INTO lead_lists (name,mode,query,filters,total_found,purchased,credits_spent,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('Teste XLSX','search','teste','{}',1,1,1,new Date().toISOString());
  conn.prepare('INSERT INTO market_leads (list_id,razao,email,phone,city,uf) VALUES (?,?,?,?,?,?)')
    .run(Number(list.lastInsertRowid),'Empresa Exemplo','contato@example.com','11999990000','São Paulo','SP');
  const generated = leadlists.listToXlsx(Number(list.lastInsertRowid));
  const rows = await rowsFromXlsx(generated.buffer);
  const razaoColumn = rows[0].indexOf('Razão social');
  assert.ok(razaoColumn >= 0);
  assert.equal(rows[1][razaoColumn], 'Empresa Exemplo');
  const result = normalizeLeadRows(rows);
  assert.equal(result.records[0].name, 'Empresa Exemplo');
  assert.equal(result.records[0].email, 'contato@example.com');
  assert.equal(result.records[0].phone, '11999990000');
  assert.equal(result.records[0].city, 'São Paulo');
});
