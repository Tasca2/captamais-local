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
2. Configure na skill (variável de ambiente): `CAPTAMAIS_API_KEY`, e opcional `CAPTAMAIS_CLOUD_URL`
   (padrão `https://captamais.me`).
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
| Sincronização local ↔ nuvem | 🔧 Em desenvolvimento |
| Google Meet (criação real) / Agenda | 🔧 Em desenvolvimento |

> Recursos "em desenvolvimento" ainda não estão ativos nesta versão; entram por liberação progressiva.
