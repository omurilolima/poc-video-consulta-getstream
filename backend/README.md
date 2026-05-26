# Backend — POC Videoconsulta GetStream

Serviço NestJS responsável por orquestrar o ciclo de vida das sessões de videoconsulta.  
É a **fonte da verdade** do estado da sessão, conforme definido no [SPIKE.md §3.2.1](../SPIKE.md#321-fonte-da-verdade-do-estado-da-sessão).

---

## Responsabilidades

- Criar chamadas no GetStream Video e emitir tokens para os participantes (`upsertUsers` + token com `call_cids`)
- Manter a máquina de estados da sessão (`criada → aguardando → midia_pendente → ativa → encerrada | vetada`)
- Receber webhooks do GetStream e disparar transições de estado
- Na PoC: aceitar **`POST /sessions/:id/joined`** para transicionar após join no cliente quando o webhook ainda não estiver configurado ou chegar tarde
- Encerrar e vetar sessões (C4), com bloqueio de reentrada no nível do GetStream onde aplicável
- Encerrar automaticamente sessões abandonadas em lobby (C2 — `LOBBY_TIMEOUT_MS`)

---

## Estrutura

```
src/
└── video/
    ├── session.entity.ts      # enum SessionState + interface Session
    ├── video.service.ts       # GetStream SDK, máquina de estados, timeouts C2
    ├── video.controller.ts    # endpoints REST /sessions/*
    ├── webhook.controller.ts  # POST /webhooks/getstream
    └── video.module.ts
```

---

## Configuração

As credenciais GetStream são lidas do `.env` na raiz do workspace (um nível acima de `backend/`):

```
getstream_api_key=...
getstream_api_secret=...
getstream_app_id=...
```

Variáveis opcionais:

| Variável           | Padrão   | Descrição                 |
| ------------------ | -------- | ------------------------- |
| `PORT`             | `3000`   | Porta do servidor         |
| `LOBBY_TIMEOUT_MS` | `120000` | Timeout do lobby C2 em ms |

---

## Instalação e execução

```bash
npm install

# modo desenvolvimento (watch)
npm run start:dev

# modo produção
npm run start:prod
```

O servidor sobe em `http://localhost:3000`.

---

## Contrato da API

**Base URL (dev):** `http://localhost:3000`

Todos os endpoints de sessão usam `:id` = `sessionId` (UUID retornado em `POST /sessions`).

### Tipos compartilhados

**`SessionState`:** `criada` · `aguardando` · `midia_pendente` · `ativa` · `encerrada` · `vetada`

**`ParticipantRole`:** `paciente` · `medico`

**Objeto `Session` (retornado por vários endpoints):**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callId": "consulta-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callType": "default",
  "state": "midia_pendente",
  "participants": [
    {
      "userId": "medico-01",
      "role": "medico",
      "joinedAt": "2026-05-25T18:30:00.000Z",
      "mediaReady": false
    },
    {
      "userId": "paciente-01",
      "role": "paciente",
      "joinedAt": "2026-05-25T18:30:12.000Z",
      "mediaReady": true
    }
  ],
  "createdAt": "2026-05-25T18:29:45.000Z",
  "updatedAt": "2026-05-25T18:30:15.000Z"
}
```

**Erros (formato NestJS):**

```json
{
  "statusCode": 404,
  "message": "Session a1b2c3d4-... not found",
  "error": "Not Found"
}
```

| HTTP | Quando |
| ---- | ------ |
| `400 Bad Request` | Query obrigatória ausente ou `role` inválido |
| `403 Forbidden` | Token negado (sessão encerrada/vetada; paciente em sessão vetada) |
| `404 Not Found` | `sessionId` ou `userId` inexistente |
| `401 Unauthorized` | Assinatura inválida no webhook GetStream |

---

### `POST /sessions`

Cria sessão e a call correspondente no GetStream (`callType: default`).

**Request:** body vazio `{}` (ou omitido).

**Response `201 Created`:**

```json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callId": "consulta-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callType": "default"
}
```

---

### `GET /sessions/:id`

Retorna o estado atual — usado pelos clientes em polling (~2–3 s).

**Response `200 OK`:** objeto `Session` (ver acima).

**Exemplo — sessão recém-criada, ninguém entrou ainda:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callId": "consulta-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callType": "default",
  "state": "criada",
  "participants": [],
  "createdAt": "2026-05-25T18:29:45.000Z",
  "updatedAt": "2026-05-25T18:29:45.000Z"
}
```

