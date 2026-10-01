import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkForUpdates, isNewerVersion } from './update-check.mjs';

test('compara versões sem aceitar valores inválidos', () => {
  assert.equal(isNewerVersion('1.0.6', '1.0.5'), true);
  assert.equal(isNewerVersion('1.0.5', '1.0.5'), false);
  assert.equal(isNewerVersion('1.0.4', '1.0.5'), false);
  assert.equal(isNewerVersion('não-é-versão', '1.0.5'), false);
});

test('consulta somente manifestos oficiais e gera prompt que preserva dados', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'captamais-update-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.5' }));
  const urls = [];
  const fakeFetch = async (url, options) => {
    urls.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ version: url.includes('skill') ? '1.0.6' : '1.0.3' }) };
  };
  const result = await checkForUpdates(root, fakeFetch);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.components.skill.update, true);
  assert.equal(result.components.mcp.update, false);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((x) => x.url.startsWith('https://raw.githubusercontent.com/Tasca2/captamais-local/main/')));
  assert.ok(urls.every((x) => x.options.redirect === 'error'));
  assert.match(result.prompt, /Preserve integralmente os bancos/);
  assert.match(result.prompt, /Não faça push nem publique sem minha autorização/);
});
