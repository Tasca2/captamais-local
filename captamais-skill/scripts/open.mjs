/**
 * Abre o CRM local no computador da pessoa, fora do editor/assistente:
 *  - preferência: "janela de aplicativo" do Chrome/Edge/Brave (--app): sem abas nem barra de endereço,
 *    com cara de programa próprio, na janela do sistema e não numa aba embutida do Cursor/Claude;
 *  - senão: o navegador padrão do sistema.
 * Só lida com o endereço local (127.0.0.1) — nada de rede.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isFile = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };

/** Navegadores Chromium (os que sabem abrir "como aplicativo"), na ordem de preferência. */
export function chromiumCandidates() {
  const e = process.env;
  if (process.platform === 'win32') {
    const bases = [e.ProgramFiles, e['ProgramFiles(x86)'], e.LocalAppData].filter(Boolean);
    const rels = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];
    return rels.flatMap((r) => bases.map((b) => path.join(b, r)));
  }
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  const names = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chromium', 'chromium-browser'];
  const dirs = String(e.PATH || '').split(path.delimiter).filter(Boolean);
  return names.flatMap((n) => dirs.map((d) => path.join(d, n)));
}

/** Navegador padrão do sistema (sem modo aplicativo). */
function defaultPlan(url) {
  if (process.platform === 'win32') return { kind: 'default', cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  if (process.platform === 'darwin') return { kind: 'default', cmd: 'open', args: [url] };
  return { kind: 'default', cmd: 'xdg-open', args: [url] };
}

/** Decide COMO abrir (sem executar). kind: 'app' (janela de aplicativo) | 'default' (navegador padrão). */
export function planOpen(url) {
  const custom = String(process.env.CAPTAMAIS_BROWSER || '').trim();
  const exe = isFile(custom) ? custom : chromiumCandidates().find(isFile);
  if (exe) return { kind: 'app', cmd: exe, args: [`--app=${url}`, '--window-size=1440,900'] };
  return defaultPlan(url);
}

const run = (p) => new Promise((resolve) => {
  try {
    const c = spawn(p.cmd, p.args, { detached: true, stdio: 'ignore' });
    c.on('error', () => resolve(false));
    c.unref();
    setTimeout(() => resolve(true), 400); // executável inexistente dispara 'error' antes disto
  } catch { resolve(false); }
});

/** Abre o CRM. Respeita CAPTAMAIS_NO_OPEN=1. CAPTAMAIS_OPEN_DRY_RUN=1 só devolve o plano (para testes). */
export async function openApp(url) {
  if (process.env.CAPTAMAIS_NO_OPEN === '1') return { opened: false, reason: 'disabled' };
  const plan = planOpen(url);
  if (process.env.CAPTAMAIS_OPEN_DRY_RUN === '1') return { opened: false, dryRun: true, ...plan };
  if (await run(plan)) return { opened: true, ...plan };
  const def = defaultPlan(url); // o modo aplicativo falhou: tenta o navegador padrão
  if (plan.kind !== 'default' && (await run(def))) return { opened: true, ...def };
  return { opened: false, reason: 'no_browser' };
}

/** Já existe um CRM local rodando (deste mesmo usuário/pasta de dados)? Devolve o endereço dele. */
export async function findRunning(startPort, dataDir, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const port = startPort + i;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/__captamais`, { signal: AbortSignal.timeout(600) });
      const j = await r.json();
      if (j && j.app === 'captamais-crm' && path.resolve(String(j.dbDir)) === path.resolve(dataDir)) return { url: `http://127.0.0.1:${port}/`, port };
    } catch { /* porta livre ou de outro programa */ }
  }
  return null;
}
