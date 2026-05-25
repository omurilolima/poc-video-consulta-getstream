const BACKEND_URL = 'http://localhost:3000';

export type SessionState =
  | 'criada'
  | 'aguardando'
  | 'midia_pendente'
  | 'ativa'
  | 'encerrada'
  | 'vetada';

export interface SessionParticipant {
  userId: string;
  role: 'paciente' | 'medico';
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  createSession(): Promise<{ sessionId: string; callId: string; callType: string }> {
    return request('/sessions', { method: 'POST', body: '{}' });
  },

  getSession(sessionId: string): Promise<SessionDto> {
    return request(`/sessions/${sessionId}`);
  },

  getToken(sessionId: string, userId: string, role: 'paciente' | 'medico'): Promise<TokenDto> {
    return request(
      `/sessions/${sessionId}/token?userId=${encodeURIComponent(userId)}&role=${encodeURIComponent(role)}`,
    );
  },

  notifyJoined(sessionId: string, userId: string): Promise<SessionDto> {
    return request(
      `/sessions/${sessionId}/joined?userId=${encodeURIComponent(userId)}`,
      { method: 'POST', body: '{}' },
    );
  },

  notifyLeft(sessionId: string, userId: string): Promise<SessionDto> {
    return request(
      `/sessions/${sessionId}/left?userId=${encodeURIComponent(userId)}`,
      { method: 'POST', body: '{}' },
    );
  },

  signalMediaReady(sessionId: string, userId: string): Promise<{ state: SessionState }> {
    return request(
      `/sessions/${sessionId}/media-ready?userId=${encodeURIComponent(userId)}`,
      { method: 'POST', body: '{}' },
    );
  },

  endSession(sessionId: string, veto: boolean): Promise<SessionDto> {
    return request(`/sessions/${sessionId}/end?veto=${veto}`, { method: 'POST', body: '{}' });
  },
};
