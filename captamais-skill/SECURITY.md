# Segurança — CaptaMais Skill

> Modelo informativo. Recomenda-se revisão de segurança/jurídica antes da publicação.

## Modelo de segurança (o que já fazemos)
- **Local-first:** os dados do CRM ficam na sua máquina (`~/.captamais/captamais.db`).
- **Servidor local restrito:** escuta apenas em `127.0.0.1` (não acessível pela rede) e exige um
  **token de sessão aleatório (anti-CSRF)** em toda chamada de API — sites e outros programas não
  conseguem ler nem alterar seu CRM.
- **Sem segredos no pacote local:** o código distribuído não contém chaves nem lógica sensível.
- **Consultas parametrizadas** (sem SQL injection) e **escape de saída** (sem XSS no display).
- **Links validados:** só `http(s)` em links de reunião/Meet (bloqueia `javascript:` etc.).
- **Dados de lead tratados como não confiáveis** (proteção contra prompt-injection quando operado por
  IA — conteúdo de lead nunca é executado como instrução).
- **Medição/cobrança no servidor** (o cliente local não é fonte da verdade de cobrança).

## ⚠️ Riscos que você (usuário) deve conhecer
1. **Banco local não é cifrado por padrão (nesta versão).** Quem tiver acesso ao seu computador pode
   abrir o arquivo do CRM. **Recomendação:** ative a **cifra de disco** (BitLocker no Windows,
   FileVault no macOS, LUKS no Linux) e proteja o login do computador. (Cifra do próprio banco está no
   roadmap.)
2. **Você é responsável pelos dados dos seus leads** (ver `PRIVACY.md`). Faça **backup** com o botão
   Exportar; o arquivo exportado também contém dados pessoais — guarde com cuidado.
3. **Não exponha a porta local** na internet nem rode atrás de proxies públicos.
4. **Recursos de nuvem/IA são opt-in.** Ao usá-los, dados necessários saem da máquina; no modo BYO,
   sua chave de IA fica no seu computador — **não compartilhe** o arquivo de configuração.
5. **Instale apenas da fonte oficial** (`github.com/Tasca2`). Não rode forks/versões não confiáveis —
   código local roda na sua máquina.
6. **Não versione** o banco (`.db`) nem o `crm-view.html` (já cobertos pelo `.gitignore`).

## Versões suportadas
| Versão | Suporte de segurança |
|---|---|
| 0.1.x | ✅ |

## Como reportar uma vulnerabilidade (divulgação coordenada)
- **NÃO** abra issue pública para falhas de segurança.
- Envie para **[PREENCHER: security@seu-dominio]** com passos de reprodução e impacto.
- Meta de resposta: até **5 dias úteis**; correção conforme severidade. Pedimos um prazo de
  divulgação coordenada de **até 90 dias** antes de tornar público.
- Agradecemos relatos responsáveis e podemos creditar quem reportar (se desejar).
