import { Component, EventEmitter, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { api } from '../services/api.service';

export interface CallParams {
  sessionId: string;
  callId: string;
  callType: string;
  token: string;
  apiKey: string;
  userId: string;
}

interface PendingCall extends CallParams {}

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './lobby.component.html',
  styleUrl: './lobby.component.css',
})
export class LobbyComponent {
  @Output() join = new EventEmitter<CallParams>();

  userId = signal('dr-ayrlon');
  sessionId = signal('');
  loading = signal(false);
  error = signal('');
  pending = signal<PendingCall | null>(null);
  copyConfirm = signal(false);

  // Step 1: create session and display ID — does NOT navigate yet
  async createSession() {
    if (!this.userId().trim()) { this.error.set('Informe um userId'); return; }
    this.loading.set(true);
    this.error.set('');
    this.pending.set(null);
    try {
      const { sessionId: newId, callId, callType } = await api.createSession();
      const { token, apiKey } = await api.getToken(newId, this.userId().trim(), 'medico');
      this.pending.set({ sessionId: newId, callId, callType, token, apiKey, userId: this.userId().trim() });
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  // Step 2: user copied the ID and is ready to enter
  enterCreated() {
    const p = this.pending();
    if (p) this.join.emit(p);
  }

  async joinExisting() {
    const rawId = this.sessionId().trim().replace(/:$/, ''); // Remove espaços e possíveis dois-pontos copiados por engano
    const rawUserId = this.userId().trim();

    if (!rawId || !rawUserId) {
      this.error.set('Informe sessionId e userId');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const { token, callId, callType, apiKey } = await api.getToken(
        rawId,
        rawUserId,
        'medico',
      );
      this.join.emit({
        sessionId: rawId,
        callId,
        callType,
        token,
        apiKey,
        userId: rawUserId,
      });
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  async copySessionId() {
    const id = this.pending()?.sessionId;
    if (!id) return;
    await navigator.clipboard.writeText(id);
    this.copyConfirm.set(true);
    setTimeout(() => this.copyConfirm.set(false), 2500);
  }
}
