import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export type CaptaMaisConfig = {
  /** Pasta onde fica o banco local (dados privados do usuário, na máquina dele). */
  dataDir: string;
  /** Caminho do banco local. */
  dbPath: string;
  /** URL da nuvem CaptaMais (para ações de IA + medição). */
  cloudUrl: string;
  /** Chave de API do usuário (emitida no CaptaMais). Sem ela, ações de IA ficam indisponíveis. */
  apiKey: string;
};

/**
 * A chave MCP nunca deve ser enviada para um host arbitrário. Em produção aceitamos
 * somente o domínio oficial; HTTP fica restrito ao loopback para testes locais.
 */
export function normalizeCloudUrl(raw: string): string {
  const value = String(raw || '').trim() || 'https://captamais.me';
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('CAPTAMAIS_CLOUD_URL inválida.'); }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  const official = url.protocol === 'https:' && (url.hostname === 'captamais.me' || url.hostname.endsWith('.captamais.me'));
  if (!official && !(local && (url.protocol === 'http:' || url.protocol === 'https:'))) {
    throw new Error('CAPTAMAIS_CLOUD_URL deve usar HTTPS no domínio captamais.me (HTTP só é permitido em localhost).');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function firstEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** Perfil local ativo gravado pelo CRM (config.json): cada conta vinculada tem o seu próprio banco em profiles/<conta>/. */
function readSavedProfile(dataDir: string): { profile: string; key: string } {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as { activeProfile?: unknown; apiKey?: unknown };
    const p = String(j?.activeProfile || '').trim();
    return { profile: /^acct_[a-f0-9]{24}$/.test(p) ? p : '', key: String(j?.apiKey || '').trim() };
  } catch {
    return { profile: '', key: '' };
  }
}

/** Chave salva pelo CRM (config.json na pasta de dados), usada quando não há variável de ambiente. */
function readSavedKey(dataDir: string): string {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')) as { apiKey?: unknown };
    return String(j?.apiKey || '').trim();
  } catch {
    return '';
  }
}

/** Grava a chave (de carteira) no config.json da pasta de dados, sem apagar o resto. Só o dono do computador lê. */
export function saveApiKey(config: CaptaMaisConfig, key: string): void {
  const file = path.join(config.dataDir, 'config.json');
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* arquivo novo */ }
  fs.writeFileSync(file, JSON.stringify({ ...cur, apiKey: key }, null, 2), { mode: 0o600 });
}

/** Resolve a configuração a partir de variáveis de ambiente (definidas no cliente MCP). */
export function loadConfig(): CaptaMaisConfig {
  const dataDir =
    firstEnv('CAPTAMAIS_DATA_DIR') || path.join(os.homedir(), '.captamais');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* segue; erro aparece ao abrir o banco */
  }
  const cloudUrl = normalizeCloudUrl(firstEnv('CAPTAMAIS_CLOUD_URL') || 'https://captamais.me');
  const envKey = firstEnv('CAPTAMAIS_API_KEY');
  const saved = readSavedProfile(dataDir);
  const apiKey = envKey || saved.key;
  // O CRM guarda os leads de cada conta vinculada em profiles/<conta>/. O MCP acompanha o mesmo banco, desde que use
  // a mesma chave que o CRM (assim os dois enxergam os mesmos leads e nunca se misturam contas diferentes).
  const useProfile = !!saved.profile && (!envKey || envKey === saved.key);
  const dbDir = useProfile ? path.join(dataDir, 'profiles', saved.profile) : dataDir;
  if (useProfile) {
    try { fs.mkdirSync(dbDir, { recursive: true }); } catch { /* erro aparece ao abrir o banco */ }
  }
  return {
    dataDir,
    dbPath: path.join(dbDir, 'captamais.db'),
    cloudUrl,
    apiKey,
  };
}
