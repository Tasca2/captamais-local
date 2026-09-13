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

function firstEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
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
  const cloudUrl = (firstEnv('CAPTAMAIS_CLOUD_URL') || 'https://captamais.me').replace(/\/+$/, '');
  const apiKey = firstEnv('CAPTAMAIS_API_KEY');
  return {
    dataDir,
    dbPath: path.join(dataDir, 'captamais.db'),
    cloudUrl,
    apiKey,
  };
}
