import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type { CaptaMaisConfig } from './config.js';
import { openDb, createLead } from './db.js';
import { saveApiKey } from './config.js';
import { callCloud, type MeteredResult } from './cloud.js';

/**
 * Pesquisar / Gerar leads. A busca e os créditos ficam na nuvem; a lista COMPRADA fica no banco local
 * (mesmas tabelas que o CRM visual usa).
 */
export type SearchInput = { mode: 'lookup' | 'filters'; query?: string; field?: string; filters?: Record<string, string | number | boolean> };
export type SearchResult = {
  searchId: string; total: number; pricePerLead: number; balance: number; buyUrl?: string;
  preview?: { nome?: string; cidade?: string; uf?: string; porte?: string }[];
  /** Pesquisa por nome: poucos resultados vêm com o nome visível e o preço para abrir cada um. */
  results?: { resultId: string; nome: string; cidade?: string; uf?: string; porte?: string; price?: number }[];
};
type CloudLead = Record<string, unknown>;
type PurchaseResult = { charged?: number; balance?: number; partial?: boolean; leads?: CloudLead[] };

const CHUNK = 500;
const txt = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max) || null;
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

// Buscas recentes (para comprar depois sem repetir os filtros). Vivem só enquanto o MCP estiver aberto.
const recent = new Map<string, { input: SearchInput; total: number; price: number }>();

export function leadCredits(config: CaptaMaisConfig): Promise<MeteredResult<{ balance: number; pricePerLead: number; buyUrl?: string }>> {
  return callCloud(config, '/api/mcp/leads/credits', {});
}

export async function searchLeads(config: CaptaMaisConfig, input: SearchInput): Promise<MeteredResult<SearchResult>> {
  const r = await callCloud<SearchResult>(config, '/api/mcp/leads/search', input);
  if (r.ok && r.data?.searchId) recent.set(r.data.searchId, { input, total: Number(r.data.total) || 0, price: Number(r.data.pricePerLead) || 0 });
  return r;
}

function ensureTables(config: CaptaMaisConfig) {
  openDb(config);
}

