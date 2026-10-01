/**
 * Pesquisar / Gerar leads: listas compradas com créditos do CaptaMais.
 *
 * - A BUSCA e a COBRANÇA acontecem na nuvem (banco do Capta+ e créditos). Aqui só se guarda o que a pessoa
 *   COMPROU: a lista fica no banco local (~/.captamais), de onde pode ser baixada em Excel ou importada ao CRM.
 * - Nada além do que foi comprado desce para o computador. A prévia da busca vem mascarada pela nuvem.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as db from './db.mjs';

const CHUNK = 500; // leads por chamada de compra (a nuvem cobra e entrega por lote)
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const digits = (v) => String(v ?? '').replace(/\D/g, '');

// Campos aceitos: os mesmos da tela EnriqueceLead (a nuvem valida de novo). Valores sempre texto; "sim"/"nao" nos filtros de presença.
const FILTER_KEYS = ['cnae', 'uf', 'municipio', 'situacao', 'matrizFilial', 'porte', 'naturezaJuridica', 'qtdFuncionarios', 'temCelular', 'temTelefone', 'temEmail', 'temSite',
  'capitalMin', 'capitalMax', 'faixaFaturamento', 'temDividas', 'regimeTributario', 'dataAberturaMin', 'dataAberturaMax'];
const LOOKUP_FIELDS = ['all', 'nome', 'cnpj', 'socio', 'email', 'telefone'];

/** Aceita só os campos conhecidos. */
export function sanitizeSearch(b = {}) {
  const mode = b.mode === 'lookup' ? 'lookup' : 'filters';
  const out = { mode };
  if (mode === 'lookup') {
    out.query = str(b.query, 200);
    out.field = LOOKUP_FIELDS.includes(b.field) ? b.field : 'all';
    if (out.query.length < 2) throw new Error('Digite ao menos 2 caracteres para pesquisar.');
    return out;
  }
  const f = {}, src = b.filters || {};
  for (const k of FILTER_KEYS) {
    const raw = src[k];
    const v = raw === true ? 'sim' : str(raw, 60);
    if (v) f[k] = v;
  }
  if (!Object.keys(f).length) throw new Error('Escolha ao menos um filtro para gerar a lista.');
  out.filters = f;
  return out;
}

/** Opções dos filtros (UFs, portes, naturezas, faixas…) e cidades por estado — as mesmas da tela do site. Não gasta créditos. */
export async function filterOptions(cloud) {
  const d = await cloud('/api/mcp/leads/filters', {});
  if (!d.ok) throw new Error(d.message || 'Não foi possível carregar os filtros agora.');
  const arr = (v) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, 500) : []);
  return { ufs: arr(d.ufs), portes: arr(d.portes), faixasFaturamento: arr(d.faixasFaturamento), naturezasJuridicas: arr(d.naturezasJuridicas), qtdFuncionarios: arr(d.qtdFuncionarios) };
}
export async function municipios(cloud, uf) {
  const d = await cloud('/api/mcp/leads/municipios', { uf: str(uf, 2).toUpperCase() });
  if (!d.ok) throw new Error(d.message || 'Não foi possível carregar as cidades agora.');
  return (Array.isArray(d.municipios) ? d.municipios : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 3000);
}

export async function credits(cloud) {
  const d = await cloud('/api/mcp/leads/credits', {});
  if (!d.ok) throw new Error(d.message || 'Não foi possível consultar seus créditos.');
  // Premium/Max ganham créditos mensais para usar na skill/MCP (dentro do site é ilimitado); a nuvem informa o detalhe.
  const n = (v) => (v == null || v === '' ? null : Number(v) || 0);
  return {
    balance: Number(d.balance) || 0, pricePerLead: Number(d.pricePerLead) || 0, buyUrl: str(d.buyUrl, 300),
    plan: str(d.plan, 20), monthlyAllowance: n(d.monthlyAllowance), planBalance: n(d.planBalance), purchasedBalance: n(d.purchasedBalance), bonusBalance: n(d.bonusBalance), bonusExpiresAt: str(d.bonusExpiresAt, 40),
    resetsAt: str(d.resetsAt, 40), expiresAt: str(d.expiresAt, 40),
  };
}

