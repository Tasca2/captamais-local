# Contrato do backend — Gmail e Google Agenda

Este documento define os endpoints que a plataforma `captamais.me` precisa oferecer para o app
local e o MCP. O cliente deste repositório já consome este contrato.

## Princípios de segurança

- Todos os endpoints autenticam a conta por `x-captamais-key`.
- O OAuth começa e termina em HTTPS na plataforma; nunca redireciona tokens para `127.0.0.1`.
- Use `state` aleatório, de uso único, com expiração curta, e PKCE no fluxo de autorização.
- Armazene access/refresh tokens cifrados e nunca os devolva ao app local.
- Peça apenas os escopos necessários. Para a primeira versão: identidade da conta,
  `calendar.events` e, somente se houver envio pelo Gmail, `gmail.send`. Não peça leitura da caixa.
- Na desconexão, revogue o grant no Google e elimine os tokens armazenados.

## Endpoints

### `GET /api/mcp/integrations/google/status`

Resposta:

```json
{
  "ok": true,
  "data": {
    "connected": true,
    "email": "usuario@empresa.com",
    "gmail": true,
    "calendar": true
  }
}
```

`connected` só deve ser `true` se ainda houver um grant utilizável. `gmail` e `calendar` representam
os escopos efetivamente concedidos.

### `POST /api/mcp/integrations/google/connect`

Corpo:

```json
{ "services": ["gmail", "calendar"] }
```

Resposta:

```json
{
  "ok": true,
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

A URL deve conter um `state` vinculado à conta CaptaMais. Depois do callback, a plataforma salva o
grant e mostra uma página simples de sucesso que pode ser fechada. O app local consulta o endpoint
de status até detectar a conexão.

### `POST /api/mcp/integrations/google/disconnect`

Revoga o grant, apaga os tokens e responde `{ "ok": true }`.

### `POST /api/mcp/integrations/google/calendar/events`

Corpo:

```json
{
  "activity": {
    "localId": 42,
    "type": "meeting",
    "title": "Reunião de diagnóstico",
    "startAt": "2026-09-18T14:00:00.000Z",
    "notes": "Levar proposta"
  },
  "lead": {
    "name": "Maria Souza",
    "email": "maria@example.com",
    "phone": "+55 11 99999-9999"
  },
  "createMeet": true
}
```

Resposta:

```json
{
  "ok": true,
  "data": {
    "eventId": "google-event-id",
    "htmlLink": "https://calendar.google.com/calendar/event?...",
    "meetLink": "https://meet.google.com/abc-defg-hij"
  }
}
```

Use `activity.localId` junto com o id da conta como chave de idempotência, para que uma repetição não
crie eventos duplicados. A duração padrão sugerida é 30 minutos. Só inclua o e-mail do lead em
`attendees` quando ele for válido e o usuário tiver pedido a sincronização. Quando `createMeet` for
`true`, use `conferenceData` e devolva o link gerado.

## Erros

Erros usam o formato abaixo e códigos HTTP adequados (`400`, `401`, `403`, `409`, `429`, `5xx`):

```json
{ "ok": false, "code": "google_not_connected", "message": "Conecte o Google nas configurações." }
```

Códigos recomendados: `google_not_connected`, `google_scope_missing`, `google_token_revoked`,
`invalid_activity`, `rate_limited` e `provider_error`.
