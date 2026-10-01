import fs from 'node:fs';
import path from 'node:path';

export const OFFICIAL_REPOSITORY = 'https://github.com/Tasca2/captamais-local';
const RAW_ROOT = 'https://raw.githubusercontent.com/Tasca2/captamais-local/main';
const REMOTE_PACKAGES = {
  skill: `${RAW_ROOT}/captamais-skill/package.json`,
  mcp: `${RAW_ROOT}/captamais-mcp/package.json`,
};

const versionParts = (value) => {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
};

export function isNewerVersion(remote, local) {
  const a = versionParts(remote); const b = versionParts(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function packageVersion(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))?.version;
    return versionParts(value) ? String(value) : null;
  } catch { return null; }
}

export function localVersions(skillRoot) {
  const parent = path.dirname(skillRoot);
  return {
    skill: packageVersion(path.join(skillRoot, 'package.json')),
    mcp: packageVersion(path.join(parent, 'captamais-mcp', 'package.json')),
  };
}

async function remoteVersion(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'CaptaMais-Update-Checker' },
    });
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`);
    const text = await response.text();
    if (text.length > 32768) throw new Error('Manifesto de versão maior que o esperado.');
    const value = JSON.parse(text)?.version;
    if (!versionParts(value)) throw new Error('Versão publicada inválida.');
    return String(value);
  } finally { clearTimeout(timeout); }
}

export function updatePrompt({ local, remote, skillRoot }) {
  const mcpLine = local.mcp
    ? `- MCP: ${local.mcp} → ${remote.mcp || 'indisponível'}`
    : `- MCP: não localizado ao lado da skill; verifique se está instalado antes de alterar.`;
  return `Atualize minha instalação local oficial do CaptaMais usando somente o repositório ${OFFICIAL_REPOSITORY}.

Instalação da skill: ${skillRoot}
Versões detectadas:
- Skill: ${local.skill || 'desconhecida'} → ${remote.skill || 'indisponível'}
${mcpLine}

Antes de alterar, confira o repositório e compare as versões. Atualize apenas os arquivos versionados de captamais-skill e, se existir nesta instalação, captamais-mcp. Preserve integralmente os bancos, backups e configurações do usuário em ~/.captamais (ou CAPTAMAIS_DATA_DIR). Não copie nem publique arquivos .env, bancos SQLite, chaves, Docker ou dados do usuário. Instale somente as dependências declaradas, execute os testes locais e as auditorias npm, confirme que não há vulnerabilidades conhecidas e informe quais versões ficaram instaladas. Não faça push nem publique sem minha autorização.`;
}

export async function checkForUpdates(skillRoot, fetchImpl = fetch) {
  const local = localVersions(skillRoot);
  const remote = { skill: null, mcp: null };
  const errors = [];
  await Promise.all(Object.entries(REMOTE_PACKAGES).map(async ([name, url]) => {
    try { remote[name] = await remoteVersion(url, fetchImpl); }
    catch (error) { errors.push(`${name}: ${String(error?.message || error)}`); }
  }));
  const components = {
    skill: { installed: local.skill, available: remote.skill, update: isNewerVersion(remote.skill, local.skill) },
    mcp: { installed: local.mcp, available: remote.mcp, update: !!local.mcp && isNewerVersion(remote.mcp, local.mcp) },
  };
  return {
    ok: !!remote.skill || !!remote.mcp,
    repository: OFFICIAL_REPOSITORY,
    updateAvailable: components.skill.update || components.mcp.update,
    components,
    errors,
    prompt: updatePrompt({ local, remote, skillRoot }),
  };
}
