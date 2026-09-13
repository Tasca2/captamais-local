# CaptaMais MCP — seu CRM na sua máquina

Rode o **CaptaMais como um CRM local**, direto no seu computador, e opere pelo seu
assistente de IA (Cursor, Claude Desktop, etc.) via **MCP**.

- 🔒 **Seus dados ficam no seu PC** (banco local). Cadastrar lead, mover no funil, anotar → **local e de graça**.
- 🧠 **Ações de IA** (ex.: preparar reunião) passam pela nuvem CaptaMais e **consomem tokens** (medido na sua conta).
- 🔗 Funciona em **qualquer cliente com MCP**.

> **MVP (Fase 1).** Hoje traz: listar/criar lead, mover etapa e preparar reunião (IA). Mais ferramentas e o display completo vêm nas próximas fases.

## Instalação (via GitHub)

Pré-requisito: **Node.js 18+** instalado.

```bash
git clone https://github.com/Tasca2/captamais-local.git
cd captamais-local/captamais-mcp
npm install
npm run build
```

## Configuração no cliente de IA

Pegue sua **chave de API** no CaptaMais em **Minha Conta → Conector MCP** (`CAPTAMAIS_API_KEY`).

### Claude Desktop
Edite `claude_desktop_config.json` e adicione:

```json
{
  "mcpServers": {
    "captamais": {
      "command": "node",
      "args": ["CAMINHO/ATE/captamais-mcp/dist/index.js"],
      "env": {
        "CAPTAMAIS_API_KEY": "cole-sua-chave-aqui",
        "CAPTAMAIS_CLOUD_URL": "https://captamais.me"
      }
    }
  }
}
```

### Cursor (ou outro cliente MCP)
Aponte o servidor para `node CAMINHO/ATE/captamais-mcp/dist/index.js` com as mesmas variáveis de ambiente.

## Variáveis de ambiente

| Variável | Para que serve | Padrão |
|---|---|---|
| `CAPTAMAIS_API_KEY` | Autentica as ações de IA e mede o uso na sua conta. Sem ela, só o CRM local funciona. | — |
| `CAPTAMAIS_CLOUD_URL` | URL da nuvem CaptaMais. | `https://captamais.me` |
| `CAPTAMAIS_DATA_DIR` | Onde fica seu banco local. | `~/.captamais` |

## Ferramentas disponíveis

| Ferramenta | O que faz | Gasta token? |
|---|---|---|
| `captamais_list_leads` | Lista leads (filtra por etapa/busca) | Não (local) |
| `captamais_create_lead` | Cria um lead | Não (local) |
| `captamais_move_stage` | Move o lead de etapa | Não (local) |
| `captamais_prepare_meeting` | IA prepara uma reunião a partir do lead | **Sim** (nuvem) |

## Como usar

Peça ao seu assistente, por exemplo:
- "Cria um lead: João Silva, joão@email.com, etapa MEETING."
- "Lista meus leads na etapa MEETING."
- "Prepara a reunião com o lead 3." *(usa IA — consome tokens)*

## Privacidade e termos

O banco local (`~/.captamais/captamais.db`) fica **só no seu computador**. Só as ações de IA saem
da sua máquina, autenticadas na sua conta.

- [Termos de uso](https://captamais.me/termos)
- [Política de privacidade (LGPD)](https://captamais.me/privacidade)
- [DPA](https://captamais.me/dpa)

**Copyright © 2026 Henrique Tasca Tedesco.** Licença do repositório: [LICENSE](../LICENSE).
