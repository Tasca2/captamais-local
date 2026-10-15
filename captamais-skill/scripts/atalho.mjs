#!/usr/bin/env node
/**
 * Cria o atalho «CaptaMais» (com o ícone) para abrir o CRM sem terminal nem pasta:
 *   Windows: Área de Trabalho + Menu Iniciar (aparece ao digitar «CaptaMais» na busca do Windows).
 *   Mac/Linux: atalho «CaptaMais» na Área de Trabalho.
 *   node scripts/atalho.mjs             → cria o atalho agora
 *   node scripts/atalho.mjs --instalar  → cria sem perguntar (usado quando o Claude instala a skill)
 *   node scripts/atalho.mjs --oferecer  → pergunta uma única vez (usado pelo duplo clique)
 * Só mexe na Área de Trabalho e no Menu Iniciar da própria pessoa, e só com o que o app instala.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as db from './db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const BAT = path.join(SKILL_DIR, 'Abrir CaptaMais.bat');
const COMMAND = path.join(SKILL_DIR, 'Abrir CaptaMais.command');
const ICO = path.join(SKILL_DIR, 'assets', 'captamais.ico');

/** Cria o .lnk via PowerShell. Os caminhos vão por variáveis de ambiente (sem montar comando com texto). */
function createWindowsShortcut(folderKind, overrideDir) {
  const ps = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$dir = if ($env:CM_DIR_OUT) { $env:CM_DIR_OUT } else { [Environment]::GetFolderPath('${folderKind}') }`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    "$s = $ws.CreateShortcut((Join-Path $dir 'CaptaMais.lnk'))",
    "$s.TargetPath = $env:CM_BAT",
    "$s.WorkingDirectory = $env:CM_DIR",
    "$s.IconLocation = $env:CM_ICO",
    "$s.WindowStyle = 7",
    "$s.Description = 'CaptaMais - seu CRM local'",
    "$s.Save()",
    "Write-Output (Join-Path $dir 'CaptaMais.lnk')",
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    env: { ...process.env, CM_BAT: BAT, CM_DIR: SKILL_DIR, CM_ICO: ICO, CM_DIR_OUT: overrideDir || '' },
  });
  if (r.status !== 0) return { ok: false, reason: (r.stderr || 'falha ao criar o atalho').trim() };
  return { ok: true, path: r.stdout.trim().split(/\r?\n/).pop() };
}

/**
 * Cria os atalhos. `desktopDir`/`startMenuDir` só existem para teste (ou para a variável de ambiente
 * CAPTAMAIS_DESKTOP_DIR / CAPTAMAIS_STARTMENU_DIR).
 */
export function createShortcut(desktopDir, startMenuDir) {
  const desktop = desktopDir || process.env.CAPTAMAIS_DESKTOP_DIR || '';
  if (process.platform === 'win32') {
    const made = [];
    const d = createWindowsShortcut('Desktop', desktop);
    if (d.ok) made.push(d.path);
    const m = createWindowsShortcut('Programs', startMenuDir || process.env.CAPTAMAIS_STARTMENU_DIR || '');
    if (m.ok) made.push(m.path);
    if (!made.length) return { ok: false, reason: d.reason || m.reason };
    return { ok: true, path: made[0], all: made };
  }
  // Mac/Linux: atalho simples (link) na Área de Trabalho apontando para o script de abertura.
  try {
    const dir = desktop || path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(dir)) return { ok: false, reason: 'Não encontrei a Área de Trabalho.' };
    const link = path.join(dir, 'CaptaMais.command');
    try { fs.rmSync(link, { force: true }); } catch { /* ainda não existia */ }
    fs.symlinkSync(COMMAND, link);
    try { fs.chmodSync(COMMAND, 0o755); } catch { /* já executável */ }
    return { ok: true, path: link, all: [link] };
  } catch (e) {
    return { ok: false, reason: e?.message || 'falha ao criar o atalho' };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const offer = process.argv.includes('--oferecer');
  const install = process.argv.includes('--instalar');
  if (install) {
    // Instalação pelo Claude: cria sem perguntar (a pessoa pediu para instalar), uma vez só.
    const marker = path.join(db.dataDir(), 'atalho-oferecido');
    if (process.env.CAPTAMAIS_SKIP_SHORTCUT === '1') process.exit(0);
    const r = createShortcut();
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* sem marcador: só pergunta de novo no duplo clique */ }
    console.log(r.ok ? `Atalho criado: ${(r.all || [r.path]).join(' | ')}` : `Não foi possível criar o atalho: ${r.reason}`);
    process.exit(0);
  }
  if (offer) {
    const marker = path.join(db.dataDir(), 'atalho-oferecido');
    if (fs.existsSync(marker) || !process.stdin.isTTY || process.env.CAPTAMAIS_SKIP_SHORTCUT === '1') process.exit(0);
    fs.writeFileSync(marker, new Date().toISOString()); // pergunta só uma vez, qualquer que seja a resposta
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n Criar um atalho do CaptaMais na Área de Trabalho (e no Menu Iniciar) para abrir com um clique? (S/n) ', (a) => {
      rl.close();
      if (/^n/i.test(a.trim())) return console.log(' Tudo bem. Para criar depois: node scripts/atalho.mjs');
      const r = createShortcut();
      console.log(r.ok ? ' Pronto! Agora é só abrir o ícone CaptaMais.' : ` Não foi possível criar o atalho: ${r.reason}`);
    });
  } else {
    const r = createShortcut();
    console.log(r.ok ? `Atalho criado: ${(r.all || [r.path]).join(' | ')}` : `Não foi possível criar o atalho: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }
}
