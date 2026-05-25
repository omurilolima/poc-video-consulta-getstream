# Plano de PoC — GetStream Video (NestJS + React Native + Angular)

> **Referência:** [SPIKE.md §9](../../SPIKE.md#9-escopo-do-poc-futuro-fase-pós-spike-arquitetural) · [ADR-003](../adr/ADR-003-provider-videoconsulta.md)
>
> **Provider avaliado:** GetStream Video
> **Stack:** NestJS (backend) · React Native / Expo (mobile, paciente) · Angular / `@stream-io/video-client` (web, médico)
> **Objetivo:** confirmar que a nova arquitetura entrega sessão estável e anti-desencontro **by design**

---

## 1. Escopo — Épicos e histórias

> Formato: **Épico** → **História** (`POC-XX`) → critérios de aceite → status.
> Referência SPIKE: C1–C4 conforme §3.2 e §0.5.

### Resumo

| Épico | Título | Prioridade | Status |
|-------|--------|------------|--------|
| [EPIC-POC-01](#epic-poc-01--backend--máquina-de-estados) | Backend — máquina de estados | Alta | ✅ |
| [EPIC-POC-02](#epic-poc-02--anti-desencontro-c1) | Anti-desencontro (C1) | Alta | ✅ |
| [EPIC-POC-03](#epic-poc-03--reconexão-em-rede-instável-c3) | Reconexão em rede instável (C3) | Alta | ✅ |
| [EPIC-POC-04](#epic-poc-04--veto-pós-encerramento-c4) | Veto pós-encerramento (C4) | Alta | ✅ |
| [EPIC-POC-05](#epic-poc-05--timeout-de-lobby-c2) | Timeout de lobby (C2) | Média | ✅ |
| [EPIC-POC-06](#epic-poc-06--clientes-de-integração) | Clientes de integração | Alta / Média | ✅ |

---

### EPIC-POC-01 — Backend — máquina de estados

**Objetivo:** o backend NestJS é a única fonte da verdade da sessão; integra GetStream Video server-side.

**Referência técnica:** §3 (máquina de estados) · §4 (API)

#### POC-01 — Criar sessão e call GetStream

**Como** sistema de videoconsulta  
**Quero** criar uma sessão com `sessionId`, `callId` e call no GetStream  
**Para** permitir que paciente e médico entrem na mesma consulta

**Critérios de aceite:**
- [x] `POST /sessions` retorna `sessionId`, `callId`, `callType`
- [x] Estado inicial `criada`
- [x] Gravação desabilitada na call (`recording: disabled`)

**Status:** ✅ · **Evidência:** `backend/src/video/video.service.ts`

---

#### POC-02 — Emitir token por participante e papel

**Como** cliente (mobile ou web)  
**Quero** obter token GetStream para um `userId` e `role` (`paciente` \| `medico`)  
**Para** ingressar na call com credencial válida

**Critérios de aceite:**
- [x] `GET /sessions/:id/token?userId=X&role=Y` retorna `token`, `callId`, `callType`, `apiKey`
- [x] Backend faz `upsertUsers` antes de emitir token
- [x] Participante registrado em `session.participants` ao solicitar token

**Status:** ✅

---

#### POC-03 — Consultar estado da sessão (polling)

**Como** cliente  
**Quero** consultar o estado atual da sessão periodicamente  
**Para** renderizar UI coerente com o backend (lobby, mídia pendente, ativa, encerrada, vetada)

**Critérios de aceite:**
- [x] `GET /sessions/:id` retorna `state`, `participants`, timestamps
- [x] Clientes fazem poll a cada ~2–3 s

**Status:** ✅

---

#### POC-04 — Webhooks GetStream

**Como** backend  
**Quero** processar webhooks do GetStream (`joined`, `left`, `ended`)  
**Para** transitar estados quando ngrok/webhook estiver configurado

**Critérios de aceite:**
- [x] `POST /webhooks/getstream` verifica assinatura
- [x] `call.session_participant_joined` → `aguardando` / `midia_pendente`
- [x] `call.session_participant_left` → `midia_pendente` (se `ativa`)
- [x] `call.session_ended` → `encerrada`

**Status:** ✅ · **Obs.:** na PoC, `/joined` e `/left` complementam quando webhook indisponível

---

### EPIC-POC-02 — Anti-desencontro (C1)

**Objetivo:** transitar para `ativa` somente quando **ambos** os participantes confirmam mídia bidirecional recebida.

**Referência SPIKE:** §3.2.1 · cenário **C1**

#### POC-05 — Transição de lobby até mídia pendente

**Como** backend  
**Quero** transitar `criada → aguardando → midia_pendente` conforme participantes entram  
**Para** refletir que dois lados estão na sala antes de validar mídia

**Critérios de aceite:**
- [x] 1º join → `aguardando`
- [x] 2º join → `midia_pendente`
- [x] Sinal via webhook ou `POST /sessions/:id/joined?userId=X`

**Status:** ✅ · **Evidência:** logs 2026-05-25 · `scripts/test-poc-scenarios.sh`

---

#### POC-06 — Gate de media-ready antes de `ativa`

**Como** backend  
**Quero** só transitar `midia_pendente → ativa` quando **≥2 participantes** sinalizarem `/media-ready`  
**Para** evitar “conectado na UI” sem áudio/vídeo bidirecional (anti-desencontro)

**Critérios de aceite:**
- [x] Cliente chama `/media-ready` ao detectar `publishedTracks` remoto (áudio + vídeo)
- [x] Backend exige os **dois** participantes com `mediaReady=true`
- [x] Com apenas um sinal, estado permanece `midia_pendente`
- [x] 1 participante sozinho **não** vai a `ativa`

**Status:** ✅ · **Evidência:** `scripts/test-poc-scenarios.sh`

---

#### POC-07 — Chamada bidirecional visível (mobile + web)

**Como** paciente (mobile) e médico (web)  
**Quero** ver e ouvir o outro participante após estado `ativa`  
**Para** validar integração ponta a ponta do fluxo C1

**Critérios de aceite:**
- [x] Vídeo e áudio visíveis em ambos os lados (teste manual web + mobile)
- [ ] Sessão estável por **5 minutos** sem queda (teste prolongado pendente)

**Status:** ✅ parcial · **Pendente:** POC-07 item 5 min

---

### EPIC-POC-03 — Reconexão em rede instável (C3)

**Objetivo:** queda de rede do paciente mobile não corrompe a sessão; reconexão na mesma `callId` restaura `ativa`.

**Referência SPIKE:** §3.2.2 · cenário **C3**

#### POC-08 — Queda transita `ativa → midia_pendente`

**Como** backend  
**Quero** voltar para `midia_pendente` quando um participante sai durante `ativa`  
**Para** exigir nova confirmação de mídia após reconexão

**Critérios de aceite:**
- [x] Webhook `participant_left` ou `POST /sessions/:id/left?userId=X` → `midia_pendente`
- [x] `mediaReady` zerado para **todos** os participantes
- [x] Nenhuma sessão duplicada criada

**Status:** ✅ · **Evidência:** `scripts/test-poc-scenarios.sh`

---

#### POC-09 — Reconexão na mesma call

**Como** paciente mobile  
**Quero** reentrar na mesma consulta após perda de rede (modo avião)  
**Para** retomar a videoconsulta sem novo `sessionId`

**Critérios de aceite:**
- [x] Reentrada possível na mesma `callId` (token novo se expirado)
- [x] Clientes re-sinalizam `/media-ready` após detectar remoto novamente
- [x] Backend transita `midia_pendente → ativa` após ambos sinalizarem
- [x] Cliente remoto detecta queda e chama `/left` quando webhook indisponível

**Status:** ✅ · **Evidência:** script + `CallScreen.tsx` / `call.component.ts`

---

### EPIC-POC-04 — Veto pós-encerramento (C4)

**Objetivo:** médico pode vetar reentrada do paciente após encerramento.

**Referência SPIKE:** §0.5 · cenário **C4**

#### POC-10 — Encerrar com veto

**Como** médico  
**Quero** encerrar a consulta com `veto=true`  
**Para** impedir que o paciente retorne à mesma sessão

**Critérios de aceite:**
- [x] `POST /sessions/:id/end?veto=true` → estado `vetada`
- [x] Backend chama `call.blockUser` para pacientes via GetStream SDK
- [x] Backend chama `call.end()`

**Status:** ✅ · **Evidência:** `scripts/test-poc-scenarios.sh`

---

#### POC-11 — Bloquear reentrada do paciente

**Como** paciente vetado  
**Não devo** obter novo token para a sessão  
**Para** garantir enforce da regra de negócio

**Critérios de aceite:**
- [x] `GET /sessions/:id/token?role=paciente` retorna **403** em sessão `vetada`
- [x] Médico ainda pode obter token (laboratório)
- [ ] GetStream rejeita join do paciente bloqueado (validar manualmente)

**Status:** ✅ parcial · **Pendente:** enforce no SDK GetStream

---

### EPIC-POC-05 — Timeout de lobby (C2)

**Objetivo:** encerrar sessões órfãs para evitar billing desnecessário.

**Referência SPIKE:** §0.5 · cenário **C2**

#### POC-12 — Timeout automático no lobby

**Como** backend  
**Quero** encerrar sessões em `aguardando` ou `midia_pendente` após `LOBBY_TIMEOUT_MS`  
**Para** fazer cleanup de consultas em que o segundo participante nunca entrou

**Critérios de aceite:**
- [x] Após `T_lobby` (padrão 2 min, configurável) → `encerrada`
- [x] `call.end()` invocado no timeout
- [x] Timeout cancelado ao atingir `ativa`

**Status:** ✅ · **Evidência:** logs backend 2026-05-25 (sessão `4aefa7cc…`)

---

### EPIC-POC-06 — Clientes de integração

**Objetivo:** permitir teste bipartido médico (web) + paciente (mobile) contra o backend PoC.

#### POC-13 — App mobile paciente (Expo / React Native)

**Como** paciente  
**Quero** entrar numa consulta pelo app mobile  
**Para** validar SDK GetStream em Android (dev build)

**Critérios de aceite:**
- [x] Lobby: criar sessão (2 passos) ou entrar com `sessionId` compartilhado
- [x] `StreamVideo` + `StreamCall` antes do join; permissões Android
- [x] Sinaliza `/joined`, `/left`, `/media-ready`; poll de estado
- [x] Controles Stream com safe-area; sem PiP flutuante (crash Reanimated)

**Status:** ✅ · **Ref.:** `mobile/README.md`

---

#### POC-14 — SPA web médico (Angular)

**Como** médico  
**Quero** criar sessão e entrar na chamada pelo browser  
**Para** testar fluxo bipartido com paciente mobile

**Critérios de aceite:**
- [x] Lobby: criar sessão, copiar ID, entrar quando pronto
- [x] `call.join` + `camera.enable` / `microphone.enable`
- [x] Sinaliza `/joined`, `/left`, `/media-ready`; toggles mic/câmera
- [x] Trata `publishedTracks` numérico e string na detecção de mídia

**Status:** ✅ · **Ref.:** `web/README.md`

---

#### POC-15 — Script de testes automatizados da máquina de estados

**Como** desenvolvedor  
**Quero** executar testes C1, C3 e C4 contra a API  
**Para** regressão rápida sem dispositivos físicos

**Critérios de aceite:**
- [x] `./scripts/test-poc-scenarios.sh` passa 11/11 asserts
- [x] Cobre fluxo completo C1, reconexão C3, veto C4

**Status:** ✅

---

### Fora do escopo

| Item | Motivo |
|------|--------|
| Reproduzir ou investigar desencontros do legado (Twilio) | PoC valida a solução nova, não o legado |
| Grace period C3 | Adiado (SPIKE §3.2.2) |
| Gravação de vídeo | Fora de escopo (SPIKE §0.4) |
| Carga simultânea (pico) | Fase posterior |
| Hardening de segurança (ex.: não expor `apiKey` ao browser em produção) | Laboratório — revisar em produção |

---

## 2. Arquitetura da PoC

### Estrutura de pastas

```
poc-video-conferencia/
├── .env
├── SPIKE.md
├── docs/poc/
│   └── PLANO-POC-PROVIDER.md
├── backend/
│   └── src/
│       └── video/
│           ├── video.module.ts
│           ├── video.controller.ts
│           ├── webhook.controller.ts    # POST /webhooks/getstream
│           ├── video.service.ts
│           └── session.entity.ts
├── web/                        # Angular — médico
│   └── src/app/
├── mobile/                     # Expo — paciente (e testes dois papéis)
│   ├── App.tsx
│   ├── screens/
│   └── services/
│       └── api.ts
└── README.md
```

### Dependências

| Camada | Pacote | Finalidade |
|--------|--------|------------|
| Backend | `@stream-io/node-sdk` | SDK GetStream Video (server-side) |
| Backend | `@nestjs/config` | Leitura do `.env` |
| Mobile | `@stream-io/video-react-native-sdk` | SDK GetStream Video (React Native) |
| Mobile | `@stream-io/react-native-webrtc`, `react-native-safe-area-context`, … | Peer / layout / permissões |
| Mobile | `expo`, `expo-dev-client` | scaffold + development build |
| Web | `@angular/*` | SPA médico |
| Web | `@stream-io/video-client` | SDK GetStream Video (browser) |

### Credenciais (`.env`)

```
getstream_api_key=...
getstream_api_secret=...      # nunca exposto ao cliente
getstream_app_id=...
```

---

## 3. Máquina de estados

Conforme §7 do SPIKE.md — o **backend é a única fonte da verdade**.

```
criada → aguardando → mídia_pendente → ativa → encerrada
                                              ↘ vetada
```

| Evento | Responsável | Transição |
|--------|-------------|-----------|
| Webhook `call.session_participant_joined` (1º participante) | GetStream → backend | `criada → aguardando` |
| Webhook `call.session_participant_joined` (2º participante) | GetStream → backend | `aguardando → mídia_pendente` |
| **`POST /sessions/:id/joined?userId=…`** (após ingresso efetivo no SDK) | Cliente RN/Web → backend | **PoC:** mesmo efeito que os webhooks de join quando o webhook ainda não está disponível ou chega tarde |
| **`POST /sessions/:id/left?userId=…`** (queda/saída detectada no SDK) | Cliente RN/Web → backend | **PoC:** mesmo efeito que `call.session_participant_left` (C3) |
| POST `/sessions/:id/media-ready` (ambos os participantes, estado `midia_pendente`) | Cliente → backend | `mídia_pendente → ativa` (exige ≥2 participantes) |
| Webhook `call.session_participant_left` (1 participante sai) | GetStream → backend | `ativa → mídia_pendente` |
| Webhook `call.session_ended` | GetStream → backend | `→ encerrada` |
| POST `/sessions/:id/end?veto=true` | Cliente → backend | `→ vetada` |

> **Anti-desencontro:** os clientes só chamam `/media-ready` quando o lado remoto publica (ou quando o modelo de dados do SDK indica áudio+vídeo), conforme implementação atual (vide `publishedTracks` — na web pode refletir enum numérico ou equivalente textual). O backend só transita para `ativa` após confirmação dos **dois** participantes.

---

## 4. API Backend

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/sessions` | Cria sessão + call GetStream; retorna `sessionId` e `callId` |
| `GET` | `/sessions/:id/token?userId=X&role=Y` | Emite token GetStream para o participante |
| `POST` | `/sessions/:id/media-ready?userId=X` | Sinaliza que mídia bidirecional está fluindo para este participante |
| `POST` | `/sessions/:id/end?veto=false\|true` | Encerra (e opcionalmente veta) a sessão |
| `GET` | `/sessions/:id` | Retorna estado atual (polling a cada ~2–3 s) |
| `POST` | `/sessions/:id/joined?userId=X` | Sinalização de join no cliente (complementar aos webhooks na PoC) |
| `POST` | `/sessions/:id/left?userId=X` | Sinalização de saída/queda (C3, complementar ao webhook na PoC) |
| `POST` | `/webhooks/getstream` | Recebe e processa eventos do GetStream |

---

## 5. Fluxo Mobile (React Native)

1. (Lobby) Fluxo opcional em dois passos ao **criar** sessão: exibir/compartilhar `sessionId`, depois **entrar**.
2. App solicita token via `GET /sessions/:id/token?userId=...&role=...`
3. `StreamVideo` + `StreamCall` devem estar ativos antes do join efetivo; `call.join` após permissões Android quando aplicável
4. Após ingresso efetivo: `POST /sessions/:id/joined` quando o cliente notifica entrada (alinhado aos webhooks na PoC)
5. Ao detectar publicação de áudio e vídeo do **outro** participante (`publishedTracks`) → `POST /sessions/:id/media-ready`
6. Faz poll em `GET /sessions/:id` a cada ~2 s; renderiza o estado atual:
   - `aguardando` → tela de espera
   - `mídia_pendente` → "aguardando confirmação de mídia..."
   - `ativa` → chamada ativa
   - `vetada` → "consulta encerrada, reentrada bloqueada"
7. Botão "Encerrar" → `POST /sessions/:id/end`

---

## 5bis. Fluxo Web (Angular — médico)

1. Lobby: criar sessão (`POST /sessions` + token médico); copiar/compartilhar `sessionId` para o paciente; **Entrar na chamada** quando desejado
2. `call.join`; `camera.enable()` / `microphone.enable()`
3. `notifyJoined`; ao ver remoto com áudio+vídeo publicados → `media-ready`
4. Polling de estado contínuo; botões toggle mic/câmera

---

## 6. Roteiro de testes (por história)

> Detalhamento operacional dos critérios de aceite. Status consolidado na §1.

### C1 — POC-05, POC-06, POC-07

**Pré-condição:** médico em `web/`, paciente em `mobile/` (ou dois mobiles com roles distintos).

**Passos:**
1. `POST /sessions` → anotar `sessionId`
2. Paciente: token + join → backend `aguardando`
3. Médico: token + join → backend `midia_pendente`
4. Ambos detectam remoto com áudio+vídeo → `/media-ready` → backend `ativa`
5. Verificar mídia bidirecional por ≥5 min (POC-07 pendente)

**Evidência:**

| História | Verificação | Resultado | Data |
|----------|-------------|-----------|------|
| POC-05 | `aguardando` após 1º join | ✅ | 2026-05-25 |
| POC-05 | `midia_pendente` após 2º join | ✅ | 2026-05-25 |
| POC-06 | `ativa` só após ambos `/media-ready` | ✅ | 2026-05-25 |
| POC-07 | Vídeo/áudio em ambos os lados | ✅ | 2026-05-25 |
| POC-07 | Estável 5 min | ⬜ | |

---

### C3 — POC-08, POC-09

**Pré-condição:** sessão `ativa` com dois participantes.

**Passos:**
1. Modo avião no dispositivo A → backend `midia_pendente` (webhook ou `/left`)
2. Reativar rede; A reentra na mesma call
3. Ambos re-sinalizam `/media-ready` → backend `ativa`

**Evidência:**

| História | Verificação | Resultado | Data |
|----------|-------------|-----------|------|
| POC-08 | `ativa → midia_pendente` na queda | ✅ | 2026-05-25 |
| POC-09 | Reentrada na mesma `callId` | ✅ | 2026-05-25 |
| POC-09 | `midia_pendente → ativa` após reconexão | ✅ | 2026-05-25 |
| POC-08 | Sem sessão duplicada | ✅ | 2026-05-25 |

---

### C4 — POC-10, POC-11

**Pré-condição:** sessão `ativa` ou `aguardando`.

**Passos:**
1. Médico: `POST /sessions/:id/end?veto=true` → `vetada`
2. Paciente tenta novo token → **403**
3. Validar bloqueio no GetStream (POC-11 pendente)

**Evidência:**

| História | Verificação | Resultado | Data |
|----------|-------------|-----------|------|
| POC-10 | Estado `vetada` | ✅ | 2026-05-25 |
| POC-11 | HTTP 403 para paciente | ✅ | 2026-05-25 |
| POC-11 | GetStream rejeita join | ⬜ | |

---

### C2 — POC-12

**Pré-condição:** apenas um participante entra; segundo não aparece.

**Passos:**
1. Paciente entra → `aguardando`
2. Aguardar `LOBBY_TIMEOUT_MS` (2 min) → `encerrada` + `call.end()`

**Evidência:**

| História | Verificação | Resultado | Data |
|----------|-------------|-----------|------|
| POC-12 | Timeout `aguardando → encerrada` | ✅ | 2026-05-25 |
| POC-12 | Call GetStream encerrada | ✅ | 2026-05-25 |

---

## 7. Registro de resultados (por história)

| História | Épico | Cenário | Resultado | Data | Evidência |
|----------|-------|---------|-----------|------|-----------|
| POC-05 | EPIC-POC-02 | C1 lobby | ✅ | 2026-05-25 | script + manual |
| POC-06 | EPIC-POC-02 | C1 anti-desencontro | ✅ | 2026-05-25 | `scripts/test-poc-scenarios.sh` |
| POC-07 | EPIC-POC-02 | C1 5 min estável | ⬜ | | manual prolongado |
| POC-08 | EPIC-POC-03 | C3 queda | ✅ | 2026-05-25 | script |
| POC-09 | EPIC-POC-03 | C3 reconexão | ✅ | 2026-05-25 | script + clientes |
| POC-10 | EPIC-POC-04 | C4 veto | ✅ | 2026-05-25 | script |
| POC-11 | EPIC-POC-04 | C4 block GetStream | ⬜ | | manual |
| POC-12 | EPIC-POC-05 | C2 timeout | ✅ | 2026-05-25 | logs backend |
| POC-13 | EPIC-POC-06 | Mobile RN | ✅ | 2026-05-25 | sessões reais |
| POC-14 | EPIC-POC-06 | Web Angular | ✅ | 2026-05-25 | sessões reais |
| POC-15 | EPIC-POC-06 | Script regressão | ✅ | 2026-05-25 | 11/11 asserts |

---

## 8. Conclusão (preencher ao final)

> **Provider avaliado:** GetStream Video
> **Período:** ___
> **Responsável:** ___

### Resultado geral

- [ ] Todos os cenários de alta prioridade provados
- [ ] Integração NestJS + clientes SDK (RN + navegador) viável sem bloqueadores
- [ ] Comportamento de reconexão C3 adequado para mobile
- [ ] Custo de uso compatível com o baseline do SPIKE.md §3.5

### Pontos positivos

_Preencher após execução._

### Limitações / gaps encontrados

_Preencher após execução._

### Recomendação

- [ ] Aprovar GetStream Video como provider (ADR-003 → Aceito)
- [ ] Requer ajustes antes de aprovar
- [ ] Recomendar avaliação de provider alternativo

---

## Histórico

| Data | Autor | Alteração |
|------|-------|-----------|
| 2026-05-25 | | Criação do plano de PoC |
| 2026-05-25 | | Stack Angular (médico), endpoint `/joined`, alinhamento de estrutura e fluxos ao repositório atual |
| 2026-05-25 | | Escopo reestruturado em Épicos (EPIC-POC-01…06) e Histórias (POC-01…15) |
