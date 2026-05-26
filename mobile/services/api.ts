import { Platform } from "react-native";

// IP LAN do computador de desenvolvimento.
// Atualizar se o IP mudar (ver saída do `npx expo start`).
const DEV_MACHINE_LAN_IP = "192.168.178.119";

function resolveBackendUrl(): string {
  if (Platform.OS !== "android") return "http://localhost:3000";

  const constants = Platform.constants as Record<string, unknown>;
  const model = String(constants?.Model ?? "");
  const fingerprint = String(constants?.Fingerprint ?? "");
  const isEmulator =
    model.includes("sdk") ||
    model.includes("Emulator") ||
    fingerprint.includes("generic");

  if (isEmulator) return "http://10.0.2.2:3000";
  // Celular físico via WiFi: usa IP LAN (sem adb reverse)
  return `http://${DEV_MACHINE_LAN_IP}:3000`;
}

export const BACKEND_URL = resolveBackendUrl();

export type SessionState =
  | "criada"
  | "aguardando"
  | "midia_pendente"
  | "ativa"
  | "encerrada"
  | "vetada";

export interface SessionParticipant {
  userId: string;
  role: "paciente" | "medico";
  joinedAt?: string;
  mediaReady: boolean;
}

export interface SessionDto {
  id: string;
  callId: string;
  callType: string;
  state: SessionState;
  participants: SessionParticipant[];
  createdAt: string;
  updatedAt: string;
}

export interface TokenDto {
  token: string;
  callId: string;
  callType: string;
  apiKey: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const method = (options?.method ?? "GET").toUpperCase();
  const body = options?.body;
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };

  // NestJS falha ao parsear POST com Content-Type: json e body vazio (comum no React Native fetch)
  if (body != null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      method,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timeout ao conectar em ${BACKEND_URL}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  createSession(): Promise<{
    sessionId: string;
    callId: string;
    callType: string;
  }> {
    return request("/sessions", { method: "POST", body: "{}" });
  },

  getSession(sessionId: string): Promise<SessionDto> {
    return request(`/sessions/${sessionId}`);
  },

  getToken(
    sessionId: string,
    userId: string,
    role: "paciente" | "medico",
  ): Promise<TokenDto> {
    return request(
      `/sessions/${sessionId}/token?userId=${encodeURIComponent(userId)}&role=${role}`,
    );
  },

  notifyJoined(sessionId: string, userId: string): Promise<SessionDto> {
    return request(
      `/sessions/${sessionId}/joined?userId=${encodeURIComponent(userId)}`,
      { method: "POST", body: "{}" },
    );
  },

  notifyLeft(sessionId: string, userId: string): Promise<SessionDto> {
    return request(
      `/sessions/${sessionId}/left?userId=${encodeURIComponent(userId)}`,
      { method: "POST", body: "{}" },
    );
  },

  signalMediaReady(
    sessionId: string,
    userId: string,
  ): Promise<{ state: SessionState }> {
    return request(
      `/sessions/${sessionId}/media-ready?userId=${encodeURIComponent(userId)}`,
      { method: "POST", body: "{}" },
    );
  },

  endSession(sessionId: string, veto: boolean): Promise<SessionDto> {
    return request(`/sessions/${sessionId}/end?veto=${veto}`, {
      method: "POST",
      body: "{}",
    });
  },
};
