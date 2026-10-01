import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CAPTAMAIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'captamais-lead-popup-'));
const db = await import('./db.mjs');

test('PF nunca armazena CNPJ e PJ pode armazenar', () => {
  const pf = db.createLead({ name: 'Pessoa', entity_type: 'PF', cnpj: '11.111.111/1111-11' });
  assert.equal(pf.cnpj, null);
  let pj = db.createLead({ name: 'Empresa', entity_type: 'PJ', cnpj: '22.222.222/2222-22' });
  assert.equal(pj.cnpj, '22.222.222/2222-22');
  pj = db.updateLead(pj.id, { entity_type: 'PF' });
  assert.equal(pj.cnpj, null);
});

test('novos tipos de atividade são aceitos e atividade sem data usa a hora da marcação', () => {
  const lead = db.createLead({ name: 'Atividades' });
  for (const type of ['r1', 'r2', 'r3', 'followup', 'whatsapp', 'call_attempt']) {
    const before = Date.now();
    const activity = db.addActivity(lead.id, { type });
    const due = Date.parse(activity.due_at);
    assert.ok(due >= before && due <= Date.now());
    assert.equal(activity.title, db.ACTIVITY_LABEL[type]);
  }
});

test('popup mostra os seis atalhos, oculta CNPJ por padrão e permite fechar sem salvar', () => {
  const html = fs.readFileSync(new URL('../assets/app.html', import.meta.url), 'utf8');
  for (const type of ['r1', 'r2', 'r3', 'followup', 'whatsapp', 'call_attempt']) {
    assert.match(html, new RegExp(`quickAct\\('${type}'\\)`));
  }
  assert.match(html, /id="fCnpjWrap" hidden/);
  assert.match(html, /onchange="toggleLeadCnpj\(\)"/);
  assert.match(html, />Fechar sem salvar</);
  assert.match(html, /id="credChip"/);
  assert.doesNotMatch(html.match(/<button[^>]+id="credChip"[^>]*>/)?.[0] || '', /hidden/);
  assert.match(html, /id="updateBtn"/);
  assert.match(html, /id="mUpdate"/);
  assert.doesNotMatch(html, /Calculadora e CNPJ são grátis/);
  assert.match(html, /Conecte-se e ganhe 10\.000 créditos/);
  assert.match(html, /disponível nos planos Premium e Max/);
});
