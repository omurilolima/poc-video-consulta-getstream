# web — Interface do Médico (Angular)

Cliente **Angular** para o papel **médico** durante a videoconsulta na PoC.  
O paciente usa o app em [../mobile](../mobile).

---

## Stack

- Angular (standalone components)
- `@stream-io/video-client` — cliente GetStream Video no browser (`StreamVideoClient`, `call.camera` / `call.microphone`)

---

## Responsabilidades

- Criar ou entrar como `medico` numa sessão existente
- Fluxo lobby em **dois passos** ao criar: obter dados → copiar/compartilhar `sessionId` → **Entrar na chamada**
- Renderizar vídeo local/remoto com **`call.bindVideoElement()` / `call.bindAudioElement()`** (directive `streamVideoTrack` / `streamAudioTrack`; fallback `videoStream` com `srcObject`)
- Botões para **alternar mic e câmera** (`call.microphone.toggle()` / `call.camera.toggle()`)
- Badge de estado com polling (~3 s) em `GET /sessions/:id`
- Encerrar / encerrar com veto C4 (`POST …/end`)
- Ao detectar remotos com áudio **e** vídeo publicados, chamar `signalMediaReady` (aceita tanto valores numéricos quanto equivalentes por nome no array `publishedTracks`, conforme comportamento da SDK na web)

---

## Pré-requisitos

- Node 18+
- Backend Nest em **`http://localhost:3000`** (padrão do `api.service.ts`)

> Se abrir o site **fora da máquina que roda o Nest**, altere a constante **`BACKEND_URL`** em `src/app/services/api.service.ts` para o IP/host acessível (ou use túnel/proxy).

---

## Instalação e execução

```bash
cd web && npm install && npm start
```

Abre em `http://localhost:4200` (Angular CLI).

---

## Fluxo de uso típico

1. Backend no ar.
2. Abrir Angular; `userId` padrão `medico-01` (alterável).
3. **Criar nova sessão** → aparece Session ID → **Copiar ID** ou avisar paciente manualmente → quando pronto **Entrar na chamada**.
4. No celular (`mobile`), paciente cola Session ID sem caractere `:` extra copiado do rótulo (o lobby pode sanitizar `: ` no final do ID).
5. Conceder permissões de mídia no browser na primeira vez.
6. Ao terminar: **Encerrar** ou **Encerrar + Vetar (C4)**.

---

## Mídia GetStream (web)

Ordem no `CallComponent`:

1. `StreamVideoClient` + `client.call(callType, callId)`
2. **`await call.join()`** — publicação só funciona com `CallingState === JOINED`
3. **`call.camera.enable()` / `call.microphone.enable()`** — publicação explícita
4. `api.notifyJoined`

**Renderização:** a directive `VideoStreamDirective` liga cada `<video>` / `<audio>` ao SDK via `bindVideoElement` / `bindAudioElement` (session id do participante + tipo de track). Atribuir só `srcObject` não dispara subscription/dynascale — por isso o binding explícito é obrigatório na PoC.

---

## Estrutura

```
src/app/
├── services/api.service.ts
├── directives/video-stream.directive.ts
├── lobby/
├── call/
├── app.ts
└── app.config.ts
```

## Segurança (PoC)

O backend pode devolver **`apiKey`** junto ao token para o SDK no browser — ok para laboratório; revisar antes de ambiente produtivo.
