<p align="center">
  <img src="assets/logo.svg" alt="CaptaMais" width="92" height="92" />
</p>

<h1 align="center">CaptaMais — CRM local no Claude</h1>

<p align="center">
  Seu CRM de prospecção rodando <b>na sua máquina</b>, operado pelo seu assistente de IA.<br/>
  Os dados dos seus leads ficam <b>no seu computador</b> — privacidade em primeiro lugar.
</p>

<p align="center">
  <img alt="versão" src="https://img.shields.io/badge/vers%C3%A3o-0.1.0-f59e0b" />
  <img alt="plataforma" src="https://img.shields.io/badge/Node-18%2B-3c873a" />
  <img alt="licença" src="https://img.shields.io/badge/licen%C3%A7a-Source--Available-blue" />
  <img alt="privacidade" src="https://img.shields.io/badge/dados-100%25%20locais-10b981" />
</p>

---

## Sumário
- [O que é](#o-que-é)
- [Por que usar](#por-que-usar)
- [Recursos](#recursos)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Como usar](#como-usar)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Integração com a plataforma](#integração-com-a-plataforma)
- [Roadmap](#roadmap)
- [Suporte](#suporte)
- [Licença e avisos legais](#licença-e-avisos-legais)

## O que é
A **CaptaMais Skill** transforma o seu assistente de IA (Claude e clientes compatíveis) em um **CRM de
prospecção que roda localmente**. Você gerencia leads e o funil, marca **ligações, follow-ups e
reuniões (com Google Meet)** e acompanha sua **agenda** — tudo com os dados **na sua máquina**.
Recursos avançados (IA, dados de mercado, montagem de carteira) conectam-se à nuvem CaptaMais **quando
você quiser**, e são cobrados por uso.

> Para desenvolvedores: a skill é **local-first e híbrida** — só a UI e o CRM local ficam no seu PC;
> lógica sensível, prompts e medição permanecem na nuvem. Veja [`INTEGRATION.md`](INTEGRATION.md).

## Por que usar
- 🔒 **Privacidade real:** os dados dos leads não saem do seu computador por padrão.
- 🧠 **IA de verdade por cima:** prepare reuniões, gere apoio — pela nuvem **ou** com a sua própria chave.
- 🧩 **Mesma estrutura da plataforma:** funil e dados compatíveis com o CaptaMais (migração futura 1:1).
- 💸 **Pague pelo que usar:** CRM local é grátis; só os recursos de nuvem são medidos.

## Recursos
**Local (grátis, sem nuvem):**
- Funil de prospecção (NOVO LEAD → CONTATO INICIAL → PRIMEIRA REUNIÃO → SEGUNDA REUNIÃO → FECHAMENTO).
- Criar lead, **arrastar cards** entre etapas, **pop-up** para editar e atender.
- Atividades: **ligação, follow-up, reunião (+ Meet), tarefa** e **agenda**.
- **Importar/Exportar** (JSON).

**Nuvem (opcional, medido — liberação progressiva):**
- IA para preparar reunião/relatórios (nuvem ou **sua chave**).
- Dados de ativos, montagem de carteira, enriquecimento, sincronização. Ver [status](INTEGRATION.md#status-dos-recursos).

## Requisitos
- **Node.js 18+**
- Um cliente de IA compatível (ex.: Claude Desktop) — a skill vai na sua pasta de skills.
- (Opcional) Conta CaptaMais para os recursos de nuvem.

## Instalação
```bash
# 1) Baixe o repositório (skill + MCP) e copie a skill para o Claude
git clone https://github.com/Tasca2/captamais-local.git
cp -R captamais-local/captamais-skill ~/.claude/skills/captamais

# 2) Instale a dependência local (uma vez)
cd ~/.claude/skills/captamais
npm install
```
> Windows: a pasta costuma ser `%USERPROFILE%\.claude\skills\`.

## Como usar
No Claude, chame:
```
/captamais
```
…ou peça em linguagem natural: **"abre meu CRM"**, **"cria um lead"**, **"marca uma reunião com o
lead 3 e cria o Meet"**, **"o que tenho na agenda?"**.

O Claude **sobe o app local** (`http://127.0.0.1:…`, só na sua máquina) e abre no navegador. A partir
daí você trabalha direto: arrastar cards, criar/editar leads, registrar atendimento, agenda,
importar/exportar.

## Privacidade e segurança
- Servidor local escuta **só em `127.0.0.1`** + **token anti-CSRF**; nada exposto na rede.
- Dados dos leads ficam em `~/.captamais/captamais.db` (**sua máquina**).
- Você é o **controlador** dos dados dos seus leads (LGPD/GDPR). Detalhes: [`PRIVACY.md`](PRIVACY.md).
- Modelo de segurança, **riscos a conhecer** e como reportar falhas: [`SECURITY.md`](SECURITY.md).
- 💡 Recomendação: mantenha a **cifra de disco** ativa (BitLocker/FileVault) no seu computador.

## Integração com a plataforma
Como vincular a conta, o que é medido, planos, modo "traga sua chave" e o que sai da máquina em cada
ação: [`INTEGRATION.md`](INTEGRATION.md).

## Roadmap
Veja o quadro de evolução (recursos por fase) no repositório principal do CaptaMais.
Próximos: analisar ativo, montagem de carteira, sincronização, cifra do banco local.

## Suporte
Dúvidas ou problemas: [PREENCHER canal de suporte]. Para **falhas de segurança**, siga
[`SECURITY.md`](SECURITY.md) (não abra issue pública).

## Licença e avisos legais
- Licença: [`LICENSE`](LICENSE) (source-available / proprietária).
- Isenção de responsabilidade (não é recomendação de investimento; ferramenta "como está"):
  [`DISCLAIMER.md`](DISCLAIMER.md).
- Os documentos legais são **modelos** — recomenda-se **revisão jurídica** antes da publicação.

<p align="center"><sub>Capta+Mais · seus dados, na sua máquina.</sub></p>
