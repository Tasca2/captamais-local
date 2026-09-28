# Integração com a plataforma CaptaMais

Como a skill local se conecta à nuvem — o que fica no seu PC, o que vai à nuvem, como é medido e como
os recursos vão sendo liberados.

## Arquitetura (híbrido)
- **No seu PC (grátis, sem segredos):** o CRM local — leads, funil, atividades, agenda, importar/exportar.
- **Na nuvem CaptaMais (recursos avançados, medidos):** IA, dados de ativos, montagem de carteira,
  relatórios, sincronização. O app local chama via API **autenticada** e **medida**.

| Camada | Onde roda | Custa token? |
|---|---|---|
| CRM (criar/mover/editar/atividades) | Local | Não |
| IA (preparar reunião, relatórios) | Nuvem **ou** sua chave (BYO) | Sim (nuvem) / seu provedor (BYO) |
| Dados de ativos, carteira, enriquecimento | Nuvem | Sim |
| Sincronização | Nuvem | Conforme plano |

## Vincular a conta
1. No CaptaMais: **Minha Conta → Conector** e copie sua **chave de API**.
2. No app da skill, abra **☁ Sincronizar** (ou menu ☰ → **Conta CaptaMais**) e cole a chave. Ela fica salva
   só no seu computador (`~/.captamais/config.json`) e nunca volta para o navegador. (Alternativa para
   quem usa o MCP/automação: variável de ambiente `CAPTAMAIS_API_KEY`, e opcional `CAPTAMAIS_CLOUD_URL`,
   padrão `https://captamais.me`.)
3. Sem chave, a skill funciona **100% local** — só os recursos de nuvem ficam indisponíveis.

## Medição e cobrança (híbrido)
- **Assinatura** dá uma cota de uso; acima dela, **tokens avulsos** (pré-pago).
- CRUD local **não** conta. Cada ação de nuvem é autenticada pela sua conta e **medida no servidor**
  (fonte da verdade da cobrança).

## Liberação progressiva (por plano)
Os recursos vão **abrindo conforme o seu plano**. Ao acionar algo não incluído, a skill informa e
oferece upgrade. A nuvem decide o que está liberado para a sua conta.

## IA
Hoje a IA do conector roda **só na nuvem CaptaMais** (medida na sua conta). Trazer chave própria
(BYO) ainda não está disponível.

## Sincronização (opt-in) — fase 1: só envia
No botão **☁ Sincronizar** a skill **envia** os seus leads para a sua conta na plataforma. **Nada da
plataforma é baixado para o seu computador** nesta fase (decisão de privacidade LGPD/RGPD): a nuvem nem
entrega dados pessoais dos leads — só o id e a data de alteração, para saber o que mudou.

Regras: nunca duplica (a nuvem casa por e-mail/telefone); alterado só aqui → sobe; alterado dos dois lados →
vale o mais recente (a versão mais nova da plataforma não é sobrescrita); **exclusões não são propagadas**;
um backup local é salvo antes. Sincroniza contatos e etapa/funil dos leads de prospecção (não envia
histórico, atividades nem clientes). O limite de leads do seu plano continua valendo. "Baixar da nuvem"
fica para uma fase futura.

## Como cada recurso avançado aparece (2 tiers)
- **Tier 1 — tela local + dado da nuvem:** ex.: **analisar ativo** (você pesquisa, o dado vem da
  nuvem, medido).
- **Tier 2 — abrir na plataforma com dados sincronizados:** ex.: **consolidador/montagem de carteira,
  planejamento, relatórios** — a skill abre a plataforma (autenticada), que trabalha com os seus dados
  sincronizados.

## O que sai da sua máquina (e quando)
Somente ao acionar um recurso de nuvem, e **apenas o necessário** daquela ação. O CRM local, por si
só, **não envia** nada. Sync é **opt-in**. Ver `PRIVACY.md`.

## Status dos recursos
| Recurso | Status |
|---|---|
| CRM local (funil, atividades, agenda, import/export) | ✅ Disponível |
| Preparar reunião com IA (medido) | ✅ Disponível (conector MCP) |
| BYO IA (chave própria) | 🔧 Em desenvolvimento |
| Analisar ativo (Tier 1) | 🔧 Em desenvolvimento |
| Consolidador/montagem de carteira (Tier 2) | 🔧 Em desenvolvimento |
| Sincronização local → nuvem (leads) | ✅ Disponível (só envia; baixar da nuvem: fase futura) |
| Planejamento financeiro | ✅ Abre a ferramenta do site (com o lead já enviado à nuvem) — plano Premium; quem é Free vê "Ver planos" |
| Conexão Gmail / Google Agenda no app local | ✅ Cliente disponível; requer endpoints OAuth na plataforma |
| Evento no Google Agenda / criação de Meet | ✅ Cliente disponível; requer endpoints OAuth na plataforma |

## Contrato da integração Google

O app local nunca recebe `client_secret`, `access_token` ou `refresh_token` do Google. Ele chama a
plataforma com `x-captamais-key`; a plataforma associa a autorização Google à conta autenticada e
mantém os tokens cifrados no servidor. O contrato completo para implementar o backend está em
[`GOOGLE_INTEGRATION.md`](GOOGLE_INTEGRATION.md).

> Recursos "em desenvolvimento" ainda não estão ativos nesta versão; entram por liberação progressiva.
