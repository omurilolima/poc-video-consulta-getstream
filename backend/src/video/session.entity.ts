export enum SessionState {
  CRIADA = 'criada',
  AGUARDANDO = 'aguardando',
  MIDIA_PENDENTE = 'midia_pendente',
  ATIVA = 'ativa',
  ENCERRADA = 'encerrada',
  VETADA = 'vetada',
}

export type ParticipantRole = 'paciente' | 'medico';

export interface Participant {
  userId: string;
  role: ParticipantRole;
  joinedAt?: Date;
  mediaReady: boolean;
}

export interface Session {
  id: string;
  callId: string;
  callType: string;
  state: SessionState;
  participants: Map<string, Participant>;
  lobbyTimeoutHandle?: NodeJS.Timeout;
  createdAt: Date;
  updatedAt: Date;
}
