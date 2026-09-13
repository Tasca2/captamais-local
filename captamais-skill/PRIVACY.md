# Privacidade e Proteção de Dados — CaptaMais Skill (LGPD & GDPR/RGPD)

> **Aviso:** este documento é informativo e serve de modelo. Não é aconselhamento jurídico —
> recomenda-se revisão por um(a) advogado(a)/DPO antes da publicação.
> Aplicável à **LGPD** (Lei 13.709/2018 – Brasil) e ao **GDPR/RGPD** (Regulamento (UE) 2016/679).

## 1. Resumo em uma frase
A CaptaMais Skill é um CRM que roda **na sua máquina**: os dados dos seus leads ficam **no seu
computador**. Nada de dado de lead sai do seu PC, exceto quando **você** aciona explicitamente um
recurso de nuvem/IA — e, mesmo assim, apenas o necessário para aquela ação.

## 2. Papéis (importante)
- **Você (assessor/consultor) é o CONTROLADOR** dos dados pessoais dos seus leads (LGPD art. 5º, VI /
  GDPR art. 4(7)). É você quem decide coletar e usar esses dados e quem responde por eles.
- **O CaptaMais é OPERADOR/processador** (LGPD art. 5º, VII / GDPR art. 28) **apenas** quando você
  usa um recurso de nuvem (IA, dados de mercado, montagem de carteira, sync), e **somente** para
  executar aquela ação sob sua instrução.
- Na skill puramente local (CRUD do CRM), o CaptaMais **não acessa** seus dados.

## 3. Quais dados a skill trata
- **De leads (fornecidos por você):** nome, e-mail, telefone, cidade/estado, profissão, anotações e
  atividades (ligações, follow-ups, reuniões, tarefas).
- **Onde ficam:** em banco local `~/.captamais/captamais.db`, **no seu computador**.
- **O que NÃO coletamos localmente:** nenhuma telemetria; o app local não envia seus dados a lugar
  nenhum por conta própria.

## 4. O que sai do seu computador (e quando)
- **Ações de nuvem/IA acionadas por você:** ao pedir, por exemplo, "preparar reunião com IA" ou
  "buscar dados do ativo", **apenas os dados necessários** daquela ação são enviados à nuvem CaptaMais
  (autenticados e medidos) — para prestar o serviço e faturar o uso.
- **Modo "traga sua chave" (BYO):** se você configurar seu próprio provedor de IA (ex.: Gemini), a
  ação usa **a sua chave** e o dado vai ao **seu** provedor, não ao nosso.
- **Sincronização (opcional):** se você ativar o sync, os dados escolhidos sobem para a sua conta na
  nuvem CaptaMais. É opt-in.

## 5. Bases legais (você, como controlador, deve garantir)
Você deve ter uma base legal para tratar os dados dos seus leads — normalmente **consentimento**
(LGPD art. 7º, I / GDPR art. 6(1)(a)) ou **legítimo interesse** (LGPD art. 7º, IX / GDPR art. 6(1)(f)),
avaliando o caso. Se os leads vierem de formulário/landing, guarde o registro do consentimento.

## 6. Direitos dos titulares (dos seus leads)
Como controlador, você deve atender pedidos de acesso, correção, exclusão, portabilidade e revogação
(LGPD art. 18 / GDPR arts. 15–22). A skill ajuda:
- **Exportar** todos os dados (portabilidade) — botão Exportar / `crm.mjs`.
- **Excluir** um lead/atividade ou apagar o banco local (direito ao esquecimento).

## 7. Segurança
- App local escuta **só em `127.0.0.1`** e exige **token anti-CSRF**; não há porta aberta na rede.
- Recomenda-se **cifrar o disco** do computador (BitLocker/FileVault) — o banco local herda a proteção
  do disco. (A cifra do próprio banco está no roadmap de segurança.)
- Nas ações de nuvem, o tráfego é por **HTTPS** e a base da plataforma é **cifrada em repouso**.
- Nunca compartilhe seu arquivo `~/.captamais/captamais.db` — ele contém dados pessoais.

## 8. Transferência internacional
Recursos de IA/nuvem podem processar dados em servidores fora do seu país. Ao usá-los, você reconhece
essa transferência (LGPD arts. 33–36 / GDPR cap. V). No modo BYO, isso depende do provedor que você
escolher.

## 9. Retenção e eliminação
Os dados locais permanecem enquanto você quiser. Você pode exportar e apagar a qualquer momento.
Dados enviados à nuvem seguem a Política de Privacidade e a retenção do CaptaMais.

## 10. Responsabilidades do usuário (assessor)
- Informar seus leads sobre o tratamento e obter base legal adequada.
- Manter seu computador seguro (o dado é local).
- Atender aos direitos dos titulares.
- Usar os dados apenas para as finalidades informadas.

## 11. Contato
Encarregado/DPO CaptaMais: [PREENCHER e-mail]. Para os dados dos seus leads, o ponto de contato é
**você** (controlador).
