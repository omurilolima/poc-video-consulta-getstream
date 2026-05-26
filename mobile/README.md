# Mobile — POC Videoconsulta GetStream

App **React Native (Expo)** usado principalmente como **paciente** na PoC (`web/` = médico). Também permite testar **os dois papéis** em dois devices.

Consome o [backend NestJS](../backend/README.md).

---

## Responsabilidades

- Criar ou entrar numa sessão (fluxo lobby em **dois passos** ao criar: mostrar/compartilhar `sessionId`, depois **Entrar na chamada**)
- Obter token GetStream via backend e ingressar na call (`StreamVideo` + `StreamCall` sempre montados; join em componente interno)
- Solicitar permissões **CAMERA** e **RECORD_AUDIO** no Android **antes** do join (falha com mensagem clara se negadas)
- Ingressar na call na ordem correta: `callManager.start()` → `call.join()` → `camera.enable()` / `microphone.enable()`
- Renderizar vídeo local/remoto com **`RTCView`** e assinar track remoto explicitamente quando necessário
- Detectar quando o outro lado publicou áudio+vídeo e chamar `POST /sessions/:id/media-ready`
- Polling `GET /sessions/:id`; encerramento e veto C4 (se role `medico`)

---

## Estrutura

```
mobile/
├── App.tsx
├── services/api.ts           # BACKEND_URL + cliente REST
├── screens/
│   ├── LobbyScreen.tsx
│   └── CallScreen.tsx       # join → enable mídia; RTCView + assinatura remota; overlay debug opcional
├── app.json                 # newArchEnabled: false, minSdkVersion 24 (expo-build-properties)
├── android/                 # permissões CAMERA / RECORD_AUDIO, newArchEnabled=false — rebuild após mudanças nativas
└── README.md                 # este arquivo
```

---

## URL do backend (`services/api.ts`)

| Contexto Android | URL usada | Ajuste |
|------------------|-----------|--------|
| Emulador | `http://10.0.2.2:3000` | Automático |
| Celular físico (Wi‑Fi) | `http://<DEV_MACHINE_LAN_IP>:3000` | Edite **`DEV_MACHINE_LAN_IP`** no arquivo (veja IP no `npx expo start`) |
| `localhost` quando documentado antes | uso com **`adb reverse tcp:3000 tcp:3000`** | Alternativa ao IP LAN |

iOS/outras plataformas no arquivo: tipicamente `http://localhost:3000`.

---

## Cenário recomendado: médico na web + paciente no celular

1. `cd backend && npm run start:dev`
2. `cd web && npm start` → médico cria sessão, copia `sessionId`, entra na chamada quando conveniente.
3. `cd mobile && npx expo start` (+ dev build instalado): paciente cola `sessionId` e entra.

---

## Expo Go e development build

> **Expo Go não é compatível** (`@stream-io/react-native-webrtc` é nativo).

```bash
cd mobile && npm install
npx expo run:android    # primeira vez ou após mudanças nativas (plugins, permissões, safe-area, etc.)
npx expo start          # uso diário
```

---

## Fluxo no app

### Lobby

- **Criar nova sessão:** `POST /sessions` + `GET …/token` → mostra card com Session ID (**Compartilhar** ou seleção manual) → **Entrar na chamada**.
- **Entrar em sessão existente:** cola `sessionId` (stripping de `:` acidental no fim pode ser aplicado no cliente).
- **Role:** paciente ou médico (na PoC o médico costuma estar na web).

### Chamada

1. **Permissões Android** (`PermissionsAndroid.requestMultiple`) — câmera e microfone obrigatórios.
2. **`callManager.start()`** — roteamento de áudio antes do join.
3. **`call.join({ create: true })`** — estado `JOINED` é pré-requisito para publicar mídia no SDK.
4. **`call.camera.enable()` / `call.microphone.enable()`** — publicação explícita após o join.
5. **`api.notifyJoined`** — sinaliza backend (C1/C2/C3 sem depender só de webhook).

**Renderização de vídeo**

- Local: `useCameraState().mediaStream` ou `localParticipant.videoStream` em **`RTCView`** (PiP com `zOrder`).
- Remoto: `remoteParticipant.videoStream` em **`RTCView`** fullscreen.
- Se o remoto publica track de vídeo mas `videoStream` continua `undefined`, o layout chama `call.state.updateParticipant` + `updateParticipantTracks` e `trackSubscriptionManager.apply(DebounceType.IMMEDIATE)` (dynascale/subscription do SDK).
- Overlay de debug nos tiles: `tracks: … | stream: sim/nao` — útil durante desenvolvimento.

**UI**

- Controles nativos do Stream envoltos com **`paddingBottom`** via `useSafeAreaInsets` (+ margem extra) para não ficarem sob a barra de navegação do Android.
- Ao detectar **`publishedTracks`** do remoto com áudio **e** vídeo → `POST /media-ready`.
- Badge de estado via polling (~2 s). **Encerrar** / **Vetar (C4)** se médico no mobile.

**Compatibilidade nativa**

- **`newArchEnabled: false`** — React Native New Architecture desligada por compatibilidade com WebRTC.
- **`minSdkVersion: 24`** via plugin `expo-build-properties`.
- Rebuild obrigatório após alterar `app.json`, plugins ou `android/`.

---

## Dependências relevantes

| Pacote | Uso |
|--------|-----|
| `@stream-io/video-react-native-sdk` | UI + SDK GetStream RN |
| `@stream-io/react-native-webrtc` | WebRTC nativo |
| `expo-dev-client` | Development builds |
| `react-native-safe-area-context` | Insets para overlay / controles |
| `PermissionsAndroid` (React Native) | Câmera/mic antes do join no Android |

---

## Testando cenários PoC

| Cenário | Ação |
|--------|------|
| C1 | Web + mobile; ambos com mídia; estado `ativa` só após ambos `/media-ready` |
| C3 | Sessão ativa → rede cai → reconectar e novo fluxo de mídia |
| C4 | Encerrar com veto como médico; paciente novo token → 403 |
| C2 | Só um lado entra; aguardar `LOBBY_TIMEOUT_MS` |

Roteiro detalhado: [docs/poc/PLANO-POC-PROVIDER.md](../docs/poc/PLANO-POC-PROVIDER.md).
