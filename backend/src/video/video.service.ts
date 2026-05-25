import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamClient } from '@stream-io/node-sdk';
import { randomUUID } from 'crypto';
import { Session, SessionState, ParticipantRole } from './session.entity';

/** Tempo máximo em lobby antes de encerrar automaticamente (C2). Configurável via env. */
const DEFAULT_LOBBY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly client: StreamClient;
  private readonly sessions = new Map<string, Session>();
  private readonly lobbyTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.getOrThrow<string>('getstream_api_key');
    const apiSecret = config.getOrThrow<string>('getstream_api_secret');
    this.client = new StreamClient(apiKey, apiSecret);
    this.lobbyTimeoutMs = Number(
      config.get('LOBBY_TIMEOUT_MS') ?? DEFAULT_LOBBY_TIMEOUT_MS,
    );
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  async createSession(): Promise<{
    sessionId: string;
    callId: string;
    callType: string;
  }> {
    const sessionId = randomUUID();
    const callId = `consulta-${sessionId}`;
    const callType = 'default';

    const call = this.client.video.call(callType, callId);
    await this.client.upsertUsers([{ id: 'system', name: 'System' }]);
    await call.getOrCreate({
      data: {
        created_by_id: 'system',
        custom: { sessionId },
        settings_override: {
          recording: { mode: 'disabled' },
        },
      },
    });

    const session: Session = {
      id: sessionId,
      callId,
      callType,
      state: SessionState.CRIADA,
      participants: new Map(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    this.logger.log(`Session created: ${sessionId} → ${SessionState.CRIADA}`);
    return { sessionId, callId, callType };
  }

  getSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    return session;
  }

  async generateToken(
    sessionId: string,
    userId: string,
    role: ParticipantRole,
  ): Promise<string> {
    const session = this.getSession(sessionId);

    if (session.state === SessionState.VETADA) {
      if (role === 'paciente')
        throw new ForbiddenException(
          'Session is vetoed — patient cannot rejoin',
        );
    }

    if (
      [SessionState.ENCERRADA, SessionState.VETADA].includes(session.state) &&
      role !== 'medico'
    ) {
      throw new ForbiddenException('Session is closed');
    }

    // Register participant if not yet known (allows pre-registration before join)
    if (!session.participants.has(userId)) {
      session.participants.set(userId, { userId, role, mediaReady: false });
    }

    // GetStream precisa conhecer o usuário; role de negócio (paciente/medico) fica só na capability
    await this.client.upsertUsers([{ id: userId, name: userId }]);

    const callCid = `${session.callType}:${session.callId}`;
    return this.client.generateCallToken({
      user_id: userId,
      call_cids: [callCid],
      validity_in_seconds: 3600,
    });
  }

  // ---------------------------------------------------------------------------
  // State machine transitions (driven by webhooks and client signals)
  // ---------------------------------------------------------------------------

  onParticipantJoined(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const participant = session.participants.get(userId);
    if (participant) {
      participant.joinedAt = new Date();
    }

    if (session.state === SessionState.CRIADA) {
      this.transition(session, SessionState.AGUARDANDO);
      this.scheduleLobbyTimeout(session);
    } else if (session.state === SessionState.AGUARDANDO) {
      this.clearLobbyTimeout(session);
      this.transition(session, SessionState.MIDIA_PENDENTE);
    }
  }

  onParticipantLeft(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.state === SessionState.ATIVA) {
      // C3: ambos precisam re-sinalizar media-ready após reconexão
      for (const p of session.participants.values()) {
        p.mediaReady = false;
      }
      this.transition(session, SessionState.MIDIA_PENDENTE);
      this.scheduleLobbyTimeout(session);
    } else {
      const participant = session.participants.get(userId);
      if (participant) participant.mediaReady = false;
    }
  }

  onSessionEnded(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.clearLobbyTimeout(session);
    if (
      ![SessionState.ENCERRADA, SessionState.VETADA].includes(session.state)
    ) {
      this.transition(session, SessionState.ENCERRADA);
    }
  }

  signalMediaReady(sessionId: string, userId: string): { state: SessionState } {
    const session = this.getSession(sessionId);

    const participant = session.participants.get(userId);
    if (!participant)
      throw new NotFoundException(
        `Participant ${userId} not in session ${sessionId}`,
      );

    participant.mediaReady = true;
    this.logger.log(
      `Media ready signal from ${userId} in session ${sessionId}`,
    );

    if (session.state === SessionState.MIDIA_PENDENTE) {
      const participants = [...session.participants.values()];
      const allReady =
        participants.length >= 2 && participants.every((p) => p.mediaReady);
      if (allReady) {
        this.clearLobbyTimeout(session);
        this.transition(session, SessionState.ATIVA);
      }
    }

    return { state: session.state };
  }

  async endSession(sessionId: string, veto: boolean): Promise<Session> {
    const session = this.getSession(sessionId);
    this.clearLobbyTimeout(session);

    const call = this.client.video.call(session.callType, session.callId);

    if (veto) {
      // Block patients from rejoining at GetStream level
      const patients = [...session.participants.values()].filter(
        (p) => p.role === 'paciente',
      );
      for (const patient of patients) {
        try {
          await call.blockUser({ user_id: patient.userId });
        } catch (err) {
          this.logger.warn(
            `Could not block user ${patient.userId}: ${(err as Error).message}`,
          );
        }
      }
      this.transition(session, SessionState.VETADA);
    } else {
      this.transition(session, SessionState.ENCERRADA);
    }

    try {
      await call.end();
    } catch (err) {
      this.logger.warn(
        `GetStream call.end() failed: ${(err as Error).message}`,
      );
    }

    return session;
  }

  // ---------------------------------------------------------------------------
  // Webhook signature verification
  // ---------------------------------------------------------------------------

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return this.client.verifyWebhook(rawBody, signature);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private transition(session: Session, next: SessionState): void {
    this.logger.log(`Session ${session.id}: ${session.state} → ${next}`);
    session.state = next;
    session.updatedAt = new Date();
  }

  private scheduleLobbyTimeout(session: Session): void {
    this.clearLobbyTimeout(session);
    session.lobbyTimeoutHandle = setTimeout(() => {
      if (
        [SessionState.AGUARDANDO, SessionState.MIDIA_PENDENTE].includes(
          session.state,
        )
      ) {
        this.logger.log(
          `Session ${session.id}: lobby timeout → encerrada (C2)`,
        );
        this.transition(session, SessionState.ENCERRADA);
        this.client.video
          .call(session.callType, session.callId)
          .end()
          .catch(() => undefined);
      }
    }, this.lobbyTimeoutMs);
  }

  private clearLobbyTimeout(session: Session): void {
    if (session.lobbyTimeoutHandle) {
      clearTimeout(session.lobbyTimeoutHandle);
      session.lobbyTimeoutHandle = undefined;
    }
  }

  serializeSession(session: Session) {
    return {
      id: session.id,
      callId: session.callId,
      callType: session.callType,
      state: session.state,
      participants: [...session.participants.values()].map(
        ({ userId, role, joinedAt, mediaReady }) => ({
          userId,
          role,
          joinedAt,
          mediaReady,
        }),
      ),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
