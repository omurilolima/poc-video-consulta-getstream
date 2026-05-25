import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { StreamVideoClient } from '@stream-io/video-client';
import type { StreamVideoParticipant } from '@stream-io/video-client';
import { VideoStreamDirective } from '../directives/video-stream.directive';
import { api, SessionState } from '../services/api.service';
import type { CallParams } from '../lobby/lobby.component';

@Component({
  selector: 'app-call',
  standalone: true,
  imports: [VideoStreamDirective],
  templateUrl: './call.component.html',
  styleUrl: './call.component.css',
})
export class CallComponent implements OnInit, OnDestroy {
  @Input({ required: true }) params!: CallParams;
  @Output() leave = new EventEmitter<void>();

  sessionState = signal<SessionState | null>(null);
  joining = signal(true);
  joinError = signal('');
  ending = signal(false);

  localParticipant = signal<StreamVideoParticipant | undefined>(undefined);
  remoteParticipants = signal<StreamVideoParticipant[]>([]);
  micEnabled = signal(true);
  camEnabled = signal(true);

  private client?: StreamVideoClient;
  call?: ReturnType<StreamVideoClient['call']>;
  private pollInterval?: ReturnType<typeof setInterval>;
  private participantsSub?: { unsubscribe(): void };

  async ngOnInit() {
    try {
      this.client = new StreamVideoClient({
        apiKey: this.params.apiKey,
        user: { id: this.params.userId },
        token: this.params.token,
      });

      this.call = this.client.call(this.params.callType, this.params.callId);

      // Observa participantes: atualiza lista e sinaliza mediaReady apenas quando
      // o participante remoto publicar tracks de áudio e vídeo.
      this.participantsSub = this.call.state.participants$.subscribe(async (participants) => {
        this.localParticipant.set(participants.find((p) => p.isLocalParticipant));
        const remotes = participants.filter((p) => !p.isLocalParticipant);
        this.remoteParticipants.set(remotes);

        if (remotes.length === 0) {
          if (
            this.sessionState() === 'ativa' &&
            this.lastRemoteUserId
          ) {
            const remoteId = this.lastRemoteUserId;
            this.lastRemoteUserId = null;
            this.resetMediaReadySignal();
            await api.notifyLeft(this.params.sessionId, remoteId).catch(() => undefined);
          } else {
            this.resetMediaReadySignal();
          }
        }

        if (!this.mediaReadySignaled && remotes.length > 0) {
          const other = remotes[0];
          this.lastRemoteUserId = other.userId;
          // Na Web, o array de publishedTracks é enum (AUDIO = 1, VIDEO = 2)
          // mas dependendo da versão do SDK pode ser string ('audio', 'video')
          const tracks = other.publishedTracks ?? [];
          const hasVideo = tracks.includes(2) || tracks.includes('video' as any);
          const hasAudio = tracks.includes(1) || tracks.includes('audio' as any);
          
          if (hasVideo && hasAudio) {
            this.mediaReadySignaled = true;
            await api.signalMediaReady(this.params.sessionId, this.params.userId).catch(() => undefined);
          }
        }
      });

      await this.call.join({ create: false });

      // The Stream JS SDK publishes devices when enable() runs after join.
      const mediaResults = await Promise.allSettled([
        this.call.camera.enable().then(() => console.log('Câmera publicada na Web')),
        this.call.microphone.enable().then(() => console.log('Mic publicado na Web')),
      ]);

      for (const result of mediaResults) {
        if (result.status === 'rejected') {
          console.warn('Falha ao publicar mídia na Web', result.reason);
        }
      }

      this.camEnabled.set(this.call.camera.state.status === 'enabled');
      this.micEnabled.set(this.call.microphone.state.status === 'enabled');
      this.joining.set(false);
      await api.notifyJoined(this.params.sessionId, this.params.userId);

      this.startPolling();
    } catch (e) {
      this.joinError.set((e as Error).message);
      this.joining.set(false);
    }
  }

  private startPolling() {
    this.pollInterval = setInterval(async () => {
      try {
        const session = await api.getSession(this.params.sessionId);
        const prev = this.sessionState();
        // C3: ao voltar de ativa → midia_pendente, permitir re-sinalizar media-ready
        if (prev === 'ativa' && session.state === 'midia_pendente') {
          this.resetMediaReadySignal();
        }
        this.sessionState.set(session.state);
      } catch {
        // keep last known state on network error
      }
    }, 3000);
  }

  private mediaReadySignaled = false;
  private lastRemoteUserId: string | null = null;

  private resetMediaReadySignal() {
    this.mediaReadySignaled = false;
  }

  async endCall(veto: boolean) {
    if (this.ending()) return;
    this.ending.set(true);
    try {
      await api.endSession(this.params.sessionId, veto);
    } catch {
      // ignore — still leave
    }
    await this.cleanup();
    this.leave.emit();
  }

  async leaveCall() {
    await this.cleanup();
    this.leave.emit();
  }

  private async cleanup() {
    clearInterval(this.pollInterval);
    this.participantsSub?.unsubscribe();
    await api.notifyLeft(this.params.sessionId, this.params.userId).catch(() => undefined);
    await this.call?.leave().catch(() => undefined);
    await this.client?.disconnectUser().catch(() => undefined);
  }

  async ngOnDestroy() {
    await this.cleanup();
  }

  async toggleMic() {
    if (!this.call) return;
    try {
      await this.call.microphone.toggle();
      this.micEnabled.set(this.call.microphone.state.status === 'enabled');
    } catch (e) {
      console.warn('Erro ao alternar microfone', e);
    }
  }

  async toggleCam() {
    if (!this.call) return;
    try {
      await this.call.camera.toggle();
      this.camEnabled.set(this.call.camera.state.status === 'enabled');
    } catch (e) {
      console.warn('Erro ao alternar câmera', e);
    }
  }

  hasPublishedVideo(participant: StreamVideoParticipant): boolean {
    return this.hasPublishedTrack(participant, 2, 'video');
  }

  hasPublishedAudio(participant: StreamVideoParticipant): boolean {
    return this.hasPublishedTrack(participant, 1, 'audio');
  }

  private hasPublishedTrack(
    participant: StreamVideoParticipant,
    numericTrack: number,
    textTrack: string,
  ): boolean {
    return (participant.publishedTracks ?? []).some((track) => {
      return track === numericTrack || String(track).toLowerCase().includes(textTrack);
    });
  }

  stateBadgeClass(): string {
    const map: Record<string, string> = {
      criada: 'badge-info',
      aguardando: 'badge-warning',
      midia_pendente: 'badge-warning',
      ativa: 'badge-success',
      encerrada: 'badge-secondary',
      vetada: 'badge-danger',
    };
    return map[this.sessionState() ?? ''] ?? 'badge-info';
  }

  stateLabel(): string {
    const map: Record<string, string> = {
      criada: 'Criada',
      aguardando: 'Aguardando paciente',
      midia_pendente: 'Mídia pendente',
      ativa: 'Ativa',
      encerrada: 'Encerrada',
      vetada: 'Vetada',
    };
    return map[this.sessionState() ?? ''] ?? (this.sessionState() ?? '—');
  }
}
