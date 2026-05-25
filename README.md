# POC — Videoconsulta GetStream Video

> **Referência:** [SPIKE.md §9](./SPIKE.md#9-escopo-do-poc-futuro-fase-pós-spike-arquitetural) · [Plano detalhado da PoC](./docs/poc/PLANO-POC-PROVIDER.md)

Stack: **NestJS** (backend) + **React Native / Expo** (paciente no mobile) + **Angular** (médico no browser, opcional)  
Provider: **GetStream Video** (`@stream-io/node-sdk` · `@stream-io/video-react-native-sdk` · `@stream-io/video-client`)

---

## Documentação por módulo

| Módulo | README | Conteúdo |
|--------|--------|----------|
| Backend (NestJS) | [backend/README.md](./backend/README.md) | API, máquina de estados, webhook, `.env`, `notifyJoined` |
| Mobile (React Native) | [mobile/README.md](./mobile/README.md) | Dev build, URL do backend (emulador / LAN / USB), fluxo paciente |
| Web (Angular — médico) | [web/README.md](./web/README.md) | `ng serve`, `BACKEND_URL`, fluxo criar sessão → copiar ID → entrar |

---

## Estrutura

```
poc-video-conferencia/
├── .env                              # credenciais GetStream (não comitar — ver .gitignore)
├── .gitignore
├── SPIKE.md
├── docs/poc/PLANO-POC-PROVIDER.md
├── backend/                          # NestJS — fonte da verdade da sessão + GetStream server-side
│   └── src/video/
├── web/                              # Angular — UI do médico (PoC)
│   └── src/app/
├── mobile/                           # Expo — UI do paciente (também pode testar os dois papéis)
│   ├── services/api.ts
│   └── screens/
└── README.md                         # este arquivo
```

---

## Configuração rápida

### 1. Credenciais GetStream

O arquivo `.env` na raiz contém as credenciais. O backend as lê via `envFilePath` apontando para a raiz do workspace.

```
getstream_api_key=...
getstream_api_secret=...
getstream_app_id=...
```

> Na PoC o backend devolve `apiKey` aos clientes junto ao token para o SDK GetStream — aceitável para laboratório; em produção avaliar modelo de segurança.

### 2. Rodar o backend

```bash
cd backend && npm install && npm run start:dev
```

Sobe em `http://localhost:3000`. Detalhes: [backend/README.md](./backend/README.md).

### 3. Rodar o médico (web) — recomendado na PoC

```bash
cd web && npm install && npm start
```

Abrir `http://localhost:4200`. O próprio projeto documenta uso de `http://localhost:3000` no `api.service.ts`; se o browser não estiver na mesma máquina que o Nest, configure o URL no código ou use túnel.

### 4. Rodar o paciente (mobile)

Este projeto usa módulos nativos (WebRTC). **Expo Go não é suportado** — é necessário *development build*:

```bash
cd mobile && npm install && npx expo run:android
```

Depois, no dia a dia: `npx expo start`. Ajuste **`DEV_MACHINE_LAN_IP`** em `mobile/services/api.ts` se o celular físico estiver na Wi‑Fi LAN (Metro já mostra o IP do host nos logs). Detalhes: [mobile/README.md](./mobile/README.md).

### 5. Webhook no GetStream Dashboard

Útil para C2/C3 além dos sinais explícitos `POST .../joined` da PoC:

```bash
ngrok http 3000
# use https://xxx.ngrok.io/webhooks/getstream no dashboard
```

Eventos: `call.session_participant_joined`, `call.session_participant_left`, `call.session_ended`.

---

## Fluxo típico de teste (médico web + paciente mobile)

1. Web: criar nova sessão → copiar/compartilhar o `sessionId` (fluxo em dois passos: só entra na chamada quando estiver pronto).
2. Mobile: colar `sessionId`, role **paciente**, entrar na sessão.
3. Web: clicar **Entrar na chamada** com os dados já obtidos ao criar a sessão.
4. Aceitar permissões de câmera/microfone em ambos quando o SO pedir.

---

## Escopo — Épicos e histórias

Documentação completa em [docs/poc/PLANO-POC-PROVIDER.md §1](./docs/poc/PLANO-POC-PROVIDER.md#1-escopo--épicos-e-histórias).

| Épico | Cenário SPIKE | Histórias |
|-------|---------------|-----------|
| **EPIC-POC-01** Backend — máquina de estados | Infra | POC-01…04 |
| **EPIC-POC-02** Anti-desencontro | **C1** | POC-05…07 |
| **EPIC-POC-03** Reconexão mobile | **C3** | POC-08…09 |
| **EPIC-POC-04** Veto pós-encerramento | **C4** | POC-10…11 |
| **EPIC-POC-05** Timeout de lobby | **C2** | POC-12 |
| **EPIC-POC-06** Clientes de integração | — | POC-13…15 |

Testes automatizados: `./scripts/test-poc-scenarios.sh`
