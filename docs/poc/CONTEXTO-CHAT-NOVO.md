# Contexto PoC Videoconsulta — novo chat / handoff

Copie este arquivo ao abrir outra conversa com o agente para retomar o trabalho sem reexplicar tudo.

## O que é

PoC de videoconsulta com **GetStream Video**, **NestJS** (backend, fonte da verdade da sessão), **Expo/React Native** (paciente ou ambos papéis) e **Angular** (médico no browser).

- Spike / escopo alto nível: `SPIKE.md`
- Plano de PoC (Épicos + Histórias POC-01…15): `docs/poc/PLANO-POC-PROVIDER.md`
- READMEs: raiz `README.md`, `backend/README.md`, `mobile/README.md`, `web/README.md`

## Estado da sessão (backend)

Enums / transições: `backend/src/video/session.entity.ts`, lógica em `backend/src/video/video.service.ts`.

Ordem esperada em alto nível: `criada` → `aguardando` → `midia_pendente` → `ativa` → `encerrada` | `vetada`. Timeout lobby (C2): `LOBBY_TIMEOUT_MS` (padrão 2 min).

**Importante:** além dos webhooks GetStream, a PoC usa **`POST /sessions/:id/joined?userId=...`** após join no cliente e **`POST /sessions/:id/left?userId=...`** ao detectar queda (C3), quando webhook/ngrok não está configurado.

`POST /sessions/:id/media-ready?userId=...` só permite ir a `ativa` em `midia_pendente` quando **ambos** participantes marcaram média “pronta” (implementação atual baseada em `publishedTracks`: áudio + vídeo do remoto).

## API REST útil (`http://localhost:3000`)

| Uso | Método | Path |
|-----|--------|------|
| Criar sessão | POST | `/sessions` (body `{}`) |
| Estado | GET | `/sessions/:id` |
| Token GetStream | GET | `/sessions/:id/token?userId=X&role=paciente\|medico` |
| Join sinalizado (PoC) | POST | `/sessions/:id/joined?userId=X` |
| Saída sinalizada (PoC, C3) | POST | `/sessions/:id/left?userId=X` |
| Mídia recebendo remoto | POST | `/sessions/:id/media-ready?userId=X` |
| Fim / veto | POST | `/sessions/:id/end?veto=true|false` |
| Webhook | POST | `/webhooks/getstream` |

`.env` na raiz: `getstream_api_key`, `getstream_api_secret`, `getstream_app_id`.

## Clientes

### Mobile (`mobile/`)

- **Não usar Expo Go** — precisa dev build: `npx expo run:android` (mudanças nativas = rebuild).
- API: `mobile/services/api.ts`. **Android emulador:** `http://10.0.2.2:3000`. **Celular Wi‑Fi:** constante **`DEV_MACHINE_LAN_IP`** (alinhar ao IP da máquina que aparece no Metro). Alternativa físico: `adb reverse tcp:3000 tcp:3000` + localhost se aplicável conforme código.
- Lobby: criar sessão em **dois passos** (mostrar/compartilhar sessionId → “Entrar na chamada”).
- Chamada (`CallScreen.tsx`): `StreamVideoClient.getOrCreateInstance()` + `StreamCall`; fluxo **`callManager.start()` → `call.join()` → `camera.enable()` / `microphone.enable()`** (publicar antes do join não envia mídia ao SFU); permissões Android obrigatórias antes do join; vídeo com **`RTCView`** + assinatura remota via `updateParticipant` / `updateParticipantTracks` / `trackSubscriptionManager.apply(IMMEDIATE)` quando `publishedTracks` existe mas `videoStream` não; controles Stream com wrapper + `paddingBottom` via **safe-area insets**; `newArchEnabled: false`, `minSdkVersion: 24`.
- Tokens / user: servidor faz `upsertUsers` antes do token.

### Web médico (`web/`)

- `npm start` em `web/` → `http://localhost:4200`.
- `web/src/app/services/api.service.ts`: **`BACKEND_URL = http://localhost:3000`** — se o browser estiver em outra máquina, trocar para IP/host acessível.
- Fluxo igual: criar sessão → copiar ID → entrar quando pronto.
- **`publishedTracks`** no browser pode diferir da forma numérica do RN ao checar vídeo/áudio — código tenta cobrir enum/string para disparar `media-ready`.
- Ordem mídia: **`join()` → `camera.enable()` / `microphone.enable()`** (igual mobile).
- Vídeo: **`call.bindVideoElement` / `bindAudioElement`** na directive — não basta `srcObject`.
- Controles toggles mic/câmera na UI onde implementados (`call.microphone.toggle` / `camera.toggle`).

### Segurança PoC

Backend devolve `apiKey` com o token aos clientes — aceitável para laboratório; documentado como revisar em produção.

## Problemas já encontrados / decisões rápidas

- Erro RN “user token is not set”: **montar `StreamVideo`/`StreamCall` antes** do fluxo que faz `join` (wrapper interno loading/join/error).
- `useCall()` undefined se desestruturado errado de `useCallStateHooks` — passar instância **`call`** de `client.call(...)` como prop quando precisar de `camera.enable`.
- **Vídeo bidirecional (resolvido):** join antes de enable; web com `bindVideoElement`; mobile com `RTCView` + assinatura explícita de track remoto. Evitar `useEffect` que chama `updateParticipant` com dependência instável em `remoteParticipants` (causava loop “Maximum update depth exceeded”).
- **`ParticipantView` sem `style`:** pode renderizar 0×0; PoC usa `RTCView` com layout explícito.
- Clipboard nativo opcional falhou antes — lobby mobile usa **`Share`** + campo selecionável.
- Copiar session ID na web: risco de colar **`:`** no fim → sanitização em **`joinExisting`** (web e mobile onde aplicável).
- Android: permissões em runtime + `mobile/android/app/src/main/AndroidManifest.xml`; **`newArchEnabled=false`**; rede dev em `network_security_config.xml`.
- Dashboard GetStream demo **`livestream`:** credenciais/call type de teste — **não usar** na PoC (`default` + `.env` raiz).

## Como rodar rápido

```bash
# Terminal 1
cd backend && npm run start:dev

# Terminal 2 (médico)
cd web && npm install && npm start

# Terminal 3 (paciente — após primeira build Android)
cd mobile && npx expo start
# primeira vez ou mudanças nativas: npx expo run:android

# Testes automatizados da máquina de estados (C1, C3, C4)
./scripts/test-poc-scenarios.sh
```

Fluxo típico teste: web cria sessão → paciente mobile cola UUID → médico web entra na chamada quando quiser → aceitar permissões de mídia → **ambos devem ver e ouvir o outro**.

## Histórico desta série de chats

Documentação sincronizada com o código em várias iterações: Angular médico, endpoint `/joined`, layout RN, permissões Android, IPs LAN vs emulador, plano PoC com Angular. **Maio/2026:** corrigido bug de mídia bidirecional (ordem join/enable, binding web, RTCView + subscription mobile); PoC validada médico web + paciente mobile.

---

*Gerado como handoff; manter atualizado se o fluxo de arquitetura mudar.*