/** Conta os resultados (sem cobrar) e devolve preço, saldo e uma prévia mascarada. */
export async function search(cloud, body) {
  const q = sanitizeSearch(body);
  const d = await cloud('/api/mcp/leads/search', q);
  if (!d.ok) throw new Error(d.message || 'A busca não pôde ser feita agora.');
  return {
    searchId: str(d.searchId, 80), total: Number(d.total) || 0, pricePerLead: Number(d.pricePerLead) || 0,
    balance: Number(d.balance) || 0, buyUrl: str(d.buyUrl, 300),
    preview: (Array.isArray(d.preview) ? d.preview : []).slice(0, 5).map((p) => ({
      nome: str(p.nome ?? p.name, 80), cidade: str(p.cidade ?? p.city, 60), uf: str(p.uf, 2), porte: str(p.porte, 40),
    })),
    // Pesquisa por nome: poucos resultados vêm com o nome visível e o preço de abrir cada um.
    results: (Array.isArray(d.results) ? d.results : []).slice(0, 50).map((p) => ({
      resultId: str(p.resultId ?? p.id, 80), nome: str(p.nome ?? p.name, 120), cidade: str(p.cidade ?? p.city, 60), uf: str(p.uf, 2),
      porte: str(p.porte, 40), price: Number(p.price ?? d.pricePerLead) || 0,
    })).filter((p) => p.resultId),
    query: q,
  };
}

/**
 * Compra `quantity` leads de uma busca. A nuvem desconta os créditos e entrega os dados; se o saldo acabar no meio,
 * a lista fica com o que foi pago (proporcional ao saldo). Grava a lista no banco local.
 */
export async function buy(cloud, { searchId, quantity, resultIds, name, query, total, pricePerLead }) {
  // Pesquisa por nome: compra os resultados escolhidos (resultIds). Gerar lista: compra por quantidade.
  const ids = Array.isArray(resultIds) ? resultIds.map((x) => str(x, 80)).filter(Boolean).slice(0, 200) : [];
  const want = ids.length || Math.floor(Number(quantity));
  const marketLeadIds = [];
  if (!searchId) throw new Error('Faça a busca antes de comprar.');
  if (!(want >= 1)) throw new Error('Informe quantos leads quer gerar.');
  const purchaseId = crypto.randomUUID(); // idempotência: repetir uma chamada não cobra duas vezes
  let listId = null, got = 0, spent = 0, balance = null, error = '';
  while (got < want) {
    const n = Math.min(CHUNK, want - got);
    const d = await cloud('/api/mcp/leads/purchase', ids.length ? { searchId, purchaseId, resultIds: ids.slice(got, got + n) } : { searchId, purchaseId, offset: got, quantity: n });
    if (!d.ok) { error = d.code === 'insufficient_credits' ? 'Seus créditos acabaram.' : (d.message || 'A compra foi interrompida.'); break; }
    const rows = Array.isArray(d.leads) ? d.leads : [];
    if (rows.length) {
      if (listId === null) listId = createList({ name, query, total, mode: query?.mode });
      marketLeadIds.push(...addLeads(listId, rows));
      got += rows.length; spent += Number(d.charged) || 0;
    }
    if (d.balance != null) balance = Number(d.balance) || 0;
    if (d.partial || rows.length < n) break; // créditos ou resultados acabaram: fica com o que foi pago
  }
  if (listId === null) throw new Error(error || 'Nenhum lead foi comprado.');
  finishList(listId, got, spent);
  return { listId, marketLeadIds, purchased: got, requested: want, partial: got < want, creditsSpent: spent, balance, pricePerLead: Number(pricePerLead) || 0, message: error };
}