/** Compra até `quantity` leads (limitado pelo saldo e por `maxCredits`) e salva a lista no banco local. */
export async function buyLeads(
  config: CaptaMaisConfig,
  p: { searchId: string; quantity?: number; resultIds?: string[]; name?: string; maxCredits?: number },
): Promise<{ ok: true; listId: number; marketLeadIds: number[]; purchased: number; requested: number; creditsSpent: number; balance: number | null; note: string } | { ok: false; error: string }> {
  const ctx = recent.get(p.searchId);
  if (!ctx) return { ok: false, error: 'Busca não encontrada. Rode a busca de novo antes de gerar a lista.' };
  const ids = (p.resultIds || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 200);
  let want = ids.length || Math.min(Math.floor(p.quantity || 0), ctx.total);
  if (p.maxCredits != null && ctx.price > 0) want = Math.min(want, Math.floor(p.maxCredits / ctx.price));
  if (ids.length) ids.length = Math.min(ids.length, want);
  if (want < 1) return { ok: false, error: 'Quantidade zero: o limite de créditos informado não cobre nenhum lead.' };
  ensureTables(config);
  const conn = openDb(config);
  const purchaseId = crypto.randomUUID();
  let listId = 0, got = 0, spent = 0, balance: number | null = null, note = '';
  const marketLeadIds: number[] = [];
  while (got < want) {
    const n = Math.min(CHUNK, want - got);
    const r = await callCloud<PurchaseResult>(config, '/api/mcp/leads/purchase', ids.length ? { searchId: p.searchId, purchaseId, resultIds: ids.slice(got, got + n) } : { searchId: p.searchId, purchaseId, offset: got, quantity: n });
    if (!r.ok) { note = r.code === 'insufficient_credits' ? 'Os créditos acabaram.' : r.error; break; }
    const rows = r.data.leads || [];
    if (rows.length) {
      if (!listId) {
        const label = (p.name || '').trim().slice(0, 80) || (ctx.input.mode === 'lookup' ? `Pesquisa: ${(ctx.input.query || '').slice(0, 50)}` : `Lista ${new Date().toLocaleDateString('pt-BR')}`);
        listId = Number(conn.prepare('INSERT INTO lead_lists (name,mode,query,filters,total_found,created_at) VALUES (?,?,?,?,?,?)')
          .run(label, ctx.input.mode, ctx.input.query || null, ctx.input.filters ? JSON.stringify(ctx.input.filters) : ctx.input.field ? JSON.stringify({ field: ctx.input.field }) : null, ctx.total, new Date().toISOString()).lastInsertRowid);
      }
      const ins = conn.prepare('INSERT INTO market_leads (list_id,cnpj,razao,fantasia,email,phone,cellphone,city,uf,cnae,porte,situacao,socio,site) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const g = (o: CloudLead, ...k: string[]) => { for (const x of k) if (o[x] != null && String(o[x]).trim()) return txt(o[x]); return null; };
      conn.transaction(() => { for (const o of rows) marketLeadIds.push(Number(ins.run(listId, g(o, 'cnpj'), g(o, 'razaoSocial', 'razao', 'name'), g(o, 'nomeFantasia', 'fantasia'), g(o, 'email'), g(o, 'phone', 'telefone'), g(o, 'cellphone', 'celular'), g(o, 'city', 'cidade'), g(o, 'uf'), g(o, 'cnae'), g(o, 'porte'), g(o, 'situacao'), g(o, 'socio', 'partner'), g(o, 'site')).lastInsertRowid)); })();
      got += rows.length; spent += Number(r.data.charged) || 0;
    }
    if (r.data.balance != null) balance = Number(r.data.balance) || 0;
    if (r.data.partial || rows.length < n) break;
  }
  if (!listId) return { ok: false, error: note || 'Nenhum lead foi comprado.' };
  conn.prepare('UPDATE lead_lists SET purchased=?, credits_spent=? WHERE id=?').run(got, spent, listId);
  return { ok: true, listId, marketLeadIds, purchased: got, requested: want, creditsSpent: spent, balance, note };
}

export function leadLists(config: CaptaMaisConfig) {
  return openDb(config).prepare(
    `SELECT l.id, l.name, l.mode, l.total_found, l.purchased, l.credits_spent, l.created_at,
            (SELECT COUNT(*) FROM market_leads m WHERE m.list_id=l.id AND m.imported_lead_id IS NOT NULL) AS imported_to_crm
     FROM lead_lists l ORDER BY l.id DESC`).all();
}

/** Cria leads no CRM a partir da lista, sem duplicar e-mail/telefone. */
export function importLeadList(config: CaptaMaisConfig, listId: number) {
  const conn = openDb(config);
  const rows = conn.prepare('SELECT * FROM market_leads WHERE list_id=? AND imported_lead_id IS NULL ORDER BY id').all(listId) as Record<string, string | number | null>[];
  const emails = new Set<string>(), phones = new Set<string>();
  for (const l of conn.prepare('SELECT email, phone FROM leads').all() as { email: string | null; phone: string | null }[]) {
    if (l.email) emails.add(l.email.trim().toLowerCase());
    if (l.phone) phones.add(digits(l.phone).slice(-10));
  }
  let created = 0, skipped = 0;
  for (const r of rows) {
    const email = String(r.email || '').trim().toLowerCase();
    const phone = String(r.cellphone || r.phone || '');
    const pk = digits(phone).length >= 10 ? digits(phone).slice(-10) : '';
    const name = String(r.fantasia || r.razao || '');
    if (!name || (email && emails.has(email)) || (pk && phones.has(pk))) { skipped++; continue; }
    const description = [r.cnpj && `CNPJ: ${r.cnpj}`, r.socio && `Sócio: ${r.socio}`, r.cnae && `CNAE: ${r.cnae}`, r.situacao && `Situação: ${r.situacao}`, r.site && `Site: ${r.site}`].filter(Boolean).join('\n');
    const lead = createLead(config, {
      name, email: String(r.email || ''), phone, city: [r.city, r.uf].filter(Boolean).join('/'),
      subtitle: [r.porte, r.cnae].filter(Boolean).join(' · '), description, entityType: 'PJ',
    });
    conn.prepare('UPDATE market_leads SET imported_lead_id=? WHERE id=?').run(lead.id, r.id);
    if (email) emails.add(email); if (pk) phones.add(pk);
    created++;
  }
  return { created, skipped, total: rows.length };
}

/** Exporta a lista em CSV (abre direto no Excel) dentro de <dados>/exports. */
export function exportLeadList(config: CaptaMaisConfig, listId: number): { path: string; rows: number } | null {
  const conn = openDb(config);
  const list = conn.prepare('SELECT * FROM lead_lists WHERE id=?').get(listId) as { name: string } | undefined;
  if (!list) return null;
  const rows = conn.prepare('SELECT * FROM market_leads WHERE list_id=? ORDER BY id').all(listId) as Record<string, unknown>[];
  const head = ['CNPJ', 'Razão social', 'Nome fantasia', 'E-mail', 'Telefone', 'Celular', 'Cidade', 'UF', 'CNAE', 'Porte', 'Situação', 'Sócio', 'Site'];
  const keys = ['cnpj', 'razao', 'fantasia', 'email', 'phone', 'cellphone', 'city', 'uf', 'cnae', 'porte', 'situacao', 'socio', 'site'];
  // Texto que começa com = + - @ viraria fórmula no Excel (injeção de fórmula): prefixa com apóstrofo.
  const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['﻿' + head.join(';'), ...rows.map((r) => keys.map((k) => cell(r[k])).join(';'))];
  const dir = path.join(config.dataDir, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `captamais-${list.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'leads'}-${listId}.csv`);
  fs.writeFileSync(file, lines.join('\r\n'));
  return { path: file, rows: rows.length };
}

/** Enriquece um lead do CRM com um dado comprado: só preenche o que está vazio, nunca sobrescreve. */
export function enrichLeadFromPurchase(config: CaptaMaisConfig, marketLeadId: number, leadId: number): { filled: string[] } {
  const conn = openDb(config);
  const m = conn.prepare('SELECT * FROM market_leads WHERE id=?').get(marketLeadId) as Record<string, string | null> | undefined;
  const cur = conn.prepare('SELECT * FROM leads WHERE id=?').get(leadId) as Record<string, string | null> | undefined;
  if (!m) throw new Error('Dado comprado não encontrado.');
  if (!cur) throw new Error('Lead não encontrado.');
  const patch: Record<string, string> = {}, filled: string[] = [];
  const set = (k: string, v: string | null | undefined, label: string) => { if (v && !String(cur[k] || '').trim()) { patch[k] = v; filled.push(label); } };
  set('email', m.email, 'e-mail'); set('phone', m.cellphone || m.phone, 'telefone');
  set('city', [m.city, m.uf].filter(Boolean).join('/'), 'cidade'); set('subtitle', [m.porte, m.cnae].filter(Boolean).join(' · '), 'subtítulo');
  const lines = [m.cnpj && `CNPJ: ${m.cnpj}`, m.razao && `Razão social: ${m.razao}`, m.socio && `Sócio: ${m.socio}`, m.cnae && `CNAE: ${m.cnae}`,
    m.situacao && `Situação: ${m.situacao}`, m.site && `Site: ${m.site}`].filter((l): l is string => !!l && !String(cur.description || '').includes(l));
  if (lines.length) { patch.description = [cur.description, lines.join('\n')].filter(Boolean).join('\n\n'); filled.push('dados da empresa'); }
  const keys = Object.keys(patch);
  if (keys.length) conn.prepare(`UPDATE leads SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map((k) => patch[k]), new Date().toISOString(), leadId);
  conn.prepare('UPDATE market_leads SET imported_lead_id=? WHERE id=? AND imported_lead_id IS NULL').run(leadId, marketLeadId);
  return { filled };
}

/** Ativa um código de créditos recebido por e-mail. Sem chave configurada, guarda a chave da carteira em config.json. */
export async function redeemCreditsCode(
  config: CaptaMaisConfig,
  rawCode: string,
): Promise<{ ok: true; balance: number; expiresAt: string; keySaved: boolean; accountExists: boolean } | { ok: false; error: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{6,39}$/.test(code)) return { ok: false, error: 'Código inválido. Confira o e-mail da compra.' };
  const r = await callCloud<{ apiKey?: string | null; balance?: number; expiresAt?: string; accountExists?: boolean }>(config, '/api/mcp/credits/redeem', { code }, 'POST', true);
  if (!r.ok) return { ok: false, error: r.error };
  const key = String(r.data.apiKey || '').trim();
  let keySaved = false;
  // Nunca troca uma chave de conta que já exista.
  if (!config.apiKey && /^ctm_[a-f0-9]{48}$/.test(key)) { saveApiKey(config, key); config.apiKey = key; keySaved = true; }
  return { ok: true, balance: Number(r.data.balance) || 0, expiresAt: String(r.data.expiresAt || ''), keySaved, accountExists: r.data.accountExists === true };
}

const FIELD_LABEL: Record<string, string> = { all: 'tudo', nome: 'nome', cnpj: 'CNPJ', socio: 'sócio', email: 'e-mail', telefone: 'telefone' };

/** Relatório de gastos: cada compra de leads (pesquisa ou geração), com o que foi buscado, quantos leads e o custo. */
export function creditsSpendingReport(config: CaptaMaisConfig, limit = 50) {
  const rows = openDb(config).prepare(
    `SELECT l.id, l.name, l.mode, l.query, l.filters, l.purchased, l.credits_spent, l.created_at,
            (SELECT COUNT(*) FROM market_leads m WHERE m.list_id = l.id AND m.imported_lead_id IS NOT NULL) AS imported_to_crm
     FROM lead_lists l ORDER BY l.id DESC LIMIT ?`,
  ).all(Math.min(Math.max(Math.floor(limit) || 50, 1), 200)) as Array<{ id: number; name: string; mode: string; query: string | null; filters: string | null; purchased: number; credits_spent: number; created_at: string; imported_to_crm: number }>;
  const operations = rows.map((r) => {
    let f: Record<string, unknown> = {};
    try { f = JSON.parse(r.filters || '{}') || {}; } catch { /* ignora */ }
    const details = r.mode === 'lookup'
      ? `Pesquisa por ${FIELD_LABEL[String(f.field || 'all')] || 'tudo'}: “${r.query || ''}”`
      : Object.entries(f).map(([k, v]) => `${k}: ${v}`).join(' · ') || r.name;
    return { listId: r.id, date: r.created_at, type: r.mode === 'lookup' ? 'pesquisa' : 'geração', details, leads: r.purchased, creditsSpent: r.credits_spent, importedToCrm: r.imported_to_crm };
  });
  return {
    totals: { operations: operations.length, leads: operations.reduce((n, o) => n + o.leads, 0), creditsSpent: operations.reduce((n, o) => n + o.creditsSpent, 0) },
    operations,
  };
}
