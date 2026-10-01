import fs from 'node:fs';
import path from 'node:path';
import { readSheet } from 'read-excel-file/node';
import type { CaptaMaisConfig } from './config.js';
import { createLead, openDb } from './db.js';

type Field = 'name' | 'phone' | 'email' | 'city' | 'description' | 'subtitle' | 'stage' | 'entity_type';
type ImportedLead = Partial<Record<Field, string>> & { name: string };
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 10000;
const LABEL: Record<Field, string> = { name: 'Nome', phone: 'Telefone', email: 'E-mail', city: 'Cidade', description: 'Detalhes', subtitle: 'Empresa/cargo', stage: 'Etapa', entity_type: 'Tipo' };
const ALIASES: Record<Field, string[]> = {
  name: ['nome','name','full name','nome completo','nome do contato','cliente','lead','contato principal','responsavel'],
  phone: ['telefone','phone','telefone principal','telefone 1','celular','celular principal','whatsapp','whats app','fone','tel','mobile'],
  email: ['email','e mail','email principal','correio eletronico','mail'],
  city: ['cidade','city','municipio','localidade','cidade municipio'],
  description: ['detalhes','description','descricao','notes','anotacoes','observacoes','notas','comments','comentarios','historico'],
  subtitle: ['empresa','company','companhia','organizacao','cargo','job title','ocupacao','razao social','nome fantasia'],
  stage: ['etapa','stage','fase','funil','coluna','status do lead'],
  entity_type: ['tipo','entity type','tipo pessoa','pf pj','pessoa fisica juridica'],
};
const txt = (v: unknown) => String(v ?? '').trim();
const fold = (v: unknown) => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_./\\|()-]+/g,' ').replace(/\s+/g,' ').trim();
const emailOk = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(v).toLowerCase());
const digits = (v: unknown) => txt(v).replace(/\D/g,'');
const phoneOk = (v: unknown) => digits(v).length >= 8 && digits(v).length <= 15;

function fieldFor(header: unknown): Field | null {
  const h=fold(header);
  for(const [field,aliases] of Object.entries(ALIASES) as [Field,string[]][]) if(aliases.some((a)=>fold(a)===h)) return field;
  if(/^(telefone|celular|whatsapp|fone|tel)\b/.test(h)) return 'phone';
  if(/^e ?mail\b/.test(h)) return 'email';
  if(/^(nome)( do)? (cliente|lead|contato|responsavel)/.test(h)) return 'name';
  if(/^(cidade|municipio)\b/.test(h)) return 'city';
  if(/^(detalhe|descricao|anotacao|observacao|nota|comentario)/.test(h)) return 'description';
  return null;
}

export function parseDelimited(source:string): string[][] {
  const parse=(delimiter:string)=>{const s=source.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',q=false;for(let i=0;i<s.length;i++){const ch=s[i];if(q){if(ch==='"'){if(s[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}else if(ch==='"')q=true;else if(ch===delimiter){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';if(rows.length>MAX_ROWS+20)break;}else if(ch!=='\r')cell+=ch;}if(cell||row.length){row.push(cell);rows.push(row);}return rows.filter((r)=>r.some((c)=>txt(c)));};
  return [',',';','\t','|'].map((d)=>{const rows=parse(d);const widths=rows.slice(0,20).map((r)=>r.length).filter((n)=>n>1);const mode=widths.sort((a,b)=>widths.filter((n)=>n===a).length-widths.filter((n)=>n===b).length).at(-1)||1;return{rows,score:mode*10+widths.filter((n)=>n===mode).length};}).sort((a,b)=>b.score-a.score)[0].rows;
}