// ── Banco local ──
const MAP = {
  cnpj: ['cnpj'], razao: ['razaoSocial', 'razao', 'name'], fantasia: ['nomeFantasia', 'fantasia'], email: ['email'],
  phone: ['phone', 'telefone'], cellphone: ['cellphone', 'celular'], city: ['city', 'cidade'], uf: ['uf'], cnae: ['cnae'],
  porte: ['porte'], situacao: ['situacao'], socio: ['socio', 'partner'], site: ['site'],
};
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && String(o[k]).trim()) return str(o[k], 300); return null; };

function createList({ name, query, total, mode }) {
  const label = str(name, 80) || (query?.mode === 'lookup' ? `Pesquisa: ${str(query.query, 50)}` : `Lista ${new Date().toLocaleDateString('pt-BR')}`);
  const info = db.openDb().prepare(
    `INSERT INTO lead_lists (name,mode,query,filters,total_found,created_at) VALUES (?,?,?,?,?,?)`,
  ).run(label, mode || 'filters', query?.query || null, query?.filters ? JSON.stringify(query.filters) : (query?.field ? JSON.stringify({ field: query.field }) : null), Number(total) || 0, new Date().toISOString());
  return Number(info.lastInsertRowid);
}
function addLeads(listId, rows) {
  const d = db.openDb();
  const ins = d.prepare(`INSERT INTO market_leads (list_id,cnpj,razao,fantasia,email,phone,cellphone,city,uf,cnae,porte,situacao,socio,site) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ids = [];
  d.exec('BEGIN');
  try {
    for (const r of rows) ids.push(Number(ins.run(listId, ...Object.keys(MAP).map((k) => pick(r, MAP[k]))).lastInsertRowid));
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return ids;
}

/** Enriquece um lead que a pessoa já tem com os dados comprados: só preenche o que está vazio, nunca sobrescreve. */
export function enrichLead(marketLeadId, leadId) {
  const d = db.openDb();
  const m = d.prepare('SELECT * FROM market_leads WHERE id=?').get(Number(marketLeadId));
  const cur = db.getLead(Number(leadId)).lead;
  if (!m) throw new Error('Dado comprado não encontrado.');
  if (!cur) throw new Error('Lead não encontrado.');
  const patch = {}, filled = [];
  const set = (k, v, label) => { if (v && !String(cur[k] || '').trim()) { patch[k] = v; filled.push(label); } };
  set('email', m.email, 'e-mail'); set('phone', m.cellphone || m.phone, 'telefone');
  set('city', [m.city, m.uf].filter(Boolean).join('/'), 'cidade'); set('subtitle', [m.porte, m.cnae].filter(Boolean).join(' · '), 'subtítulo');
  const lines = [m.cnpj && `CNPJ: ${m.cnpj}`, m.razao && `Razão social: ${m.razao}`, m.socio && `Sócio: ${m.socio}`, m.cnae && `CNAE: ${m.cnae}`,
    m.situacao && `Situação: ${m.situacao}`, m.site && `Site: ${m.site}`].filter((l) => l && !String(cur.description || '').includes(l));
  if (lines.length) { patch.description = [cur.description, lines.join('\n')].filter(Boolean).join('\n\n'); filled.push('dados da empresa'); }
  if (Object.keys(patch).length) db.updateLead(Number(leadId), patch);
  d.prepare('UPDATE market_leads SET imported_lead_id=? WHERE id=? AND imported_lead_id IS NULL').run(Number(leadId), Number(marketLeadId));
  return { filled };
}
function finishList(listId, purchased, spent) {
  db.openDb().prepare('UPDATE lead_lists SET purchased=?, credits_spent=? WHERE id=?').run(purchased, spent, listId);
}

export function getLists() {
  return db.openDb().prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM market_leads m WHERE m.list_id=l.id AND m.imported_lead_id IS NOT NULL) AS imported
     FROM lead_lists l ORDER BY l.id DESC`).all();
}
export function getList(id, limit = 200) {
  const d = db.openDb();
  const list = d.prepare('SELECT * FROM lead_lists WHERE id=?').get(Number(id));
  if (!list) return null;
  return { list, leads: d.prepare('SELECT * FROM market_leads WHERE list_id=? ORDER BY id LIMIT ?').all(Number(id), limit) };
}

