# CaptaMais local — Skill e MCP

CRM de prospecção **na sua máquina**. Este repositório junta os dois conectores:

| Pasta | Para quê |
|---|---|
| [`captamais-skill/`](captamais-skill/) | Skill do Claude (`/captamais`) — funil, leads, agenda, Meet |
| [`captamais-mcp/`](captamais-mcp/) | Servidor MCP — Cursor, Claude Desktop e outros clientes |

Os dados dos leads ficam no seu computador. Ações de IA (opcional) passam pela nuvem CaptaMais.

## Instalar a skill (Claude)

```bash
git clone https://github.com/Tasca2/captamais-local.git
cp -R captamais-local/captamais-skill ~/.claude/skills/captamais
cd ~/.claude/skills/captamais
npm install
```

No Windows (PowerShell):

```powershell
git clone https://github.com/Tasca2/captamais-local.git
Copy-Item -Recurse captamais-local\captamais-skill "$env:USERPROFILE\.claude\skills\captamais"
cd $env:USERPROFILE\.claude\skills\captamais
npm install
```

## Instalar o MCP (Cursor, Claude Desktop, etc.)

```bash
git clone https://github.com/Tasca2/captamais-local.git
cd captamais-local/captamais-mcp
npm install
npm run build
```

Depois aponte o cliente MCP para `dist/index.js`. A chave fica em **Minha Conta → Conector** no CaptaMais (`CAPTAMAIS_API_KEY`).

Instruções completas: [skill](captamais-skill/README.md) e [MCP](captamais-mcp/README.md).