function normalize(rows: unknown[][]) {
  const cleanRows=rows.slice(0,MAX_ROWS+20).filter((r)=>Array.isArray(r)&&r.some((c)=>txt(c)));
  let headerRow=0,best=-1;for(let i=0;i<Math.min(cleanRows.length,12);i++){const hits=cleanRows[i].map(fieldFor).filter(Boolean);const score=new Set(hits).size*10+hits.length;if(score>best){best=score;headerRow=i;}}
  const hasHeader=best>=10;const width=Math.max(0,...cleanRows.slice(hasHeader?headerRow:0,(hasHeader?headerRow:0)+30).map((r)=>r.length));
  const headers=Array.from({length:width},(_,i)=>hasHeader?txt(cleanRows[headerRow][i])||`Coluna ${i+1}`:`Coluna ${i+1}`);const data=cleanRows.slice(hasHeader?headerRow+1:0);const used=new Set<Field>();
  const mapping=headers.map((header,index)=>{let field=fieldFor(header);if(field&&used.has(field)&&field!=='description')field=null;const values=data.map((r)=>r[index]).filter((v)=>txt(v)).slice(0,30);if(!field&&values.length){if(!used.has('email')&&values.filter(emailOk).length/values.length>=.65)field='email';else if(!used.has('phone')&&values.filter(phoneOk).length/values.length>=.65)field='phone';}if(field)used.add(field);return{index,header,field};});
  if(!used.has('name')){const candidate=mapping.find((m)=>{const values=data.map((r)=>txt(r[m.index])).filter(Boolean).slice(0,20);return values.length&&values.filter((v)=>!emailOk(v)&&!phoneOk(v)&&/[a-zÀ-ÿ]/i.test(v)).length/values.length>=.7;});if(candidate){candidate.field='name';used.add('name');}}
  const leads:ImportedLead[]=[];const seen=new Set<string>();let skipped=0,invalidEmails=0,invalidPhones=0;
  for(const row of data){const lead:Record<string,string>={};const extras:string[]=[];for(const m of mapping){const value=txt(row[m.index]);if(!value)continue;if(!m.field)extras.push(`${m.header}: ${value}`);else if(m.field==='description'&&lead.description)lead.description+=`\n${value}`;else lead[m.field]=value;}lead.name=txt(lead.name||lead.subtitle);if(!lead.name){skipped++;continue;}if(lead.email&&emailOk(lead.email))lead.email=lead.email.toLowerCase();else if(lead.email){extras.push(`E-mail inválido: ${lead.email}`);lead.email='';invalidEmails++;}if(lead.phone&&phoneOk(lead.phone))lead.phone=txt(lead.phone);else if(lead.phone){extras.push(`Telefone inválido: ${lead.phone}`);lead.phone='';invalidPhones++;}if(extras.length)lead.description=[lead.description,...extras].filter(Boolean).join('\n');const key=lead.email?`e:${lead.email}`:lead.phone?`p:${digits(lead.phone)}`:`n:${fold(lead.name)}|${fold(lead.city)}`;if(seen.has(key)){skipped++;continue;}seen.add(key);leads.push(lead as ImportedLead);}
  const warnings=used.has('name')?[]:['Não foi possível identificar a coluna de nome.'];if(invalidEmails)warnings.push(`${invalidEmails} e-mail(s) inválido(s) foram preservados em Detalhes.`);if(invalidPhones)warnings.push(`${invalidPhones} telefone(s) inválido(s) foram preservados em Detalhes.`);
  return { leads, skipped, total:data.length, mapping:mapping.filter((m)=>m.field).map((m)=>`${m.header} → ${LABEL[m.field as Field]}`), warnings };
}

export async function readLeadFile(filePath:string) {
  const resolved=path.resolve(filePath);const stat=fs.statSync(resolved);if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error('A planilha deve ser um arquivo de até 4 MB.');const ext=path.extname(resolved).toLowerCase();
  if(ext==='.xlsx') return normalize((await readSheet(resolved)) as unknown[][]);
  if(ext==='.csv'||ext==='.tsv'||ext==='.txt') return normalize(parseDelimited(fs.readFileSync(resolved,'utf8')));
  if(ext==='.json'){const value=JSON.parse(fs.readFileSync(resolved,'utf8'));const rawList:unknown[]=Array.isArray(value)?value:Array.isArray(value?.leads)?value.leads:[];const list=rawList.filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x));const headers:string[]=Array.from(new Set<string>(list.flatMap((x)=>Object.keys(x))));return normalize([headers,...list.map((x)=>headers.map((h)=>x[h]))]);}
  throw new Error('Formato aceito: .xlsx, .csv, .tsv, .txt ou .json.');
}

export function importLeadFile(config:CaptaMaisConfig, parsed:Awaited<ReturnType<typeof readLeadFile>>) {
  const conn=openDb(config);const existing=conn.prepare('SELECT email,phone FROM leads').all() as {email:string|null;phone:string|null}[];const emails=new Set(existing.map((r)=>txt(r.email).toLowerCase()).filter(Boolean));const phones=new Set(existing.map((r)=>digits(r.phone)).filter((v)=>v.length>=8));let imported=0,duplicates=0;
  for(const lead of parsed.leads){const email=txt(lead.email).toLowerCase(),phone=digits(lead.phone);if((email&&emails.has(email))||(phone.length>=8&&phones.has(phone))){duplicates++;continue;}createLead(config,{...lead,entityType:lead.entity_type});imported++;if(email)emails.add(email);if(phone.length>=8)phones.add(phone);}
  return { imported, duplicates, skipped:parsed.skipped, total:parsed.total, mapping:parsed.mapping, warnings:parsed.warnings };
}
