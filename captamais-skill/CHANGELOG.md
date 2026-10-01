# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento conforme [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Planejado
- Baixar leads da nuvem (desligado por enquanto, por privacidade).
- Analisar ativo (Tier 1), consolidador/montagem de carteira (Tier 2), BYO IA, sincronizar atividades,
  cifra do banco local em repouso.

## [1.0.7] — 2026-10-01
### Alterado
- Calculadora Patrimonial e pesquisa de CNPJ agora aparecem e são autorizadas somente para Premium ou Max.
- Contas recebem 10.000 créditos na primeira vinculação, com concessão única por conta validada no servidor.
- A oferta do bônus aparece no saldo, no menu de créditos e no fluxo de conexão para usuários ainda não vinculados.

## [1.0.6] — 2026-10-01
### Adicionado
- Verificação automática e manual de versões da skill e do MCP no GitHub oficial, sem instalação automática.
- Modal com versões instalada/publicada e prompt seguro pronto para pedir a atualização à IA.
- Saldo de créditos permanentemente visível no canto superior direito; `—` diferencia saldo indisponível de saldo zero.
- Atividades rápidas R1, R2, R3, Follow-up, WhatsApp e Tentativa de ligação; atividades sem data usam o instante da criação.
- CNPJ visível e armazenável somente para PJ, com preenchimento pela Receita e proteção também na camada de dados.
- Importação segura de CSV/TSV/XLSX/JSON com prévia e reconhecimento de campos.

## [1.0.5] — 2026-10-01 (identificação: 1.05)
### Adicionado
- **Aba "Capta+" ao lado do CRM** (conectar conta, planejamento, calculadora). Se o site permitir ser embutido, abre
  dentro do CRM; senão usa sempre **uma única janela** reaproveitada, sem espalhar abas.
- **Calculadora Patrimonial** agora abre a calculadora completa do Capta+ (a calculadora local simples foi removida).
- **Montagem de Carteira** e **Análise de Ativo** abrem as ferramentas do Capta+ (`/portfolio-assembly`, `/asset-analysis`).
- **Enriquecimento de Lead** e **Gerador de Lead** abrem o EnriqueceLead do Capta+ (`/enriquece-lead` e `/enriquece-lead?tab=leads`).
- **Pesquisar leads / Gerar leads (créditos):** botões no topo do CRM e no menu; popup de busca com os filtros do
  EnriqueceLead, contagem de resultados, custo e saldo; compra proporcional ao saldo; a lista comprada fica no banco
  local, com popup para **baixar Excel (.xlsx)**, **importar no CRM** ou **manter só no banco**; "Minhas listas de leads".
  Ferramentas MCP equivalentes (`captamais_search_leads`, `captamais_generate_leads`, …).
- Pesquisa por nome mostra os resultados com o custo de abrir cada um; **✨ Enriquecer** na ficha do lead completa um lead
  existente (só campos vazios); a importação deixa escolher o funil; o saldo mostra a cota de créditos do plano
  (Premium/Max) para uso na skill e no MCP.
- **Comprar créditos sem conta:** ao abrir Pesquisar/Gerar leads sem conta, o CRM oferece entrar, criar conta, só comprar
  créditos ou resgatar um **código recebido por e-mail**; o código gera uma chave de carteira (guardada só neste computador).
  Quem só tem carteira vê "Crie sua conta" em sincronizar, planejamento e Google. Créditos mostram a data de validade.
- **Popup de leads no mesmo modelo da EnriqueceLead do site:** "Pesquisar no banco" (Tudo, Nome, CNPJ, Sócio, E-mail,
  Telefone) e "Gerar lista por filtros" (Atividade e localização, Perfil da empresa, Financeiro, Data de abertura), com
  opções vindas da base e filtros ativos em etiquetas.
- **Painel de Créditos** (menu "💳 Créditos e relatório" e o contador de créditos no topo do CRM): saldo (plano e comprados,
  validade), campo para **ativar um código** e **relatório de gastos** — cada pesquisa ou geração com o que foi buscado,
  leads, custo e o botão **Abrir resultado** (ver, baixar o Excel de novo ou importar no CRM).
- MCP: `captamais_credits_report` e `captamais_redeem_credits`; a chave de carteira resgatada fica em `~/.captamais/config.json`
  e vale para o CRM e para o MCP.
- O CRM e o MCP identificam a versão e o sistema em cada chamada à nuvem (cabeçalho `x-captamais-client`), para a plataforma
  saber qual versão está em uso; veja `PRIVACY.md`.
- **Sincronizar sem conta** (ou só com carteira de créditos) abre a página de entrada/cadastro do Capta+ (`/login`), com a dica de como
  trazer a chave de volta ao CRM.
### Corrigido
- O plano exibido no título (Free/Premium/Max) é conferido de novo ao sincronizar, ao voltar para a janela e a cada
  poucos minutos, com aviso quando muda (assinatura ou rebaixamento).
### Alterado
- **Configurações** é o último item do menu.
- **Tema claro** é o padrão (a escolha só é guardada quando a pessoa alterna o tema).

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
