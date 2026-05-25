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

## API — sessões

| Método | Endpoint | Descrição |
| ------ | -------- | --------- |
| `POST` | `/sessions` | Cria sessão + call GetStream; retorna `sessionId`, `callId`, `callType` |
| `GET`  | `/sessions/:id` | Estado atual da sessão (polling pelos clientes) |
| `GET`  | `/sessions/:id/token?userId=X&role=paciente\|medico` | Token GetStream + `callId`, `callType`, `apiKey` |
| `POST` | `/sessions/:id/joined?userId=X` | **PoC:** cliente sinaliza que ingressou na call (transições compatíveis com `onParticipantJoined`) |
| `POST` | `/sessions/:id/media-ready?userId=X` | Participante confirma recebimento de áudio+vídeo do outro lado |
| `POST` | `/sessions/:id/end?veto=true\|false` | Encerra a sessão; `veto=true` aplica regra C4 no backend/GetStream |

## API — webhook (outro controller)

| Método | Endpoint | Descrição |
| ------ | --------- | --------- |
| `POST` | `/webhooks/getstream` | Eventos GetStream assinados; complementa transições (ex.: participant left / session ended) |

### Exemplo: criar sessão e usar token

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" -d '{}'

# Obter token
curl "http://localhost:3000/sessions/{sessionId}/token?userId=paciente-01&role=paciente"

# Opcional PoC — após join no SDK no cliente:
curl -X POST "http://localhost:3000/sessions/{sessionId}/joined?userId=paciente-01" \
  -H "Content-Type: application/json" -d '{}'

# Sinalizar mídia pronta (quando aplicável ao fluxo)
curl -X POST "http://localhost:3000/sessions/{sessionId}/media-ready?userId=paciente-01" \
  -H "Content-Type: application/json" -d '{}'

# Encerrar com veto (C4)
curl -X POST "http://localhost:3000/sessions/{sessionId}/end?veto=true" \
  -H "Content-Type: application/json" -d '{}'
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