/** Cria leads no CRM a partir da lista (sem duplicar e-mail/telefone/CNPJ já importados). Devolve contagens. */
export function importToCrm(listId, layoutId) {
  const d = db.openDb();
  const rows = d.prepare('SELECT * FROM market_leads WHERE list_id=? AND imported_lead_id IS NULL ORDER BY id').all(Number(listId));
  const seenEmail = new Set(), seenPhone = new Set();
  for (const l of d.prepare('SELECT email, phone FROM leads').all()) {
    if (l.email) seenEmail.add(String(l.email).trim().toLowerCase());
    if (l.phone) seenPhone.add(digits(l.phone).slice(-10));
  }
  let created = 0, skipped = 0;
  for (const r of rows) {
    const email = (r.email || '').trim().toLowerCase();
    const phone = r.cellphone || r.phone || '';
    const pk = digits(phone).length >= 10 ? digits(phone).slice(-10) : '';
    if ((email && seenEmail.has(email)) || (pk && seenPhone.has(pk))) { skipped++; continue; }
    const name = r.fantasia || r.razao;
    if (!name) { skipped++; continue; }
    const desc = [r.cnpj && `CNPJ: ${r.cnpj}`, r.razao && r.fantasia && r.razao !== r.fantasia && `Razão social: ${r.razao}`,
      r.socio && `Sócio: ${r.socio}`, r.cnae && `CNAE: ${r.cnae}`, r.situacao && `Situação: ${r.situacao}`, r.site && `Site: ${r.site}`].filter(Boolean).join('\n');
    const lead = db.createLead({
      name, email: r.email, phone, city: [r.city, r.uf].filter(Boolean).join('/'),
      subtitle: [r.porte, r.cnae].filter(Boolean).join(' · '), description: desc, entity_type: 'PJ', layout_id: layoutId,
    });
    d.prepare('UPDATE market_leads SET imported_lead_id=? WHERE id=?').run(lead.id, r.id);
    if (email) seenEmail.add(email); if (pk) seenPhone.add(pk);
    created++;
  }
  return { created, skipped, total: rows.length };
}

// ── Excel (.xlsx) sem dependências ──
const HEAD = ['CNPJ', 'Razão social', 'Nome fantasia', 'E-mail', 'Telefone', 'Celular', 'Cidade', 'UF', 'CNAE', 'Porte', 'Situação', 'Sócio', 'Site'];
const KEYS = ['cnpj', 'razao', 'fantasia', 'email', 'phone', 'cellphone', 'city', 'uf', 'cnae', 'porte', 'situacao', 'socio', 'site'];
const xmlEsc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => String.fromCharCode(65 + i);
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, content] of files) {
    const raw = Buffer.from(content, 'utf8'), data = zlib.deflateRawSync(raw), nm = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += lh.length + nm.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/** Monta a planilha da lista. Tudo como texto (preserva zeros à esquerda de CNPJ e telefone). */
export function listToXlsx(listId) {
  const data = getList(listId, 1e6);
  if (!data) return null;
  const cell = (r, c, v) => `<c r="${colName(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  const rows = [`<row r="1">${HEAD.map((h, c) => cell(1, c, h)).join('')}</row>`];
  data.leads.forEach((l, i) => rows.push(`<row r="${i + 2}">${KEYS.map((k, c) => cell(i + 2, c, l[k])).join('')}</row>`));
  const widths = [18, 36, 30, 30, 16, 16, 22, 6, 14, 14, 14, 28, 28];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
  const buf = zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
  return { buffer: buf, filename: `captamais-${data.list.name.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'leads'}.xlsx` };
}
