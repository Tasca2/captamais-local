#!/usr/bin/env node
/**
 * Confere se a skill está instalada onde o Claude Code a enxerga e se o comando /captamais pode aparecer.
 *   node scripts/verificar-instalacao.mjs
 * Só lê arquivos desta pasta; não altera nada.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const problemas = [];
const avisos = [];

export function lerFrontmatter(texto) {
  const t = String(texto).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const nome = (m[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const dentro = m[1].split('\n');
  const i = dentro.findIndex((l) => /^description:/.test(l));
  let descricao = '';
  if (i >= 0) {
    const resto = dentro[i].replace(/^description:\s*/, '');
    if (/^[>|][-+]?$/.test(resto.trim())) {
      for (let k = i + 1; k < dentro.length && /^\s/.test(dentro[k]); k++) descricao += `${dentro[k].trim()} `;
    } else descricao = resto;
  }
  return { nome, descricao: descricao.trim() };
}

const skillMd = path.join(SKILL_DIR, 'SKILL.md');
if (!fs.existsSync(skillMd)) {
  problemas.push('Não encontrei o SKILL.md nesta pasta.');
} else {
  const fm = lerFrontmatter(fs.readFileSync(skillMd, 'utf8'));
  if (!fm) problemas.push('O SKILL.md está sem o cabeçalho (--- ... ---) no início.');
  else {
    if (fm.nome !== 'captamais') problemas.push(`O nome da skill no SKILL.md é "${fm.nome || '(vazio)'}", e precisa ser "captamais".`);
    if (!fm.descricao) problemas.push('O SKILL.md está sem descrição.');
    if (fm.descricao.length > 1024) problemas.push(`A descrição tem ${fm.descricao.length} caracteres (o limite é 1024).`);
  }
}

// A pasta precisa se chamar "captamais" e estar diretamente dentro de ".../.claude/skills".
const pasta = path.basename(SKILL_DIR);
const pai = path.basename(path.dirname(SKILL_DIR));
const avo = path.basename(path.dirname(path.dirname(SKILL_DIR)));
if (pasta !== 'captamais') problemas.push(`A pasta da skill se chama "${pasta}", e precisa se chamar "captamais".`);
if (pai !== 'skills' || avo !== '.claude') {
  avisos.push(`A skill está em ${SKILL_DIR}. Para o Claude Code enxergar o /captamais, ela precisa estar em ${path.join(os.homedir(), '.claude', 'skills', 'captamais')}.`);
}
// Cópia aninhada (captamais/captamais-skill/...): erro clássico de "copiar a pasta para dentro da pasta".
if (fs.existsSync(path.join(SKILL_DIR, 'captamais-skill', 'SKILL.md'))) {
  problemas.push('Existe uma pasta "captamais-skill" dentro desta: a cópia ficou aninhada. Mova o conteúdo de "captamais-skill" para esta pasta.');
}
if (!fs.existsSync(path.join(SKILL_DIR, 'node_modules', 'better-sqlite3'))) avisos.push('As dependências ainda não foram instaladas (abra o ícone CaptaMais uma vez).');

const ok = problemas.length === 0;
console.log(JSON.stringify({ ok, pasta: SKILL_DIR, problemas, avisos, dica: ok ? 'Feche e abra o Claude Code: o /captamais aparece em sessão nova.' : undefined }, null, 2));
process.exit(ok ? 0 : 1);