---

### `GET /sessions/:id/token`

Emite token GetStream para o participante ingressar na call via SDK.

**Query params (obrigatórios):**

| Param | Tipo | Descrição |
| ----- | ---- | --------- |
| `userId` | string | Identificador estável do usuário (ex.: `medico-01`) |
| `role` | `paciente` \| `medico` | Papel na sessão; usado para regras de veto (C4) |

**Response `200 OK`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "callId": "consulta-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callType": "default",
  "apiKey": "sua_getstream_api_key"
}
```

> Na PoC o `apiKey` é exposto ao cliente para inicializar o SDK — aceitável em laboratório.

**Response `403 Forbidden` — sessão vetada, paciente tentando reentrar:**

```json
{
  "statusCode": 403,
  "message": "Session is vetoed — patient cannot rejoin",
  "error": "Forbidden"
}
```

---

### `POST /sessions/:id/joined`

**PoC:** cliente sinaliza que fez `call.join()` no SDK. Replica `call.session_participant_joined` quando webhook/ngrok não está configurado.

**Query params:** `userId` (obrigatório)

**Transições:** `criada → aguardando` (1º join) · `aguardando → midia_pendente` (2º join)

**Response `200 OK`:** objeto `Session` atualizado.

**Exemplo — após o segundo participante entrar:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callId": "consulta-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callType": "default",
  "state": "midia_pendente",
  "participants": [
    { "userId": "medico-01", "role": "medico", "joinedAt": "2026-05-25T18:30:00.000Z", "mediaReady": false },
    { "userId": "paciente-01", "role": "paciente", "joinedAt": "2026-05-25T18:30:12.000Z", "mediaReady": false }
  ],
  "createdAt": "2026-05-25T18:29:45.000Z",
  "updatedAt": "2026-05-25T18:30:12.000Z"
}
```

---

### `POST /sessions/:id/left`

**PoC:** cliente sinaliza que o participante remoto saiu ou caiu (C3). Replica `call.session_participant_left`.

**Query params:** `userId` (obrigatório) — ID do participante que **saiu** (não quem detectou a queda).

**Transição:** se `state === ativa` → `midia_pendente` e `mediaReady` de todos resetado.

**Response `200 OK`:** objeto `Session` atualizado.

---

### `POST /sessions/:id/media-ready`

Participante confirma que está **recebendo** áudio **e** vídeo do outro lado (clientes disparam após detectar `publishedTracks` remotos).

**Query params:** `userId` (obrigatório)

**Transição:** quando **ambos** os participantes registrados têm `mediaReady: true` e `state === midia_pendente` → `ativa`.

**Response `200 OK`:**

```json
{
  "state": "ativa"
}
```

Enquanto só um lado sinalizou, `state` permanece `midia_pendente`:

```json
{
  "state": "midia_pendente"
}
```

---

### `POST /sessions/:id/end`

Encerra a sessão no backend e chama `call.end()` no GetStream.

**Query params:**

| Param | Valores | Efeito |
| ----- | ------- | ------ |
| `veto` | `true` | C4: `state → vetada`, bloqueia pacientes no GetStream |
| `veto` | `false` ou omitido | `state → encerrada` |

**Response `200 OK`:** objeto `Session` final.

