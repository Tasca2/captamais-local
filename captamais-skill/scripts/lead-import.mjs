import { readSheet } from 'read-excel-file/node';

const MAX_ROWS = 10000;
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

const FIELD_LABELS = {
  name: 'Nome', phone: 'Telefone', email: 'E-mail', city: 'Cidade', cnpj: 'CNPJ',
  description: 'Detalhes', subtitle: 'Empresa/cargo', stage: 'Etapa', entity_type: 'Tipo',
};

const ALIASES = {
  name: ['nome', 'name', 'full name', 'nome completo', 'nome do contato', 'nome contato', 'cliente', 'lead', 'contato principal', 'responsavel', 'responsável'],
  phone: ['telefone', 'phone', 'telefone principal', 'telefone 1', 'celular', 'celular principal', 'whatsapp', 'whats app', 'fone', 'tel', 'mobile'],
  email: ['email', 'e mail', 'email principal', 'correio eletronico', 'correio eletrônico', 'mail'],
  city: ['cidade', 'city', 'municipio', 'município', 'localidade', 'cidade municipio', 'cidade município'],
  cnpj: ['cnpj', 'cnpj empresa', 'cadastro nacional pessoa juridica', 'cadastro nacional da pessoa juridica'],
  description: ['detalhes', 'description', 'descricao', 'descrição', 'notes', 'anotacoes', 'anotações', 'observacoes', 'observações', 'notas', 'comments', 'comentarios', 'comentários', 'historico', 'histórico'],
  subtitle: ['empresa', 'company', 'companhia', 'organizacao', 'organização', 'cargo', 'job title', 'ocupacao', 'ocupação', 'razao social', 'razão social', 'nome fantasia'],
  stage: ['etapa', 'stage', 'fase', 'funil', 'coluna', 'status do lead'],
  entity_type: ['tipo', 'entity type', 'tipo pessoa', 'pf pj', 'pessoa fisica juridica', 'pessoa física jurídica'],
};

const text = (v) => String(v ?? '').trim();
const folded = (v) => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_./\\|()-]+/g, ' ').replace(/\s+/g, ' ').trim();
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(v).toLowerCase());
const phoneDigits = (v) => text(v).replace(/\D/g, '');
const phoneOk = (v) => phoneDigits(v).length >= 8 && phoneDigits(v).length <= 15;

function aliasField(header) {
  const h = folded(header);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => folded(a) === h)) return field;
  }
  if (/^(telefone|celular|whatsapp|fone|tel)\b/.test(h)) return 'phone';
  if (/^e ?mail\b/.test(h)) return 'email';
  if (/^(nome)( do)? (cliente|lead|contato|responsavel)/.test(h)) return 'name';
  if (/^(cidade|municipio)\b/.test(h)) return 'city';
  if (/^(detalhe|descricao|anotacao|observacao|nota|comentario)/.test(h)) return 'description';
  return null;
}

function parseWithDelimiter(source, delimiter) {
  const s = String(source || '').replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; if (rows.length > MAX_ROWS + 20) break; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => text(c)));
}

export function parseDelimited(source) {
  const candidates = [',', ';', '\t', '|'].map((delimiter) => {
    const rows = parseWithDelimiter(source, delimiter);
    const widths = rows.slice(0, 20).map((r) => r.length).filter((n) => n > 1);
    const mode = widths.sort((a, b) => widths.filter((n) => n === a).length - widths.filter((n) => n === b).length).at(-1) || 1;
    const consistent = widths.filter((n) => n === mode).length;
    return { delimiter, rows, score: mode * 10 + consistent };
  });
  return candidates.sort((a, b) => b.score - a.score)[0].rows;
}

export async function rowsFromXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMPORT_BYTES) throw new Error('A planilha deve ter no máximo 4 MB.');
  const rows = await readSheet(buffer);
  return rows.slice(0, MAX_ROWS + 20).map((row) => row.map((cell) => cell instanceof Date ? cell.toISOString() : text(cell)));
}

function inferField(values, used) {
  const nonempty = values.map(text).filter(Boolean).slice(0, 30);
  if (!nonempty.length) return null;
  const ratio = (fn) => nonempty.filter(fn).length / nonempty.length;
  if (!used.has('email') && ratio(emailOk) >= 0.65) return 'email';
  if (!used.has('phone') && ratio(phoneOk) >= 0.65) return 'phone';
  return null;
}

