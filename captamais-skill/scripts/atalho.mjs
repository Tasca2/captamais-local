#!/usr/bin/env node
/**
 * Cria o atalho «CaptaMais» na Área de Trabalho (Windows), com o ícone, para abrir o CRM com um duplo clique.
 *   node scripts/atalho.mjs             → cria o atalho agora
 *   node scripts/atalho.mjs --oferecer  → pergunta uma única vez (usado pelo "Abrir CaptaMais.bat")
 * Só mexe na Área de Trabalho da própria pessoa e só a pedido dela.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as db from './db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const BAT = path.join(SKILL_DIR, 'Abrir CaptaMais.bat');
const ICO = path.join(SKILL_DIR, 'assets', 'captamais.ico');

/** Cria o .lnk via PowerShell. Os caminhos vão por variáveis de ambiente (sem montar comando com texto). */
export function createShortcut(desktopDir) {
  if (process.platform !== 'win32') return { ok: false, reason: 'Atalho automático só no Windows. No Mac, arraste "Abrir CaptaMais.command" para o Dock.' };
  const ps = [
    "$ws = New-Object -ComObject WScript.Shell",
    "$dir = if ($env:CM_DESKTOP) { $env:CM_DESKTOP } else { [Environment]::GetFolderPath('Desktop') }",
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
    env: { ...process.env, CM_BAT: BAT, CM_DIR: SKILL_DIR, CM_ICO: ICO, CM_DESKTOP: desktopDir || process.env.CAPTAMAIS_DESKTOP_DIR || '' },
  });
  if (r.status !== 0) return { ok: false, reason: (r.stderr || 'falha ao criar o atalho').trim() };
  return { ok: true, path: r.stdout.trim().split(/\r?\n/).pop() };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const offer = process.argv.includes('--oferecer');
  if (offer) {
    const marker = path.join(db.dataDir(), 'atalho-oferecido');
    if (process.platform !== 'win32' || fs.existsSync(marker) || !process.stdin.isTTY || process.env.CAPTAMAIS_SKIP_SHORTCUT === '1') process.exit(0);
    fs.writeFileSync(marker, new Date().toISOString()); // pergunta só uma vez, qualquer que seja a resposta
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n Criar um atalho do CaptaMais na Área de Trabalho para abrir com um duplo clique? (S/n) ', (a) => {
      rl.close();
      if (/^n/i.test(a.trim())) return console.log(' Tudo bem. Para criar depois: node scripts/atalho.mjs');
      const r = createShortcut();
      console.log(r.ok ? ` Pronto! Atalho criado: ${r.path}` : ` Não foi possível criar o atalho: ${r.reason}`);
    });
  } else {
    const r = createShortcut();
    console.log(r.ok ? `Atalho criado: ${r.path}` : `Não foi possível criar o atalho: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }
}