**Exemplo — encerramento com veto:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callId": "consulta-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "callType": "default",
  "state": "vetada",
  "participants": [ "..." ],
  "createdAt": "2026-05-25T18:29:45.000Z",
  "updatedAt": "2026-05-25T18:45:00.000Z"
}
```

---

### `POST /webhooks/getstream`

Recebe eventos assinados do GetStream Dashboard. Complementa (ou substitui) os sinais `/joined` e `/left` da PoC.

**Headers:** `x-signature` — HMAC validado com `getstream_api_secret`.

**Body:** JSON do evento GetStream. O backend extrai `sessionId` de `call.custom.sessionId`.

**Eventos tratados:**

| Evento | Ação |
| ------ | ---- |
| `call.session_participant_joined` | Igual a `POST /joined` |
| `call.session_participant_left` | Igual a `POST /left` |
| `call.session_ended` / `call.ended` | `→ encerrada` |

**Response `200 OK`:**

```json
{
  "ok": true
}
```

---

### Fluxo completo (curl)

Substitua `{sessionId}` pelo UUID retornado em `POST /sessions`.

```bash
# 1. Criar sessão
curl -s -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" -d '{}'

# 2. Token do médico
curl -s "http://localhost:3000/sessions/{sessionId}/token?userId=medico-01&role=medico"

# 3. Token do paciente
curl -s "http://localhost:3000/sessions/{sessionId}/token?userId=paciente-01&role=paciente"

# 4. Após call.join() no cliente (PoC)
curl -s -X POST "http://localhost:3000/sessions/{sessionId}/joined?userId=medico-01"
curl -s -X POST "http://localhost:3000/sessions/{sessionId}/joined?userId=paciente-01"

# 5. Quando cada lado recebe mídia do outro
curl -s -X POST "http://localhost:3000/sessions/{sessionId}/media-ready?userId=medico-01"
curl -s -X POST "http://localhost:3000/sessions/{sessionId}/media-ready?userId=paciente-01"

# 6. Polling de estado
curl -s "http://localhost:3000/sessions/{sessionId}"

# 7. Encerrar com veto (C4)
curl -s -X POST "http://localhost:3000/sessions/{sessionId}/end?veto=true"
```

---

## Máquina de estados

```
criada → aguardando → midia_pendente → ativa → encerrada
                                             ↘ vetada
```

| Evento | Origem típica | Transição observada na PoC |
| ------ | -------------- | --------------------------- |
| 1º participante entra (join efectivo na call) | Webhook **`call.session_participant_joined`** *ou* `POST /sessions/:id/joined` | `criada → aguardando`; agenda C2 se aplicável |
| 2º participante entra | Idem | `aguardando → midia_pendente` |
| `POST /media-ready` pelos dois (com estado `midia_pendente`) | Cliente (RN / Web), quando remotos publicam áudio+vídeo | `midia_pendente → ativa` |
| Participante sai com sessão ativa | Webhook **`call.session_participant_left`** | `ativa → midia_pendente` + timeout de lobby pode ser reativado |
| Call encerra | Webhook **`call.session_ended`** | `→ encerrada` (salvo já encerrado/vetado) |
| `POST /end?veto=true` | Cliente (médico) | `→ vetada` (+ bloqueio de pacientes no GetStream quando possível) |
| Timeout lobby | Backend (`LOBBY_TIMEOUT_MS`) | `aguardando` ou `midia_pendente` → `encerrada` |

> **Implementação atual:** `/joined` replica no código o comportamento esperado dos webhooks para o primeiro/segundo join, garantindo demos locais sem túnel.

---

## Configurar webhook no GetStream Dashboard

1. Dashboard GetStream → **Video & Audio → Webhooks**
2. URL: `https://SEU_DOMINIO/webhooks/getstream`
3. Testes locais:
   ```bash
   ngrok http 3000
   ```
4. Eventos: `call.session_participant_joined`, `call.session_participant_left`, `call.session_ended`
