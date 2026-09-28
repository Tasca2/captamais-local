# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento conforme [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Planejado
- Baixar leads da nuvem (desligado por enquanto, por privacidade).
- Analisar ativo (Tier 1), consolidador/montagem de carteira (Tier 2), BYO IA, sincronizar atividades,
  cifra do banco local em repouso.

## [1.0.4] — 2026-09-28 (identificação: 1.04)
### Adicionado
- **Abrir sem o assistente:** `Abrir CaptaMais.bat` (Windows) e `Abrir CaptaMais.command` (Mac) — duplo clique abre o CRM,
  instalam o que falta na primeira vez e (Windows) oferecem um **atalho com ícone** na Área de Trabalho
  (`node scripts/atalho.mjs`). Serve de plano B quando o assistente não consegue rodar comandos (ex.: bloqueio do modo
  automático).
- `SKILL.md` usa `${CLAUDE_SKILL_DIR}` (caminho real da skill) e orienta parar após uma tentativa bloqueada,
  indicando o duplo clique.
- Ícone (favicon) na janela do aplicativo.

## [1.0.3] — 2026-09-28 (identificação: 1.03)
### Adicionado
- **Sincronização local → nuvem (leads):** o botão ☁ Sincronizar **envia** os leads para a conta. Fase 1 só
  sobe: nada da plataforma é baixado (LGPD/RGPD) e a nuvem só devolve id + data de alteração. Sem duplicar
  (casa por e-mail/telefone), o mais recente vence, exclusões não se propagam, backup antes de enviar.
- **Conectar conta pela tela** (chave salva só em `~/.captamais/config.json`), sem depender de variável
  de ambiente.
- **Planejamento Financeiro:** abre a ferramenta do site, e o botão dentro do lead já a abre com esse lead.
- **Bloco «Planejamentos deste lead»** na ficha: mostra quantos existem e quando foi o último, com «Abrir último» e
  «Novo planejamento» (só ids e datas; os valores ficam na plataforma).
- O Planejamento Financeiro é do plano Premium ou Max; quem é Free vê «Ver planos», que abre a plataforma.
- **Abre como aplicativo:** o CRM abre sozinho numa janela própria do Chrome/Edge/Brave (sem abas nem barra de
  endereço; senão, navegador padrão) em vez de depender de uma aba embutida no Cursor/Claude. Roda solto do
  terminal, não abre duas cópias e se encerra sozinho após 12 h sem uso (`CAPTAMAIS_IDLE_MIN`). Opções:
  `--no-open` (não abre janela), `--foreground` (roda no terminal), `CAPTAMAIS_BROWSER=<caminho>`.
### Segurança
- O app só fala com a nuvem por **HTTPS** (http só em localhost), não segue redirecionamentos com a chave e tem tempo limite.
### Corrigido
- Ao vincular um lead que já existia na nuvem (mesmo e-mail ou telefone), se a cópia local for mais recente ela é enviada. Antes o vínculo marcava o lead como sincronizado sem subir essa versão.

## [1.0.2] — 2026-09-15 (identificação: 1.02)
### Alterado
- As colunas do funil ocupam a altura disponível da tela no app interativo e no display estático.
- Colunas com muitos leads têm rolagem interna; a altura se ajusta ao redimensionar a janela.
- Identificação visível da versão 1.02 no CRM e na documentação.

## [0.1.0] — 2026-09-10
### Adicionado
- **CRM local interativo** (app em `127.0.0.1`): funil de prospecção (etapas iguais às da plataforma),
  **criar lead, arrastar cards entre etapas, pop-up de atendimento** (registrar ligação, follow-up,
  reunião com Google Meet, tarefa), **agenda** e **importar/exportar** — dados gravados no banco local.
- **Conector MCP** (`captamais-mcp`): CRUD local + ação de IA "preparar reunião" (autenticada e
  **medida** na nuvem).
- **Segurança:** servidor local restrito a `127.0.0.1` + **token anti-CSRF**; consultas
  parametrizadas; escape de saída (anti-XSS); validação de URL do Meet; dados de lead tratados como
  não confiáveis (anti prompt-injection).
- **Documentação:** README, `PRIVACY.md` (LGPD/GDPR), `SECURITY.md`, `DISCLAIMER.md`,
  `INTEGRATION.md`, `LICENSE`, `.gitignore`.
- **Identidade:** logo CaptaMais embutido (SVG, versões laranja e branca).