export function previewLeadRows(inputRows) {
  const rows = (Array.isArray(inputRows) ? inputRows : []).slice(0, MAX_ROWS + 20).filter((r) => Array.isArray(r) && r.some((c) => text(c)));
  if (!rows.length) return { rows: [], headerRow: -1, headers: [], mapping: [], samples: [], warnings: ['Arquivo vazio.'] };
  let headerRow = 0; let best = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const recognized = rows[i].map(aliasField).filter(Boolean);
    const score = new Set(recognized).size * 10 + recognized.length;
    if (score > best) { best = score; headerRow = i; }
  }
  const hasHeader = best >= 10;
  const width = Math.max(...rows.slice(hasHeader ? headerRow : 0, (hasHeader ? headerRow : 0) + 30).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => hasHeader ? text(rows[headerRow][i]) || `Coluna ${i + 1}` : `Coluna ${i + 1}`);
  const dataRows = rows.slice(hasHeader ? headerRow + 1 : 0, (hasHeader ? headerRow + 1 : 0) + MAX_ROWS);
  const used = new Set();
  const mapping = headers.map((header, index) => {
    let field = aliasField(header);
    if (field && used.has(field) && field !== 'description') field = null;
    if (!field) field = inferField(dataRows.map((r) => r[index]), used);
    if (field) used.add(field);
    return { index, header, field, label: field ? FIELD_LABELS[field] : 'Detalhes adicionais', detected: !!field };
  });
  // Sem cabeçalho, a primeira coluna textual vira nome como último recurso seguro.
  if (!used.has('name')) {
    const candidate = mapping.find((m) => {
      const vals = dataRows.map((r) => text(r[m.index])).filter(Boolean).slice(0, 20);
      return vals.length && vals.filter((v) => !emailOk(v) && !phoneOk(v) && /[a-zÀ-ÿ]/i.test(v)).length / vals.length >= 0.7;
    });
    if (candidate) { candidate.field = 'name'; candidate.label = FIELD_LABELS.name; candidate.detected = true; used.add('name'); }
  }
  const warnings = [];
  if (!used.has('name')) warnings.push('Não foi possível identificar a coluna de nome.');
  if (!hasHeader) warnings.push('Cabeçalho não reconhecido; o mapeamento foi inferido pelos valores.');
  return { rows: dataRows, headerRow: hasHeader ? headerRow : -1, headers, mapping, samples: dataRows.slice(0, 3), warnings };
}

export function normalizeLeadRows(inputRows) {
  const preview = previewLeadRows(inputRows);
  const records = []; const skipped = []; const seen = new Set();
  let invalidEmails = 0; let invalidPhones = 0;
  for (let rowIndex = 0; rowIndex < preview.rows.length; rowIndex++) {
    const row = preview.rows[rowIndex]; const lead = {}; const extras = [];
    for (const map of preview.mapping) {
      const value = text(row[map.index]); if (!value) continue;
      if (!map.field) extras.push(`${map.header}: ${value}`);
      else if (map.field === 'description' && lead.description) lead.description += `\n${value}`;
      else lead[map.field] = value;
    }
    lead.name = text(lead.name || lead.subtitle);
    if (!lead.name) { skipped.push({ row: rowIndex + 1, reason: 'sem nome' }); continue; }
    if (lead.cnpj && !lead.entity_type) lead.entity_type = 'PJ';
    if (lead.email && emailOk(lead.email)) lead.email = text(lead.email).toLowerCase();
    else if (lead.email) { extras.push(`E-mail inválido: ${lead.email}`); lead.email = ''; invalidEmails++; }
    if (lead.phone && phoneOk(lead.phone)) lead.phone = text(lead.phone);
    else if (lead.phone) { extras.push(`Telefone inválido: ${lead.phone}`); lead.phone = ''; invalidPhones++; }
    if (extras.length) lead.description = [text(lead.description), ...extras].filter(Boolean).join('\n');
    const duplicateKey = lead.email ? `e:${lead.email}` : lead.phone ? `p:${phoneDigits(lead.phone)}` : `n:${folded(lead.name)}|${folded(lead.city)}`;
    if (seen.has(duplicateKey)) { skipped.push({ row: rowIndex + 1, reason: 'duplicado no arquivo' }); continue; }
    seen.add(duplicateKey); records.push(lead);
  }
  if (invalidEmails) preview.warnings.push(`${invalidEmails} e-mail(s) inválido(s) foram preservados em Detalhes.`);
  if (invalidPhones) preview.warnings.push(`${invalidPhones} telefone(s) inválido(s) foram preservados em Detalhes.`);
  return { ...preview, records, skipped };
}

export function mappingSummary(mapping) {
  return mapping.filter((m) => m.field).map((m) => `${m.header} → ${m.label}`);
}
