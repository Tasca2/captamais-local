# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento conforme [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
- Analisar ativo (Tier 1), consolidador/montagem de carteira (Tier 2), BYO IA, sincronização
  local ↔ nuvem, cifra do banco local em repouso.

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
